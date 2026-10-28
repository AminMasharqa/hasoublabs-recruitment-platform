"""Startup creates and checks the CV buckets before any upload (R5 AC4, AC16).

``ensure_cv_buckets`` was implemented and unit-tested, but nothing called it, so
a fresh MinIO never got the ``cvs`` and ``cvs-quarantine`` buckets: every CV
upload failed with NoSuchBucket, and an existing bucket without object lock was
never refused at boot. The web process builds its object store through
``_setup_object_store``, which must run the bootstrap.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.main import _setup_object_store
from app.platform.storage import minio_store
from app.platform.storage.errors import ObjectLockNotEnabledError
from tests.unit.test_object_store import _FakeMinioClient

pytestmark = pytest.mark.unit

_CONFIG = SimpleNamespace(
    minio_endpoint="localhost:9000",
    minio_access_key="key",
    minio_secret_key="secret",
    minio_secure=False,
    minio_cv_bucket="cvs",
    minio_cv_quarantine_bucket="cvs-quarantine",
)


def _use_client(monkeypatch: pytest.MonkeyPatch, client: _FakeMinioClient) -> None:
    def _build(_settings: Any) -> _FakeMinioClient:
        return client

    monkeypatch.setattr(minio_store, "build_minio_client", _build)


async def test_startup_creates_both_cv_buckets_with_object_lock(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeMinioClient(existing_buckets=set())
    _use_client(monkeypatch, client)

    store = await _setup_object_store(_CONFIG)  # type: ignore[arg-type]

    made = {c[1][0] for c in client.calls if c[0] == "make_bucket"}
    assert made == {"cvs", "cvs-quarantine"}
    assert isinstance(store, minio_store.MinioObjectStore)


async def test_startup_refuses_an_existing_bucket_without_object_lock(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeMinioClient(existing_buckets={"cvs", "cvs-quarantine"}, lock_enabled=False)
    _use_client(monkeypatch, client)

    with pytest.raises(ObjectLockNotEnabledError):
        await _setup_object_store(_CONFIG)  # type: ignore[arg-type]
