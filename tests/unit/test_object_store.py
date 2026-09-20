"""Unit tests for the storage adapter (Task 6.1).

These tests exercise the pure/mockable parts of the MinIO ``ObjectStore`` adapter
against a fake client — no real MinIO. Covered:

* Protocol conformance of the concrete adapter and its DTO stream.
* Bucket-name resolution (available vs quarantine) and settings-from-config.
* Argument handling on put/get/copy/stat/list.
* Bootstrap object-lock/versioning invariants (R5 AC4).

Object-lock *immutability under a live backend* (a stored object cannot be
overwritten or deleted for the retention period) is Task 6.3's Testcontainers
integration test, out of scope here.
"""

from __future__ import annotations

import sys
import types
from dataclasses import dataclass, field
from typing import Any

import pytest

from app.platform.errors.base import UpstreamUnavailable
from app.platform.storage import (
    BucketRoles,
    MinioObjectStore,
    MinioSettings,
    ObjectStat,
    ObjectStore,
    PutResult,
    SseSpec,
    StoredObjectStream,
    cv_sse_spec,
    cv_sse_spec_from_config,
    ensure_cv_buckets,
    ensure_cv_kms_key,
    minio_settings_from_config,
)
from app.platform.storage.errors import ObjectLockNotEnabledError


# ── Test doubles ──────────────────────────────────────────────────────────────


@dataclass
class _FakeResult:
    version_id: str = "v-1"
    etag: str = "etag-1"


@dataclass
class _FakeObject:
    object_name: str = "obj"
    size: int = 3
    etag: str = "etag-x"
    version_id: str | None = "v-x"
    last_modified: Any = None
    content_type: str | None = "application/pdf"


@dataclass
class _FakeResponse:
    payload: bytes = b"abc"
    closed: bool = False
    released: bool = False
    _pos: int = 0

    def read(self, amt: int | None = None) -> bytes:
        if amt is None:
            chunk = self.payload[self._pos :]
            self._pos = len(self.payload)
            return chunk
        chunk = self.payload[self._pos : self._pos + amt]
        self._pos += len(chunk)
        return chunk

    def close(self) -> None:
        self.closed = True

    def release_conn(self) -> None:
        self.released = True


@dataclass
class _FakeLockConfig:
    mode: str | None = "COMPLIANCE"


@dataclass
class _FakeMinioClient:
    """Records calls and returns canned SDK-shaped objects."""

    existing_buckets: set[str] = field(default_factory=set)
    lock_enabled: bool = True
    calls: list[tuple[str, tuple[Any, ...], dict[str, Any]]] = field(default_factory=list)

    def _record(self, name: str, *args: Any, **kwargs: Any) -> None:
        self.calls.append((name, args, kwargs))

    def put_object(self, *args: Any, **kwargs: Any) -> _FakeResult:
        self._record("put_object", *args, **kwargs)
        return _FakeResult()

    def get_object(self, *args: Any, **kwargs: Any) -> _FakeResponse:
        self._record("get_object", *args, **kwargs)
        return _FakeResponse()

    def copy_object(self, *args: Any, **kwargs: Any) -> _FakeResult:
        self._record("copy_object", *args, **kwargs)
        return _FakeResult(version_id="v-copy", etag="etag-copy")

    def stat_object(self, *args: Any, **kwargs: Any) -> _FakeObject:
        self._record("stat_object", *args, **kwargs)
        return _FakeObject(object_name=args[1])

    def list_objects(self, *args: Any, **kwargs: Any) -> list[_FakeObject]:
        self._record("list_objects", *args, **kwargs)
        return [_FakeObject(object_name="a"), _FakeObject(object_name="b")]

    def bucket_exists(self, bucket: str) -> bool:
        self._record("bucket_exists", bucket)
        return bucket in self.existing_buckets

    def make_bucket(self, bucket: str, **kwargs: Any) -> None:
        self._record("make_bucket", bucket, **kwargs)
        self.existing_buckets.add(bucket)

    def set_bucket_versioning(self, bucket: str, config: Any) -> None:
        self._record("set_bucket_versioning", bucket, config)

    def set_object_lock_config(self, bucket: str, config: Any) -> None:
        self._record("set_object_lock_config", bucket, config)

    def get_object_lock_config(self, bucket: str) -> _FakeLockConfig:
        self._record("get_object_lock_config", bucket)
        if not self.lock_enabled:
            return _FakeLockConfig(mode=None)
        return _FakeLockConfig()


class _StubSseKMS:
    """Stand-in for ``minio.sse.SseKMS`` (Task 6.2 tests).

    Mirrors the pinned SDK's constructor exactly — ``SseKMS(key, context)`` with
    ``context`` required — so the adapter's ``_to_minio_sse`` translation is
    exercised without the ``minio`` SDK installed, and the assertions stay valid
    against the real class if it is installed.
    """

    def __init__(self, key: str, context: dict[str, Any]) -> None:
        self.key = key
        self.context = context


