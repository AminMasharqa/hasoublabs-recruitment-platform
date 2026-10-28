"""Storage-layer error types.

Transient backend failures (unreachable MinIO, a rejected write) are surfaced as
the platform's :class:`~app.platform.errors.base.UpstreamUnavailable` so they
render through the one error envelope and the outbox/job machinery can retry.

The errors defined *here* are configuration/bootstrap faults that are not
client-retryable and must fail loudly at startup rather than at first upload —
most importantly the object-lock invariant: an existing CV bucket without object
lock enabled cannot be fixed in place (S3 only permits enabling object lock at
bucket-creation time), so booting against one is a hard misconfiguration.
"""

from __future__ import annotations

__all__ = [
    "BucketBootstrapError",
    "ObjectLockNotEnabledError",
    "StorageConfigurationError",
]


class StorageConfigurationError(RuntimeError):
    """Base class for non-retryable storage setup faults."""


class BucketBootstrapError(StorageConfigurationError):
    """A bucket could not be created or configured during bootstrap."""


class ObjectLockNotEnabledError(StorageConfigurationError):
    """A CV bucket exists but lacks object lock.

    Object lock can only be turned on when a bucket is created (S3 semantics), so
    this cannot be remediated in place. Refusing to boot prevents storing CVs in
    a bucket that would silently permit overwrite/delete, which would violate the
    storage-enforced immutability guarantee (R5 AC4).
    """

    def __init__(self, bucket: str) -> None:
        self.bucket = bucket
        super().__init__(
            f"bucket {bucket!r} exists without object lock enabled; "
            "object lock can only be set at bucket creation, so it must be "
            "recreated to satisfy the CV immutability guarantee (R5 AC4)"
        )
