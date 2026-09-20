"""The ``ObjectStore`` seam and its data-transfer objects.

Domain code (notably ``cvs/``) must never touch a MinIO/S3 client directly. It
speaks only to this Protocol, so the backing store is swappable without a domain
edit — the whole point of design decision D-10: MinIO is AGPL-3.0 and consumed as
a network service, and if legal later rejects AGPL the adapter can be re-pointed
at SeaweedFS (Apache 2.0) or Garage without any change above this line.

The method set is exactly what the CV upload/integrity pipeline needs and no more:

* ``put_object`` — write bytes to a bucket, returning the store-assigned version
  id that ``cv_versions.object_version_id`` records (design, cv_versions).
* ``get_object`` — open a readable stream for a key (+ optional version), which
  the download path wraps in a hashing reader for the checksum check (R5 AC15).
* ``copy_object`` — server-side copy, used to promote a clean upload from the
  quarantine bucket to the available bucket after ClamAV clears it (R5 AC3).
* ``stat_object`` — head metadata (size, etag, version id) without transferring
  the body.
* ``list_objects`` — enumerate keys under a prefix, for the nightly integrity
  re-verification sweep (R5 AC15).

Every signature is async: the concrete MinIO adapter runs the blocking SDK on a
worker thread, and a future native-async backend fits the same shape. Nothing
here imports the ``minio`` SDK — this file stays a pure interface so unit tests
can assert Protocol conformance against a mock without any client installed.

Encryption-at-rest (R5 AC16) is carried by the optional ``sse`` argument on the
write paths. This file stays a pure interface: the MinIO adapter (Task 6.2)
translates an :class:`SseSpec` into the SDK's SSE object, and ``cvs/`` callers
build the CV spec via ``app.platform.storage.sse``. ``None`` means no encryption
request. See :class:`SseSpec`.
"""

from __future__ import annotations

from abc import abstractmethod
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Protocol, runtime_checkable

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Mapping
    from datetime import datetime

__all__ = [
    "ObjectStat",
    "ObjectStore",
    "PutResult",
    "SseSpec",
    "StoredObjectStream",
]


@dataclass(frozen=True, slots=True)
class SseSpec:
    """Server-side-encryption request threaded to the storage backend.

    Deliberately opaque at this layer: it names the KMS External Key MinIO should
    encrypt under and any encryption context, without exposing the KMS provider.
    The MinIO adapter maps it to the SDK's SSE-KMS object; ``cvs/`` callers build
    the CV spec via :func:`app.platform.storage.sse.cv_sse_spec_from_config`
    (R5 AC16).

    Args:
        kms_key_id: The KMS External Key identifier the backend encrypts under.
        context: Additional key-derivation context (encryption context).
    """

    kms_key_id: str
    context: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class PutResult:
    """Outcome of a successful write.

    Args:
        bucket: The bucket the object was written to.
        key: The object key within the bucket.
        version_id: Store-assigned version id. Persisted on the ``cv_versions``
            row so a later read pins the exact immutable snapshot. Empty only if
            the backend has versioning disabled, which the CV buckets never do.
        etag: The backend's entity tag for the stored bytes.
    """

    bucket: str
    key: str
    version_id: str
    etag: str


@dataclass(frozen=True, slots=True)
class ObjectStat:
    """Head metadata for a stored object, body not transferred.

    Args:
        bucket: The bucket holding the object.
        key: The object key within the bucket.
        size_bytes: Object size in bytes.
        etag: The backend's entity tag.
        version_id: The version id addressed, when the backend is versioned.
        last_modified: Server-recorded last-modified time, when reported.
        content_type: Stored content type, when reported.
    """

    bucket: str
    key: str
    size_bytes: int
    etag: str
    version_id: str | None = None
    last_modified: datetime | None = None
    content_type: str | None = None


