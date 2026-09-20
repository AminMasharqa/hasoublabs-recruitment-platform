"""MinIO/S3 :class:`~app.platform.storage.base.ObjectStore` adapter and bootstrap.

This is the only module that imports the ``minio`` SDK. It keeps the import lazy
(inside methods) for the same reason the mail adapter does: the pure interface in
``base.py`` and the bucket-name resolution here can be unit-tested with a mock
client and no SDK installed, and a process that never touches storage does not
pay the import cost.

The MinIO client is synchronous and blocking, so every call is dispatched to a
worker thread via ``asyncio.to_thread``; the async ``ObjectStore`` signature is
honoured without blocking the event loop.

Bucket topology (R5 AC3, AC4, design File Handling notes):

* Two logical roles — *quarantine* (freshly uploaded, unscanned bytes) and
  *available* (ClamAV-cleared, candidate-visible). A clean upload is promoted by
  a server-side copy from quarantine to available; an infected one stays in
  quarantine and is never copied out.
* Both buckets are created with object lock enabled — which implies versioning —
  and then given a default retention in COMPLIANCE mode for the retention
  period. Compliance mode (not governance) is deliberate: not even root can
  shorten or bypass it, so a compromised application credential still cannot
  overwrite or delete a stored CV (R5 AC4).

Connection settings come from :class:`app.config.Settings`; nothing is hardcoded.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import logging
from typing import TYPE_CHECKING, Any, Final

from app.platform.errors.base import UpstreamUnavailable
from app.platform.storage.base import ObjectStat, PutResult
from app.platform.storage.errors import BucketBootstrapError, ObjectLockNotEnabledError

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Mapping

    from app.config import Settings
    from app.platform.storage.base import SseSpec, StoredObjectStream

__all__ = [
    "BucketRoles",
    "MinioObjectStore",
    "MinioSettings",
    "build_minio_client",
    "ensure_cv_buckets",
    "minio_settings_from_config",
]

_LOG = logging.getLogger(__name__)

#: Default object-lock retention for the CV buckets, in days. The Data Retention
#: constraint sets candidate data at ≥5 years; CV objects are held under object
#: lock for that period. Configurable so staging can use a short window.
_DEFAULT_RETENTION_DAYS: Final[int] = 5 * 365

#: Streaming read chunk size for downloads (used by the hashing wrapper upstream).
_READ_CHUNK_BYTES: Final[int] = 1 << 16  # 64 KiB


@dataclass(frozen=True, slots=True)
class BucketRoles:
    """The available/quarantine bucket pair the CV pipeline promotes between.

    Args:
        available: Bucket for scanned, candidate-visible CV objects.
        quarantine: Bucket for freshly uploaded, not-yet-scanned CV objects.
    """

    available: str
    quarantine: str

    def all_buckets(self) -> tuple[str, ...]:
        """Return every bucket name, for bootstrap iteration."""
        return (self.available, self.quarantine)


@dataclass(frozen=True, slots=True)
class MinioSettings:
    """Connection + topology settings for :class:`MinioObjectStore`.

    Args:
        endpoint: ``host:port`` of the S3 endpoint (no scheme).
        access_key: Access key id.
        secret_key: Secret access key.
        secure: Whether to use TLS.
        buckets: The available/quarantine CV bucket pair.
        retention_days: Object-lock retention window in days.
    """

    endpoint: str
    access_key: str
    secret_key: str
    secure: bool
    buckets: BucketRoles
    retention_days: int = _DEFAULT_RETENTION_DAYS


def minio_settings_from_config(
    settings: Settings,
    *,
    retention_days: int = _DEFAULT_RETENTION_DAYS,
) -> MinioSettings:
    """Build :class:`MinioSettings` from the application config.

    Reads ``minio_endpoint``, ``minio_access_key``, ``minio_secret_key``,
    ``minio_secure``, ``minio_cv_bucket`` (available) and
    ``minio_cv_quarantine_bucket`` (quarantine). Nothing is hardcoded.

    Args:
        settings: The application settings singleton.
        retention_days: Object-lock retention window to configure on the buckets.

    Returns:
        The assembled storage settings.
    """
    return MinioSettings(
        endpoint=settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=settings.minio_secure,
        buckets=BucketRoles(
            available=settings.minio_cv_bucket,
            quarantine=settings.minio_cv_quarantine_bucket,
        ),
        retention_days=retention_days,
    )


class MinioObjectStore:
    """:class:`ObjectStore` over MinIO/S3 via the blocking ``minio`` SDK.

    The client is injected rather than constructed here so tests pass a mock and
    :func:`build_minio_client` is the single place the SDK is instantiated.
    """

    def __init__(self, client: Any, settings: MinioSettings) -> None:
        """Wrap a MinIO client.

        Args:
            client: A ``minio.Minio`` instance (or a conforming test double).
            settings: Connection and topology settings.
        """
        self._client = client
        self._settings = settings

    @property
    def buckets(self) -> BucketRoles:
        """The configured available/quarantine bucket pair."""
        return self._settings.buckets

    def resolve_bucket(self, *, quarantine: bool) -> str:
        """Return the available or quarantine bucket name.

        Args:
            quarantine: ``True`` for the quarantine bucket, ``False`` for the
                candidate-visible available bucket.

        Returns:
            The resolved bucket name.
        """
        return self._settings.buckets.quarantine if quarantine else self._settings.buckets.available

    async def put_object(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str = "application/octet-stream",
        metadata: Mapping[str, str] | None = None,
        sse: SseSpec | None = None,
    ) -> PutResult:
        # Task 6.2: an SseSpec is translated to a minio SSE object and passed to
        # the SDK so MinIO encrypts the object server-side under the named KMS
        # External Key (R5 AC16). ``None`` writes with no encryption request, so
        # the Task 6.1 behaviour is unchanged when no spec is supplied.
        result = await asyncio.to_thread(
            self._put_object_sync,
            bucket=bucket,
            key=key,
            data=data,
            content_type=content_type,
            metadata=dict(metadata) if metadata else None,
            sse=sse,
        )
        return result

    def _put_object_sync(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
        metadata: dict[str, str] | None,
        sse: SseSpec | None,
    ) -> PutResult:
        import io  # noqa: PLC0415

        try:
            result = self._client.put_object(
                bucket,
                key,
                io.BytesIO(data),
                length=len(data),
                content_type=content_type,
                metadata=metadata,
                sse=_to_minio_sse(sse),
            )
        except Exception as exc:  # noqa: BLE001 - SDK raises a broad hierarchy
            raise self._unavailable("put_object", exc) from exc
        return PutResult(
            bucket=bucket,
            key=key,
            version_id=getattr(result, "version_id", "") or "",
            etag=getattr(result, "etag", "") or "",
        )

    async def get_object(
        self,
        *,
        bucket: str,
        key: str,
        version_id: str | None = None,
    ) -> StoredObjectStream:
        response = await asyncio.to_thread(
            self._get_object_sync,
            bucket=bucket,
            key=key,
            version_id=version_id,
        )
        return _MinioObjectStream(response)

    def _get_object_sync(
        self,
        *,
        bucket: str,
        key: str,
        version_id: str | None,
    ) -> Any:
        try:
            return self._client.get_object(bucket, key, version_id=version_id)
        except Exception as exc:  # noqa: BLE001 - SDK raises a broad hierarchy
            raise self._unavailable("get_object", exc) from exc

    async def copy_object(
        self,
        *,
        source_bucket: str,
        source_key: str,
        dest_bucket: str,
        dest_key: str,
        source_version_id: str | None = None,
        metadata: Mapping[str, str] | None = None,
        sse: SseSpec | None = None,
    ) -> PutResult:
        # Task 6.2: the destination object is (re-)encrypted server-side under
        # the named KMS External Key when an SseSpec is supplied (R5 AC16). A
        # quarantine→available promotion should carry the CV SseSpec so the
        # candidate-visible copy is encrypted at rest just like the upload.
        return await asyncio.to_thread(
            self._copy_object_sync,
            source_bucket=source_bucket,
            source_key=source_key,
            dest_bucket=dest_bucket,
            dest_key=dest_key,
            source_version_id=source_version_id,
            metadata=dict(metadata) if metadata else None,
            sse=sse,
        )

    def _copy_object_sync(
        self,
        *,
        source_bucket: str,
        source_key: str,
        dest_bucket: str,
        dest_key: str,
        source_version_id: str | None,
        metadata: dict[str, str] | None,
        sse: SseSpec | None,
    ) -> PutResult:
        from minio.commonconfig import REPLACE, CopySource  # noqa: PLC0415

        source = CopySource(source_bucket, source_key, version_id=source_version_id)
        try:
            result = self._client.copy_object(
                dest_bucket,
                dest_key,
                source,
                metadata=metadata,
                metadata_directive=REPLACE if metadata else None,
                sse=_to_minio_sse(sse),
            )
        except Exception as exc:  # noqa: BLE001 - SDK raises a broad hierarchy
            raise self._unavailable("copy_object", exc) from exc
        return PutResult(
            bucket=dest_bucket,
            key=dest_key,
            version_id=getattr(result, "version_id", "") or "",
            etag=getattr(result, "etag", "") or "",
        )

    async def stat_object(
        self,
        *,
        bucket: str,
        key: str,
        version_id: str | None = None,
    ) -> ObjectStat:
        return await asyncio.to_thread(
            self._stat_object_sync,
            bucket=bucket,
            key=key,
            version_id=version_id,
        )

    def _stat_object_sync(
        self,
        *,
        bucket: str,
        key: str,
        version_id: str | None,
    ) -> ObjectStat:
        try:
            obj = self._client.stat_object(bucket, key, version_id=version_id)
        except Exception as exc:  # noqa: BLE001 - SDK raises a broad hierarchy
            raise self._unavailable("stat_object", exc) from exc
        return _stat_from_object(bucket, key, obj)

    async def list_objects(
        self,
        *,
        bucket: str,
        prefix: str = "",
        recursive: bool = True,
    ) -> AsyncIterator[ObjectStat]:
        # The SDK returns a lazy synchronous iterator; drain it once on a worker
        # thread rather than hopping threads per item (the sweep reads whole
        # prefixes, so buffering the head metadata is cheaper than N to_thread
        # round-trips).
        stats = await asyncio.to_thread(
            self._list_objects_sync,
            bucket=bucket,
            prefix=prefix,
            recursive=recursive,
        )
        for stat in stats:
            yield stat

    def _list_objects_sync(
        self,
        *,
        bucket: str,
        prefix: str,
        recursive: bool,
    ) -> list[ObjectStat]:
        try:
            objects = self._client.list_objects(bucket, prefix=prefix, recursive=recursive)
            return [_stat_from_object(bucket, obj.object_name, obj) for obj in objects]
        except Exception as exc:  # noqa: BLE001 - SDK raises a broad hierarchy
            raise self._unavailable("list_objects", exc) from exc

    @staticmethod
    def _unavailable(operation: str, exc: Exception) -> UpstreamUnavailable:
        return UpstreamUnavailable(
            service="minio",
            log_message=f"minio {operation} failed: {exc}",
        )


def _to_minio_sse(sse: SseSpec | None) -> Any:
    """Translate the storage-seam :class:`SseSpec` into a ``minio`` SSE object.

    Task 6.2 (R5 AC16). Maps to ``minio.sse.SseKMS(key, context)`` — the SDK
    class name is ``SseKMS`` (capitalised KMS) and its ``context`` argument is
    required, so an empty dict is passed when no encryption context is set (the
    SDK then omits the context header). The import stays lazy, inside this
    function, so ``base.py`` and the mockable adapter logic remain testable with
    no ``minio`` SDK installed — the same convention as every other SDK touch
    point in this module.

    The MinIO client sends this as an ``aws:kms`` request; MinIO resolves the
    named External Key against its configured KMS (OpenBao) and encrypts the
    object server-side. Note that SSE-KMS requires TLS to the endpoint, so a
    non-TLS ``minio_secure=False`` endpoint must not be used with a live
    SseSpec in a real deployment; the SDK enforces this itself.

    Args:
        sse: The server-side-encryption request, or ``None`` for no encryption.

    Returns:
        A ``minio.sse.SseKMS`` instance, or ``None`` when ``sse`` is ``None`` so
        the SDK write carries no encryption argument (Task 6.1 behaviour).
    """
    if sse is None:
        return None
    from minio.sse import SseKMS  # noqa: PLC0415

    return SseKMS(sse.kms_key_id, dict(sse.context))


def _stat_from_object(bucket: str, key: str, obj: Any) -> ObjectStat:
    """Adapt a MinIO ``Object`` (from stat or list) to :class:`ObjectStat`."""
    return ObjectStat(
        bucket=bucket,
        key=key,
        size_bytes=int(getattr(obj, "size", 0) or 0),
        etag=(getattr(obj, "etag", "") or ""),
        version_id=getattr(obj, "version_id", None),
        last_modified=getattr(obj, "last_modified", None),
        content_type=getattr(obj, "content_type", None),
    )


class _MinioObjectStream:
    """Async wrapper over a blocking ``urllib3`` response from ``get_object``.

    MinIO's ``get_object`` returns an ``HTTPResponse`` that must be both consumed
    and released (``close`` + ``release_conn``) or the connection leaks back to
    the pool. Reads run on a worker thread; the async context manager guarantees
    release even when the caller aborts mid-stream on a checksum mismatch.
    """

    def __init__(self, response: Any) -> None:
        self._response = response

    async def read(self, size: int = -1) -> bytes:
        amt = None if size is None or size < 0 else size
        data = await asyncio.to_thread(self._response.read, amt)
        return bytes(data) if data else b""

    async def aclose(self) -> None:
        await asyncio.to_thread(self._close_sync)

    def _close_sync(self) -> None:
        close = getattr(self._response, "close", None)
        if callable(close):
            close()
        release = getattr(self._response, "release_conn", None)
        if callable(release):
            release()

    async def __aenter__(self) -> _MinioObjectStream:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def __aiter__(self) -> AsyncIterator[bytes]:
        while True:
            chunk = await self.read(_READ_CHUNK_BYTES)
            if not chunk:
                break
            yield chunk


def build_minio_client(settings: MinioSettings) -> Any:
    """Construct a ``minio.Minio`` client from settings.

    Isolated so it is the single SDK-instantiation point and so tests never need
    a real client.

    Args:
        settings: Connection settings.

    Returns:
        A configured ``minio.Minio`` instance.
    """
    from minio import Minio  # noqa: PLC0415

    return Minio(
        settings.endpoint,
        access_key=settings.access_key,
        secret_key=settings.secret_key,
        secure=settings.secure,
    )


async def ensure_cv_buckets(client: Any, settings: MinioSettings) -> None:
    """Create and configure the CV buckets idempotently at startup.

    For each of the available and quarantine buckets:

    * If missing, create it with object lock enabled (which implies versioning).
    * If present, verify object lock is enabled — it cannot be turned on after
      creation, so a bucket without it is a hard misconfiguration and boot fails
      (R5 AC4).
    * Set (or refresh) the default COMPLIANCE-mode retention to the configured
      window, and ensure versioning is enabled.

    This runs the blocking SDK on a worker thread.

    Args:
        client: A ``minio.Minio`` instance (or conforming double).
        settings: Storage settings carrying bucket names and retention window.

    Raises:
        ObjectLockNotEnabledError: If an existing bucket lacks object lock.
        BucketBootstrapError: If bucket creation or configuration fails.
    """
    await asyncio.to_thread(_ensure_cv_buckets_sync, client, settings)


def _ensure_cv_buckets_sync(client: Any, settings: MinioSettings) -> None:
    from minio.commonconfig import COMPLIANCE, ENABLED  # noqa: PLC0415
    from minio.objectlockconfig import DAYS, ObjectLockConfig  # noqa: PLC0415
    from minio.versioningconfig import VersioningConfig  # noqa: PLC0415

    lock_config = ObjectLockConfig(COMPLIANCE, settings.retention_days, DAYS)

    for bucket in settings.buckets.all_buckets():
        try:
            exists = client.bucket_exists(bucket)
        except Exception as exc:  # noqa: BLE001 - SDK raises a broad hierarchy
            raise BucketBootstrapError(f"bucket_exists({bucket!r}) failed: {exc}") from exc

        if not exists:
            # object_lock=True at creation time is the ONLY way to get an
            # object-locked bucket (S3 semantics). It implies versioning.
            try:
                client.make_bucket(bucket, object_lock=True)
            except Exception as exc:  # noqa: BLE001 - SDK raises a broad hierarchy
                raise BucketBootstrapError(f"make_bucket({bucket!r}) failed: {exc}") from exc
        else:
            _assert_object_lock_enabled(client, bucket)

        # Belt-and-braces: object lock implies versioning, but enable it
        # explicitly so the invariant does not depend on that implication.
        try:
            client.set_bucket_versioning(bucket, VersioningConfig(ENABLED))
        except Exception as exc:  # noqa: BLE001 - SDK raises a broad hierarchy
            raise BucketBootstrapError(f"set_bucket_versioning({bucket!r}) failed: {exc}") from exc

        try:
            client.set_object_lock_config(bucket, lock_config)
        except Exception as exc:  # noqa: BLE001 - SDK raises a broad hierarchy
            raise BucketBootstrapError(
                f"set_object_lock_config({bucket!r}) failed: {exc}"
            ) from exc

        _LOG.info(
            "CV bucket %r ready: object-lock=COMPLIANCE retention=%dd, versioning=ENABLED",
            bucket,
            settings.retention_days,
        )


def _assert_object_lock_enabled(client: Any, bucket: str) -> None:
    """Raise if ``bucket`` exists without object lock (unfixable in place)."""
    try:
        config = client.get_object_lock_config(bucket)
    except Exception as exc:  # noqa: BLE001 - SDK raises a broad hierarchy
        # A backend that rejects the query for a non-locked bucket is treated as
        # not-enabled: refuse to boot rather than assume it is safe.
        raise ObjectLockNotEnabledError(bucket) from exc
    if config is None or getattr(config, "mode", None) is None:
        raise ObjectLockNotEnabledError(bucket)
