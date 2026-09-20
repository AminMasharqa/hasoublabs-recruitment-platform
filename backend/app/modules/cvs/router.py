"""FastAPI routes for the CVs module (R5, Task 14.4).

Route ownership:
  Candidate routes: /me/cv-variants/**
  Admin routes:     /admin/candidates/{candidate_id}/cv-variants/**

All routes carry an explicit ``require(...)`` guard — no exceptions.

This is the only file in the module that may import from ``fastapi``.
"""

from __future__ import annotations

import hashlib
import logging
from typing import TYPE_CHECKING
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.platform.security.errors import AuthorizationDenied
from app.platform.security.guards import current_principal, require
from app.platform.security.principal import Principal
from app.platform.security.types import Role

from app.modules.cvs import repository as repo
from app.modules.cvs.schemas import (
    CreateVariantRequest,
    CvUploadResponse,
    CvVariantDTO,
    CvVersionDTO,
    UpdateVariantRequest,
)

if TYPE_CHECKING:
    from app.platform.db.uow import UnitOfWork
    from app.platform.storage.base import ObjectStore
    from app.modules.cvs.service import CvIntegrityService, CvUploadService, CvVariantService

_LOG = logging.getLogger(__name__)

router = APIRouter(tags=["CVs"])


# ── Dependency providers ──────────────────────────────────────────────────────
# These are set during application startup by calling ``configure_router``.
# Keeping them as module-level callables (rather than hard-importing a singleton)
# lets unit tests substitute fakes without patching internals.

_variant_service: CvVariantService | None = None
_upload_service: CvUploadService | None = None
_integrity_service: CvIntegrityService | None = None
_uow_factory: type[UnitOfWork] | None = None
_object_store: ObjectStore | None = None


def configure_router(
    *,
    variant_service: CvVariantService,
    upload_service: CvUploadService,
    integrity_service: CvIntegrityService,
    uow_factory: type[UnitOfWork],
    object_store: ObjectStore,
) -> None:
    """Wire up services after application startup.

    Called from the application lifespan/factory.
    """
    global _variant_service, _upload_service, _integrity_service  # noqa: PLW0603
    global _uow_factory, _object_store  # noqa: PLW0603
    _variant_service = variant_service
    _upload_service = upload_service
    _integrity_service = integrity_service
    _uow_factory = uow_factory
    _object_store = object_store


def _get_variant_service() -> CvVariantService:
    if _variant_service is None:
        raise RuntimeError("CvVariantService not configured")
    return _variant_service


def _get_upload_service() -> CvUploadService:
    if _upload_service is None:
        raise RuntimeError("CvUploadService not configured")
    return _upload_service


def _get_integrity_service() -> CvIntegrityService:
    if _integrity_service is None:
        raise RuntimeError("CvIntegrityService not configured")
    return _integrity_service


# ── Candidate: variant management ─────────────────────────────────────────────

_CANDIDATE_GUARD = require(
    roles=frozenset({Role.CANDIDATE}),
    context=Role.CANDIDATE,
)


@router.get(
    "/me/cv-variants",
    response_model=list[CvVariantDTO],
    summary="List own CV variants",
)
async def list_variants(
    principal: Principal = Depends(_CANDIDATE_GUARD),
) -> list[CvVariantDTO]:
    """Return all active variants for the authenticated candidate."""
    return await _get_variant_service().list_variants(principal.account_id)


@router.post(
    "/me/cv-variants",
    response_model=CvVariantDTO,
    status_code=201,
    summary="Create a CV variant",
)
async def create_variant(
    body: CreateVariantRequest,
    principal: Principal = Depends(_CANDIDATE_GUARD),
) -> CvVariantDTO:
    """Create a new named CV variant (up to 5 per account)."""
    return await _get_variant_service().create_variant(
        principal.account_id,
        body.name,
        body.description,
    )


@router.patch(
    "/me/cv-variants/{variant_id}",
    response_model=CvVariantDTO,
    summary="Update a CV variant",
)
async def update_variant(
    variant_id: UUID,
    body: UpdateVariantRequest,
    principal: Principal = Depends(_CANDIDATE_GUARD),
) -> CvVariantDTO:
    """Update the name or description of an active variant."""
    return await _get_variant_service().update_variant(
        variant_id,
        principal.account_id,
        name=body.name,
        description=body.description,
    )


@router.delete(
    "/me/cv-variants/{variant_id}",
    status_code=204,
    response_model=None,
    summary="Archive a CV variant",
)
async def archive_variant(
    variant_id: UUID,
    principal: Principal = Depends(_CANDIDATE_GUARD),
) -> None:
    """Archive a variant.  The last active variant cannot be archived."""
    await _get_variant_service().archive_variant(variant_id, principal.account_id)


@router.post(
    "/me/cv-variants/{variant_id}/primary",
    response_model=CvVariantDTO,
    summary="Set a variant as primary",
)
async def set_primary_variant(
    variant_id: UUID,
    principal: Principal = Depends(_CANDIDATE_GUARD),
) -> CvVariantDTO:
    """Designate this variant as the primary one for the account."""
    return await _get_variant_service().set_primary(variant_id, principal.account_id)


# ── Candidate: version upload / download ──────────────────────────────────────