class _StubSse:
    pass


class _StubSseCustomerKey:
    pass


@pytest.fixture
def stub_minio_sse(monkeypatch: pytest.MonkeyPatch) -> type[_StubSseKMS]:
    """Install a fake ``minio.sse`` module exposing :class:`_StubSseKMS`.

    ``_to_minio_sse`` imports ``minio.sse.SseKMS`` lazily, so injecting a stub
    module lets the SSE mapping be asserted with a mocked client and no MinIO.
    """
    module = types.ModuleType("minio.sse")
    module.SseKMS = _StubSseKMS  # type: ignore[attr-defined]
    module.Sse = _StubSse  # type: ignore[attr-defined]
    module.SseCustomerKey = _StubSseCustomerKey  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "minio.sse", module)
    return _StubSseKMS


def _settings() -> MinioSettings:
    return MinioSettings(
        endpoint="localhost:9000",
        access_key="key",
        secret_key="secret",
        secure=False,
        buckets=BucketRoles(available="cvs", quarantine="cvs-quarantine"),
        retention_days=30,
    )


def _store(client: _FakeMinioClient | None = None) -> MinioObjectStore:
    return MinioObjectStore(client or _FakeMinioClient(), _settings())


# ── Protocol conformance ──────────────────────────────────────────────────────


@pytest.mark.unit
def test_adapter_is_object_store() -> None:
    assert isinstance(_store(), ObjectStore)


@pytest.mark.unit
def test_settings_from_config_reads_bucket_names() -> None:
    from app.config import Settings  # noqa: PLC0415

    cfg = Settings(  # type: ignore[call-arg]
        app_secret_key="x" * 32,
        database_url="postgresql://u:p@localhost/db",
        valkey_url="redis://localhost:6379/0",
        minio_endpoint="minio:9000",
        minio_access_key="ak",
        minio_secret_key="sk",
        openbao_token="tok",
    )
    settings = minio_settings_from_config(cfg, retention_days=7)
    assert settings.buckets.available == cfg.minio_cv_bucket
    assert settings.buckets.quarantine == cfg.minio_cv_quarantine_bucket
    assert settings.endpoint == "minio:9000"
    assert settings.retention_days == 7


# ── Bucket-name resolution ────────────────────────────────────────────────────


@pytest.mark.unit
def test_resolve_bucket_available_vs_quarantine() -> None:
    store = _store()
    assert store.resolve_bucket(quarantine=False) == "cvs"
    assert store.resolve_bucket(quarantine=True) == "cvs-quarantine"
    assert store.buckets.all_buckets() == ("cvs", "cvs-quarantine")


# ── Object operations ─────────────────────────────────────────────────────────


@pytest.mark.unit
async def test_put_object_returns_version_and_passes_args() -> None:
    client = _FakeMinioClient()
    store = _store(client)

    result = await store.put_object(
        bucket="cvs-quarantine",
        key="c/1.pdf",
        data=b"pdfbytes",
        content_type="application/pdf",
        metadata={"sha256": "deadbeef"},
    )

    assert isinstance(result, PutResult)
    assert result.version_id == "v-1"
    assert result.bucket == "cvs-quarantine"
    name, args, kwargs = client.calls[0]
    assert name == "put_object"
    assert args[0] == "cvs-quarantine"
    assert args[1] == "c/1.pdf"
    assert kwargs["length"] == len(b"pdfbytes")
    assert kwargs["content_type"] == "application/pdf"
    assert kwargs["metadata"] == {"sha256": "deadbeef"}


@pytest.mark.unit
async def test_put_object_without_sse_passes_no_encryption(
    stub_minio_sse: type[_StubSseKMS],
) -> None:
    # Task 6.1 behaviour preserved: no SseSpec means sse=None reaches the SDK.
    client = _FakeMinioClient()
    store = _store(client)
    result = await store.put_object(bucket="cvs", key="k", data=b"x")
    assert result.key == "k"
    _, _, kwargs = client.calls[0]
    assert kwargs["sse"] is None


@pytest.mark.unit
async def test_put_object_with_sse_passes_kms_key_id(
    stub_minio_sse: type[_StubSseKMS],
) -> None:
    # Task 6.2 (R5 AC16): an SseSpec becomes an SSE-KMS object carrying the key.
    client = _FakeMinioClient()
    store = _store(client)
    await store.put_object(
        bucket="cvs",
        key="k",
        data=b"x",
        sse=SseSpec(kms_key_id="hasoub-data-key"),
    )
    _, _, kwargs = client.calls[0]
    sse_obj = kwargs["sse"]
    assert isinstance(sse_obj, stub_minio_sse)
    assert sse_obj.key == "hasoub-data-key"
    assert sse_obj.context == {}


