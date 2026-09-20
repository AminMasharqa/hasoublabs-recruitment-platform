"""FastAPI routes for the applications module (R7, Section 18).

Route ownership:
  Candidate (Candidate context):
    POST  /jobs/{jd_id}/apply                   → ApplicationDTO | ExternalRedirectDTO
    GET   /me/applications                       → list[ApplicationDTO]
    GET   /me/applications/{application_id}      → ApplicationDTO

  Senior (Senior context) OR Admin:
    GET   /jobs/{jd_id}/applicants               → list[ApplicantCardDTO]

  Admin only:
    PATCH /admin/applications/{application_id}/status → ApplicationDTO

All routes carry an explicit ``require(...)`` guard — no unguarded routes.
This is the only file in the module that may import from ``fastapi``.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status as http_status
from fastapi.responses import JSONResponse

from app.modules.applications.schemas import (
    ApplicationDTO,
    ApplicationListParams,
    ApplyRequest,
    ExternalRedirectDTO,
    JdApplicantsParams,
    UpdateStatusRequest,
)
from app.modules.profiles.schemas import ApplicantCardDTO
from app.platform.db.enums import ApplicationChannel, ApplicationStatus
from app.platform.security.errors import AuthorizationDenied
from app.platform.security.guards import current_principal, require
from app.platform.security.principal import Principal
from app.platform.security.types import Role

_LOG = logging.getLogger(__name__)

router = APIRouter(tags=["applications"])


# ── Service accessors ─────────────────────────────────────────────────────────


def _application_service(request: Request) -> Any:
    """Resolve ApplicationService from application state."""
    svc = getattr(request.app.state, "application_service", None)
    if svc is None:
        raise RuntimeError("application_service not wired to app.state")
    return svc


def _status_service(request: Request) -> Any:
    """Resolve ApplicationStatusService from application state."""
    svc = getattr(request.app.state, "application_status_service", None)
    if svc is None:
        raise RuntimeError("application_status_service not wired to app.state")
    return svc


# ── Candidate routes ──────────────────────────────────────────────────────────


@router.post(
    "/jobs/{jd_id}/apply",
    summary="Submit a job application",
    description=(
        "Submit an in-platform application for the given Job_Description. "
        "Returns 201 + ApplicationDTO for dashboard channels (Senior_Dashboard / Admin_Dashboard). "
        "Returns 200 + ExternalRedirectDTO for External_Careers_URL channels — no "
        "Application row is created in that case (R7 AC8). "
        "Requires Candidate context and an Application-Ready profile (R7 AC1)."
    ),
    response_model=ApplicationDTO,
    status_code=http_status.HTTP_201_CREATED,
)
async def submit_application(
    jd_id: UUID,
    body: ApplyRequest,
    principal: Principal = Depends(
        require(roles=frozenset({Role.CANDIDATE}), context=Role.CANDIDATE)
    ),
    service: Any = Depends(_application_service),
) -> Any:
    """POST /jobs/{jd_id}/apply — Candidate submits a job application."""
    result = await service.apply(
        jd_id,
        principal,
        cv_variant_id=body.cv_variant_id,
    )

    if result.channel == ApplicationChannel.EXTERNAL_CAREERS_URL.value:
        # R7 AC8: return 200 + ExternalRedirectDTO; no Application row was created.
        redirect_dto = ExternalRedirectDTO(
            redirect_url=result.redirect_url or "",
            channel=result.channel,
        )
        return JSONResponse(
            status_code=http_status.HTTP_200_OK,
            content=redirect_dto.model_dump(),
        )

    # In-platform channel: 201 + ApplicationDTO
    return result.application


@router.get(
    "/me/applications",
    response_model=list[ApplicationDTO],
    summary="List my applications",
    description=(
        "Return the authenticated candidate's own applications, newest first. "
        "Supports keyset pagination via ``after_id`` and ``limit``. "
        "Requires Candidate context."
    ),
)
async def list_my_applications(
    after_id: UUID | None = Query(default=None, description="Pagination cursor (application id)"),
    limit: int = Query(default=20, ge=1, le=100, description="Page size"),
    principal: Principal = Depends(
        require(roles=frozenset({Role.CANDIDATE}), context=Role.CANDIDATE)
    ),
    service: Any = Depends(_application_service),
) -> list[ApplicationDTO]:
    """GET /me/applications — Candidate lists own applications."""
    return await service.list_mine(principal, after_id=after_id, limit=limit)


@router.get(
    "/me/applications/{application_id}",
    response_model=ApplicationDTO,
    summary="Get one of my applications",
    description=(
        "Return a single application belonging to the authenticated candidate. "
        "Returns 403 (not 404) if the application does not exist or belongs to "
        "another candidate (R3 AC6). Requires Candidate context."
    ),
)
async def get_my_application(
    application_id: UUID,
    principal: Principal = Depends(
        require(roles=frozenset({Role.CANDIDATE}), context=Role.CANDIDATE)
    ),
    service: Any = Depends(_application_service),
) -> ApplicationDTO:
    """GET /me/applications/{application_id} — Candidate fetches one application."""
    return await service.get_application(application_id, principal)


# ── Senior / Admin routes ─────────────────────────────────────────────────────


@router.get(
    "/jobs/{jd_id}/applicants",
    response_model=list[ApplicantCardDTO],
    summary="List applicants for a job",
    description=(
        "Return the restricted applicant card list for a Job_Description. "
        "Seniors may only view applicants for their own JDs. "
        "Admins may view any JD's applicants. "
        "Each card contains only: full_name, applied_role_title, application_status "
        "(R3 RBAC — no contact details, CVs, or profile data exposed to Seniors)."
    ),
)
async def list_jd_applicants(
    jd_id: UUID,
    status: ApplicationStatus | None = Query(default=None, description="Filter by status"),
    after_id: UUID | None = Query(default=None, description="Pagination cursor"),
    limit: int = Query(default=20, ge=1, le=100, description="Page size"),
    principal: Principal = Depends(
        require(roles=frozenset({Role.ADMIN, Role.SENIOR}))
    ),
    service: Any = Depends(_application_service),
) -> list[ApplicantCardDTO]:
    """GET /jobs/{jd_id}/applicants — Senior or Admin views the applicant list."""
    return await service.list_jd_applicants(
        jd_id,
        principal,
        status=status,
        after_id=after_id,
        limit=limit,
    )


# ── Admin-only routes ─────────────────────────────────────────────────────────


@router.patch(
    "/admin/applications/{application_id}/status",
    response_model=ApplicationDTO,
    summary="Admin: update application status",
    description=(
        "Admin-only endpoint to move an application to a new status. "
        "Records the actor identity and a UTC timestamp in the status history "
        "(R7 AC10, AC14). Sends an in-app notification and outbox email to the "
        "candidate upon status change."
    ),
)
async def admin_update_application_status(
    application_id: UUID,
    body: UpdateStatusRequest,
    principal: Principal = Depends(
        require(roles=frozenset({Role.ADMIN}))
    ),
    service: Any = Depends(_status_service),
) -> ApplicationDTO:
    """PATCH /admin/applications/{application_id}/status — Admin changes status."""
    return await service.update_status(
        application_id,
        body.status,
        actor=principal,
        reason=body.reason,
    )


__all__ = ["router"]