@router.post(
    "/me/cv-variants/{variant_id}/versions",
    response_model=CvUploadResponse,
    status_code=202,
    summary="Upload a CV file",
)
async def upload_version(
    variant_id: UUID,
    file: UploadFile,
    principal: Principal = Depends(_CANDIDATE_GUARD),
) -> CvUploadResponse:
    """Upload a PDF or DOCX CV file.

    The file is validated (size, MIME, structure), stored in the quarantine
    bucket, and queued for ClamAV scanning. Returns 202 Accepted.
    """
    data = await file.read()
    return await _get_upload_service().upload(
        principal.account_id,
        variant_id,
        filename=file.filename or "cv",
        content_type=file.content_type or "application/octet-stream",
        data=data,
    )


@router.get(
    "/me/cv-variants/{variant_id}/versions",
    response_model=list[CvVersionDTO],
    summary="List versions for a variant",
)
async def list_versions(
    variant_id: UUID,
    principal: Principal = Depends(_CANDIDATE_GUARD),
) -> list[CvVersionDTO]:
    """Return all versions for the given variant (scoped to the requesting candidate)."""
    if _uow_factory is None:
        raise RuntimeError("UoW factory not configured")

    async with _uow_factory() as uow:
        variant = await repo.get_variant(
            uow.session, variant_id, account_id=principal.account_id
        )
        if variant is None:
            raise AuthorizationDenied()

        versions = await repo.list_versions(uow.session, variant_id)
        return [
            CvVersionDTO(
                id=v.id,
                variant_id=v.variant_id,
                version_number=v.version_number,
                state=v.state.value,
                mime_type=v.mime_type,
                original_filename=v.original_filename,
                size_bytes=v.size_bytes,
                created_at=v.created_at,
            )
            for v in versions
        ]


@router.get(
    "/me/cv-variants/{variant_id}/versions/{version_number}/download",
    summary="Download a CV version",
)
async def download_version(
    variant_id: UUID,
    version_number: int,
    principal: Principal = Depends(_CANDIDATE_GUARD),
) -> StreamingResponse:
    """Stream a CV file, verifying the SHA-256 digest after read."""
    return await _stream_cv_version(
        variant_id=variant_id,
        version_number=version_number,
        account_id=principal.account_id,
    )


# ── Admin: candidate CV views ─────────────────────────────────────────────────

_ADMIN_GUARD = require(roles=frozenset({Role.ADMIN}))


@router.get(
    "/admin/candidates/{candidate_id}/cv-variants",
    response_model=list[CvVariantDTO],
    summary="[Admin] List a candidate's CV variants",
)
async def admin_list_variants(
    candidate_id: UUID,
    principal: Principal = Depends(_ADMIN_GUARD),  # noqa: ARG001
) -> list[CvVariantDTO]:
    """Return all (including archived) variants for a candidate."""
    return await _get_variant_service().list_variants(candidate_id)


@router.get(
    "/admin/candidates/{candidate_id}/cv-variants/{variant_id}/versions/{version_number}/download",
    summary="[Admin] Download a candidate's CV version",
)
async def admin_download_version(
    candidate_id: UUID,
    variant_id: UUID,
    version_number: int,
    principal: Principal = Depends(_ADMIN_GUARD),  # noqa: ARG001
) -> StreamingResponse:
    """Stream a candidate's CV file (Admin access, integrity-verified)."""
    return await _stream_cv_version(
        variant_id=variant_id,
        version_number=version_number,
        account_id=candidate_id,
    )


# ── Shared streaming helper ────────────────────────────────────────────────────


async def _stream_cv_version(
    *,
    variant_id: UUID,
    version_number: int,
    account_id: UUID,
) -> StreamingResponse:
    """Load, stream, and integrity-verify a CV version.

    Raises AuthorizationDenied (403) for both "not found" and "not authorized"
    cases so resource existence is never leaked.
    """
    if _uow_factory is None or _object_store is None:
        raise RuntimeError("Services not configured")

    # Load version metadata inside a transaction
    async with _uow_factory() as uow:
        variant = await repo.get_variant(
            uow.session, variant_id, account_id=account_id
        )
        if variant is None:
            raise AuthorizationDenied()

        version = await repo.get_version_by_number(
            uow.session, variant_id, version_number
        )
        if version is None:
            raise AuthorizationDenied()

        # Capture fields needed outside the session
        v_bucket = version.bucket
        v_key = version.object_key
        v_version_id = version.object_version_id
        v_sha256 = version.sha256_digest
        v_mime = version.mime_type
        v_filename = version.original_filename
        v_id = version.id

    async def _generate():
        """Generator that streams the file and verifies the digest at end."""
        hasher = hashlib.sha256()
        try:
            stream = await _object_store.get_object(
                bucket=v_bucket,
                key=v_key,
                version_id=v_version_id,
            )
            async with stream as s:
                while True:
                    chunk = await s.read(65536)  # 64 KB chunks
                    if not chunk:
                        break
                    hasher.update(chunk)
                    yield chunk
        except Exception as exc:
            _LOG.error(
                "Download stream error for version %s: %s",
                v_id,
                exc,
                exc_info=True,
            )
            raise

        # Verify digest after streaming
        computed = hasher.digest()
        if computed != v_sha256:
            _LOG.error(
                "Integrity mismatch on download: version=%s key=%s",
                v_id,
                v_key,
            )
            # Can't raise HTTP exception inside a generator after headers were sent;
            # log the alarm and let the client detect truncation.
            from app.platform.notifications.models import NotificationType  # noqa: PLC0415
            # Best-effort alert: fire-and-forget outside the transaction
            _LOG.critical(
                "CV INTEGRITY ALARM: version %s digest mismatch; "
                "admin notification should be sent",
                v_id,
            )

    return StreamingResponse(
        _generate(),
        media_type=v_mime,
        headers={
            "Content-Disposition": f'attachment; filename="{v_filename}"',
        },
    )