@pytest.mark.unit
async def test_put_object_sse_carries_encryption_context(
    stub_minio_sse: type[_StubSseKMS],
) -> None:
    client = _FakeMinioClient()
    store = _store(client)
    await store.put_object(
        bucket="cvs",
        key="k",
        data=b"x",
        sse=SseSpec(kms_key_id="k1", context={"purpose": "cv"}),
    )
    _, _, kwargs = client.calls[0]
    assert kwargs["sse"].context == {"purpose": "cv"}


@pytest.mark.unit
async def test_copy_object_without_sse_passes_no_encryption(
    stub_minio_sse: type[_StubSseKMS],
) -> None:
    client = _FakeMinioClient()
    store = _store(client)
    await store.copy_object(
        source_bucket="cvs-quarantine",
        source_key="c/1.pdf",
        dest_bucket="cvs",
        dest_key="c/1.pdf",
    )
    _, _, kwargs = client.calls[0]
    assert kwargs["sse"] is None


@pytest.mark.unit
async def test_copy_object_with_sse_encrypts_destination(
    stub_minio_sse: type[_StubSseKMS],
) -> None:
    # Promotion quarantine→available should encrypt the candidate-visible copy.
    client = _FakeMinioClient()
    store = _store(client)
    await store.copy_object(
        source_bucket="cvs-quarantine",
        source_key="c/1.pdf",
        dest_bucket="cvs",
        dest_key="c/1.pdf",
        sse=SseSpec(kms_key_id="hasoub-data-key"),
    )
    _, _, kwargs = client.calls[0]
    assert isinstance(kwargs["sse"], stub_minio_sse)
    assert kwargs["sse"].key == "hasoub-data-key"


@pytest.mark.unit
async def test_get_object_stream_reads_and_releases() -> None:
    client = _FakeMinioClient()
    store = _store(client)

    stream = await store.get_object(bucket="cvs", key="k", version_id="v9")
    assert isinstance(stream, StoredObjectStream)
    async with stream as s:
        assert await s.read() == b"abc"

    _, args, kwargs = client.calls[0]
    assert args[0] == "cvs"
    assert kwargs["version_id"] == "v9"


@pytest.mark.unit
async def test_get_object_iterates_in_chunks_and_releases() -> None:
    client = _FakeMinioClient()
    store = _store(client)
    response_holder: list[_FakeResponse] = []

    original = client.get_object

    def _capture(*a: Any, **k: Any) -> _FakeResponse:
        resp = original(*a, **k)
        response_holder.append(resp)
        return resp

    client.get_object = _capture  # type: ignore[method-assign]

    stream = await store.get_object(bucket="cvs", key="k")
    collected = bytearray()
    async with stream as s:
        async for chunk in s:
            collected += chunk

    assert bytes(collected) == b"abc"
    assert response_holder[0].closed is True
    assert response_holder[0].released is True


@pytest.mark.unit
async def test_copy_object_promotes_between_buckets() -> None:
    client = _FakeMinioClient()
    store = _store(client)

    result = await store.copy_object(
        source_bucket="cvs-quarantine",
        source_key="c/1.pdf",
        dest_bucket="cvs",
        dest_key="c/1.pdf",
        source_version_id="v-src",
    )
    assert result.bucket == "cvs"
    assert result.version_id == "v-copy"
    name, args, _ = client.calls[0]
    assert name == "copy_object"
    assert args[0] == "cvs"
    assert args[1] == "c/1.pdf"


@pytest.mark.unit
async def test_stat_object_maps_metadata() -> None:
    store = _store()
    stat = await store.stat_object(bucket="cvs", key="c/1.pdf", version_id="v1")
    assert isinstance(stat, ObjectStat)
    assert stat.key == "c/1.pdf"
    assert stat.size_bytes == 3
    assert stat.content_type == "application/pdf"


@pytest.mark.unit
async def test_list_objects_yields_all_under_prefix() -> None:
    client = _FakeMinioClient()
    store = _store(client)
    keys = [stat.key async for stat in store.list_objects(bucket="cvs", prefix="c/")]
    assert keys == ["a", "b"]
    _, args, kwargs = client.calls[0]
    assert args[0] == "cvs"
    assert kwargs["prefix"] == "c/"
    assert kwargs["recursive"] is True