@runtime_checkable
class StoredObjectStream(Protocol):
    """A readable byte stream for one stored object.

    The download path wraps this in a SHA-256 hashing reader and aborts on a
    digest mismatch at end-of-stream (R5 AC15). Always use it as an async context
    manager so the underlying connection is released even on an early abort.
    """

    @abstractmethod
    async def read(self, size: int = -1) -> bytes:
        """Read up to ``size`` bytes; ``size < 0`` reads to end-of-stream."""
        ...

    @abstractmethod
    async def aclose(self) -> None:
        """Release the underlying connection/response."""
        ...

    @abstractmethod
    async def __aenter__(self) -> StoredObjectStream: ...

    @abstractmethod
    async def __aexit__(self, *exc: object) -> None: ...

    def __aiter__(self) -> AsyncIterator[bytes]:
        """Iterate the body in chunks (default chunking is adapter-defined)."""
        ...


@runtime_checkable
class ObjectStore(Protocol):
    """Storage seam over an S3-compatible, versioned, object-locked backend.

    Implementations must preserve two guarantees the CV pipeline relies on:

    * A write to a CV bucket lands under versioning + object lock, so a stored
      object cannot be overwritten or deleted for the retention period even with
      a compromised application credential (R5 AC4, design File Handling notes).
    * ``version_id`` on :class:`PutResult` addresses that exact immutable
      snapshot on a later read.
    """

    @abstractmethod
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
        """Write ``data`` to ``bucket``/``key`` and return the write outcome.

        Args:
            bucket: Target bucket (an available or quarantine bucket).
            key: Object key within the bucket.
            data: The exact bytes to store.
            content_type: MIME type recorded on the object.
            metadata: User metadata stored alongside the object.
            sse: Server-side-encryption request. ``None`` in Phase 1 Task 6.1;
                populated by Task 6.2.

        Returns:
            The bucket, key, store-assigned ``version_id`` and etag.

        Raises:
            UpstreamUnavailable: If the backend is unreachable or rejects the
                write transiently.
        """
        ...

    @abstractmethod
    async def get_object(
        self,
        *,
        bucket: str,
        key: str,
        version_id: str | None = None,
    ) -> StoredObjectStream:
        """Open a readable stream for ``bucket``/``key`` (optionally pinned).

        Args:
            bucket: Bucket to read from.
            key: Object key within the bucket.
            version_id: Exact version to read; ``None`` reads the latest.

        Returns:
            An async, context-managed byte stream.

        Raises:
            UpstreamUnavailable: If the backend is unreachable.
        """
        ...

    @abstractmethod
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
        """Server-side copy an object, e.g. quarantine → available promotion.

        The bytes never round-trip through the application, so promotion of a
        cleared CV stays cheap and the checksum is preserved by construction
        (R5 AC3, design File Handling notes).

        Args:
            source_bucket: Bucket to copy from.
            source_key: Source object key.
            dest_bucket: Bucket to copy to.
            dest_key: Destination object key.
            source_version_id: Exact source version; ``None`` copies the latest.
            metadata: Replacement user metadata for the destination object.
            sse: Server-side-encryption request for the destination. ``None`` in
                Task 6.1; populated by Task 6.2.

        Returns:
            The destination bucket, key, version id and etag.

        Raises:
            UpstreamUnavailable: If the backend is unreachable.
        """
        ...

    @abstractmethod
    async def stat_object(
        self,
        *,
        bucket: str,
        key: str,
        version_id: str | None = None,
    ) -> ObjectStat:
        """Return head metadata for ``bucket``/``key`` without the body.

        Raises:
            UpstreamUnavailable: If the backend is unreachable.
        """
        ...

    @abstractmethod
    def list_objects(
        self,
        *,
        bucket: str,
        prefix: str = "",
        recursive: bool = True,
    ) -> AsyncIterator[ObjectStat]:
        """Yield head metadata for every object under ``prefix``.

        Not ``async def``: an async generator's call returns the iterator
        directly, so callers write ``async for stat in store.list_objects(...)``.

        Raises:
            UpstreamUnavailable: If the backend is unreachable mid-iteration.
        """
        ...
