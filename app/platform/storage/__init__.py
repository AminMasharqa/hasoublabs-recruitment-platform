"""Object storage platform layer.

Exposes the :class:`ObjectStore` seam and its MinIO/S3 implementation. Domain
modules import ``ObjectStore`` and the DTOs from here and never the concrete
adapter, so the backing store stays swappable (design decision D-10).

Server-side encryption (SSE-KMS via OpenBao) is Task 6.2 (R5 AC16): the
:class:`SseSpec` seam is now applied on the write paths, and CV callers build
the default spec via :func:`cv_sse_spec_from_config` without touching OpenBao
details.
"""

from __future__ import annotations

from app.platform.storage.base import (
    ObjectStat,
    ObjectStore,
    PutResult,
    SseSpec,
    StoredObjectStream,
)
from app.platform.storage.errors import (
    BucketBootstrapError,
    ObjectLockNotEnabledError,
    StorageConfigurationError,
)
from app.platform.storage.minio_store import (
    BucketRoles,
    MinioObjectStore,
    MinioSettings,
    build_minio_client,
    ensure_cv_buckets,
    minio_settings_from_config,
)
from app.platform.storage.sse import (
    OpenBaoKmsProbe,
    cv_sse_spec,
    cv_sse_spec_from_config,
    ensure_cv_kms_key,
)

__all__ = [
    "BucketBootstrapError",
    "BucketRoles",
    "MinioObjectStore",
    "MinioSettings",
    "ObjectLockNotEnabledError",
    "ObjectStat",
    "ObjectStore",
    "OpenBaoKmsProbe",
    "PutResult",
    "SseSpec",
    "StorageConfigurationError",
    "StoredObjectStream",
    "build_minio_client",
    "cv_sse_spec",
    "cv_sse_spec_from_config",
    "ensure_cv_buckets",
    "ensure_cv_kms_key",
    "minio_settings_from_config",
]