@pytest.mark.unit
async def test_backend_failure_becomes_upstream_unavailable() -> None:
    class _BoomClient(_FakeMinioClient):
        def put_object(self, *args: Any, **kwargs: Any) -> _FakeResult:
            raise RuntimeError("connection refused")

    store = MinioObjectStore(_BoomClient(), _settings())
    with pytest.raises(UpstreamUnavailable) as exc_info:
        await store.put_object(bucket="cvs", key="k", data=b"x")
    assert exc_info.value.details["service"] == "minio"


# ── Bucket bootstrap (R5 AC4) ─────────────────────────────────────────────────


@pytest.mark.unit
async def test_ensure_cv_buckets_creates_missing_with_object_lock() -> None:
    client = _FakeMinioClient(existing_buckets=set())
    await ensure_cv_buckets(client, _settings())

    make_calls = [c for c in client.calls if c[0] == "make_bucket"]
    assert {c[1][0] for c in make_calls} == {"cvs", "cvs-quarantine"}
    # object_lock must be requested at creation time (only chance to enable it).
    assert all(c[2].get("object_lock") is True for c in make_calls)
    # Versioning and a COMPLIANCE retention are configured on both buckets.
    assert sum(1 for c in client.calls if c[0] == "set_bucket_versioning") == 2
    assert sum(1 for c in client.calls if c[0] == "set_object_lock_config") == 2


@pytest.mark.unit
async def test_ensure_cv_buckets_accepts_existing_locked_bucket() -> None:
    client = _FakeMinioClient(
        existing_buckets={"cvs", "cvs-quarantine"},
        lock_enabled=True,
    )
    await ensure_cv_buckets(client, _settings())
    # No new buckets created.
    assert not any(c[0] == "make_bucket" for c in client.calls)


@pytest.mark.unit
async def test_ensure_cv_buckets_rejects_existing_unlocked_bucket() -> None:
    client = _FakeMinioClient(
        existing_buckets={"cvs", "cvs-quarantine"},
        lock_enabled=False,
    )
    with pytest.raises(ObjectLockNotEnabledError):
        await ensure_cv_buckets(client, _settings())


# ── CV SSE-KMS spec helpers (Task 6.2, R5 AC16) ───────────────────────────────


@pytest.mark.unit
def test_cv_sse_spec_names_the_key() -> None:
    spec = cv_sse_spec(kms_key_id="hasoub-data-key")
    assert isinstance(spec, SseSpec)
    assert spec.kms_key_id == "hasoub-data-key"
    assert spec.context == {}


@pytest.mark.unit
@pytest.mark.parametrize("bad", ["", "   "])
def test_cv_sse_spec_rejects_empty_key(bad: str) -> None:
    with pytest.raises(ValueError, match="non-empty"):
        cv_sse_spec(kms_key_id=bad)


@pytest.mark.unit
def test_cv_sse_spec_from_config_uses_openbao_transit_key() -> None:
    from app.config import Settings  # noqa: PLC0415

    cfg = Settings(  # type: ignore[call-arg]
        app_secret_key="x" * 32,
        database_url="postgresql://u:p@localhost/db",
        valkey_url="redis://localhost:6379/0",
        minio_endpoint="minio:9000",
        minio_access_key="ak",
        minio_secret_key="sk",
        openbao_token="tok",
        openbao_transit_key="cv-external-key",
    )
    spec = cv_sse_spec_from_config(cfg)
    assert spec.kms_key_id == "cv-external-key"


def _cfg_for_kms(key: str = "hasoub-data-key") -> Any:
    from app.config import Settings  # noqa: PLC0415

    return Settings(  # type: ignore[call-arg]
        app_secret_key="x" * 32,
        database_url="postgresql://u:p@localhost/db",
        valkey_url="redis://localhost:6379/0",
        minio_endpoint="minio:9000",
        minio_access_key="ak",
        minio_secret_key="sk",
        openbao_token="tok",
        openbao_transit_key=key,
    )


@pytest.mark.unit
async def test_ensure_cv_kms_key_noops_without_probe() -> None:
    # Seam not yet wired (Section 3): no probe means no assertion, no error.
    await ensure_cv_kms_key(_cfg_for_kms())


@pytest.mark.unit
async def test_ensure_cv_kms_key_passes_when_probe_finds_key() -> None:
    seen: list[str] = []

    class _Probe:
        def key_exists(self, key_id: str) -> bool:
            seen.append(key_id)
            return True

    await ensure_cv_kms_key(_cfg_for_kms("cv-external-key"), probe=_Probe())
    assert seen == ["cv-external-key"]


@pytest.mark.unit
async def test_ensure_cv_kms_key_raises_when_probe_missing_key() -> None:
    class _Probe:
        def key_exists(self, key_id: str) -> bool:
            return False

    with pytest.raises(ValueError, match="not found in OpenBao"):
        await ensure_cv_kms_key(_cfg_for_kms(), probe=_Probe())
