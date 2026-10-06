"""A clean scan pins the promoted copy's own object version (R5 AC3).

Promotion copies the file from the quarantine bucket to the available bucket,
and the copy gets a new store-assigned version id. ``complete_scan`` discarded
it and kept the quarantine copy's id, which does not exist in the available
bucket: every download of an Available CV failed with ``NoSuchVersion``, and the
client reported a truncated transfer.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
import uuid

import pytest

from app.modules.cvs import repository as repo
from app.modules.cvs.service import CvUploadService
from app.platform.notifications import service as notifications
from app.platform.storage.base import PutResult

pytestmark = pytest.mark.unit


class _Uow:
    session = object()

    async def __aenter__(self) -> _Uow:
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None


class _Store:
    def __init__(self) -> None:
        self.copies: list[dict[str, Any]] = []

    async def copy_object(self, **kwargs: Any) -> PutResult:  # noqa: ANN401
        self.copies.append(kwargs)
        return PutResult(bucket="cvs", key=kwargs["dest_key"], version_id="available-v1", etag="e")


async def test_promotion_records_the_available_copy_version(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    version = SimpleNamespace(
        id=uuid.uuid4(),
        variant_id=uuid.uuid4(),
        object_key="cv/a/b/v1/cv.pdf",
        object_version_id="quarantine-v1",
    )
    promoted: list[dict[str, Any]] = []

    async def _get_version(*_args: object) -> SimpleNamespace:
        return version

    async def _get_variant(*_args: object, **_kwargs: object) -> SimpleNamespace:
        return SimpleNamespace(account_id=uuid.uuid4())

    async def _update_version_scan(*_args: object, **_kwargs: object) -> None:
        return None

    async def _promote_version(_session: object, _version: object, **kwargs: Any) -> None:  # noqa: ANN401
        promoted.append(kwargs)

    monkeypatch.setattr(repo, "get_version", _get_version)
    monkeypatch.setattr(repo, "get_variant", _get_variant)
    monkeypatch.setattr(repo, "update_version_scan", _update_version_scan)
    monkeypatch.setattr(repo, "promote_version", _promote_version)
    monkeypatch.setattr(notifications, "push", lambda *_args, **_kwargs: None)

    store = _Store()
    service = CvUploadService(
        _Uow,  # type: ignore[arg-type]
        object_store=store,  # type: ignore[arg-type]
        available_bucket="cvs",
        quarantine_bucket="cvs-quarantine",
        arq_queue=None,  # type: ignore[arg-type]
    )

    await service.complete_scan(version.id, is_clean=True, scan_result="OK")

    # The copy reads the exact quarantine snapshot...
    assert store.copies[0]["source_version_id"] == "quarantine-v1"
    # ...and the row then points at the copy the available bucket holds.
    assert promoted == [
        {"object_key": "cv/a/b/v1/cv.pdf", "bucket": "cvs", "object_version_id": "available-v1"}
    ]
