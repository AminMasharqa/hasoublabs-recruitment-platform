"""The CV worker tasks build their object store the way the web process does.

``scan_cv`` and ``verify_cv_checksums`` constructed ``MinioSettings`` without its
required ``buckets`` and ``MinioObjectStore`` without its settings, so both
raised ``TypeError`` before doing any work. Every scan was dead-lettered after
three attempts and every uploaded CV stayed PendingScan (R5 AC3).
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.modules.cvs.tasks import _object_store
from app.platform.storage.minio_store import MinioObjectStore

pytestmark = pytest.mark.unit

_CONFIG = SimpleNamespace(
    minio_endpoint="localhost:9000",
    minio_access_key="key",
    minio_secret_key="secret",
    minio_secure=False,
    minio_cv_bucket="cvs",
    minio_cv_quarantine_bucket="cvs-quarantine",
)


def test_worker_object_store_carries_both_cv_buckets() -> None:
    store = _object_store(_CONFIG)  # type: ignore[arg-type]

    assert isinstance(store, MinioObjectStore)
    assert store.buckets.available == "cvs"
    assert store.buckets.quarantine == "cvs-quarantine"
