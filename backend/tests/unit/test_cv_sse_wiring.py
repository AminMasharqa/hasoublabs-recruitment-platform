"""Both CV writes ask MinIO to encrypt under the CV KMS key (R5 AC16).

The storage seam, the MinIO adapter and the ``SseSpec`` builder all existed, but
no caller passed a spec: the upload and the quarantine→available promotion both
wrote with ``sse=None``, so every CV was stored unencrypted at rest.
"""

from __future__ import annotations

import io
import sys
from types import SimpleNamespace
from typing import Any
import uuid
import zipfile

import pytest

from app.modules.cvs import repository as repo
from app.modules.cvs.service import CvUploadService
from app.platform.notifications import service as notifications
from app.platform.storage.base import PutResult
from app.platform.storage.sse import cv_sse_spec, cv_sse_spec_from_config

pytestmark = pytest.mark.unit

_SPEC = cv_sse_spec(kms_key_id="hasoub-data-key")
_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class _Uow:
    session = object()

    async def __aenter__(self) -> _Uow:
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None


class _StoreStopError(Exception):
    """Raised by the recording store to end the upload pipeline after the PUT."""


class _Store:
    def __init__(self) -> None:
        self.puts: list[dict[str, Any]] = []
        self.copies: list[dict[str, Any]] = []

    async def put_object(self, **kwargs: Any) -> PutResult:  # noqa: ANN401
        self.puts.append(kwargs)
        raise _StoreStopError

    async def copy_object(self, **kwargs: Any) -> PutResult:  # noqa: ANN401
        self.copies.append(kwargs)
        return PutResult(bucket="cvs", key=kwargs["dest_key"], version_id="v2", etag="e")


def _service(store: _Store) -> CvUploadService:
    return CvUploadService(
        _Uow,  # type: ignore[arg-type]
        object_store=store,  # type: ignore[arg-type]
        available_bucket="cvs",
        quarantine_bucket="cvs-quarantine",
        arq_queue=None,  # type: ignore[arg-type]
        sse=_SPEC,
    )


def _docx() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", "<w:document/>")
    return buffer.getvalue()


async def test_upload_puts_the_cv_with_the_kms_spec(monkeypatch: pytest.MonkeyPatch) -> None:
    # libmagic is not what is under test; report the bytes as a .docx.
    monkeypatch.setitem(
        sys.modules, "magic", SimpleNamespace(from_buffer=lambda *_a, **_k: _DOCX_MIME)
    )

    async def _get_variant(*_args: object, **_kwargs: object) -> SimpleNamespace:
        return SimpleNamespace(is_archived=False)

    async def _allocate(*_args: object) -> int:
        return 1

    monkeypatch.setattr(repo, "get_variant", _get_variant)
    monkeypatch.setattr(repo, "allocate_version_number", _allocate)

    store = _Store()
    with pytest.raises(_StoreStopError):
        await _service(store).upload(
            uuid.uuid4(), uuid.uuid4(), filename="cv.docx", content_type=_DOCX_MIME, data=_docx()
        )

    assert store.puts[0]["bucket"] == "cvs-quarantine"
    assert store.puts[0]["sse"] == _SPEC


async def test_promotion_copies_the_cv_with_the_kms_spec(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    version = SimpleNamespace(
        id=uuid.uuid4(),
        variant_id=uuid.uuid4(),
        object_key="cv/a/b/v1/cv.pdf",
        object_version_id="quarantine-v1",
    )

    async def _get_version(*_args: object) -> SimpleNamespace:
        return version

    async def _get_variant(*_args: object, **_kwargs: object) -> SimpleNamespace:
        return SimpleNamespace(account_id=uuid.uuid4())

    async def _noop(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(repo, "get_version", _get_version)
    monkeypatch.setattr(repo, "get_variant", _get_variant)
    monkeypatch.setattr(repo, "update_version_scan", _noop)
    monkeypatch.setattr(repo, "promote_version", _noop)
    monkeypatch.setattr(notifications, "push", lambda *_args, **_kwargs: None)

    store = _Store()
    await _service(store).complete_scan(version.id, is_clean=True, scan_result="OK")

    assert store.copies[0]["dest_bucket"] == "cvs"
    assert store.copies[0]["sse"] == _SPEC


def test_the_cv_key_is_the_configured_openbao_key() -> None:
    settings = SimpleNamespace(openbao_transit_key="hasoub-data-key")

    assert cv_sse_spec_from_config(settings) == _SPEC  # type: ignore[arg-type]
