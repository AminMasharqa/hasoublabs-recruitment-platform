"""FastAPI router for the jobs module (R6, Section 17).

Every route has a ``Depends(require(...))`` guard — no unguarded endpoints.
Services are read from ``request.app.state`` set by the lifespan hook in main.py.

Route summary
-------------
POST   /jobs                              → 201 JobDescriptionDTO  (Senior ctx OR Admin)
GET    /jobs                              → 200 JdBrowsePage       (any Approved)
GET    /jobs/{jd_id}                      → 200 JobDescriptionDTO  (any Approved)
PATCH  /jobs/{jd_id}                      → 200 JobDescriptionDTO  (Senior ctx OR Admin)
POST   /jobs/{jd_id}:publish              → 200 JobDescriptionDTO  (Senior ctx OR Admin)
POST   /jobs/{jd_id}:close                → 200 JobDescriptionDTO  (Senior ctx OR Admin)
PUT    /jobs/{jd_id}/application-channel  → 200 JobDescriptionDTO  (Senior ctx OR Admin)
GET    /jobs/{jd_id}/contactable-seniors  → 200 list[SeniorContactDTO] (any Approved)
GET    /admin/jobs                        → 200 JdBrowsePage       (Admin only)
POST   /jobs/extract:url                  → 202 JdExtractionDraftDTO (Senior ctx OR Admin)
POST   /jobs/extract:text                 → 202 JdExtractionDraftDTO (Senior ctx OR Admin)
GET    /jobs/extract/{draft_id}           → 200 JdExtractionDraftDTO (Senior ctx OR Admin)
POST   /jobs/extract/{draft_id}:confirm   → 201 JobDescriptionDTO  (Senior ctx OR Admin)
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status

from app.modules.jobs.schemas import (
    JdAdminListParams,
    JdBrowsePage,
    JdBrowseParams,
    JdCreateRequest,
    JdExtractionDraftDTO,
    JdExtractTextRequest,
    JdExtractUrlRequest,
    JdUpdateRequest,
    JobDescriptionDTO,
    SetApplicationChannelRequest,
)
from app.modules.profiles.schemas import SeniorContactDTO
from app.platform.db.enums import (
    ApplicationChannel,
    EmploymentType,
    ExperienceLevel,
    JdStatus,
    WorkModel,
)
from app.platform.security.guards import require
from app.platform.security.principal import Principal
from app.platform.security.types import Role

router = APIRouter(tags=["jobs"])

# ── Role-set constants (shared across guards) ─────────────────────────────────

_SENIOR_OR_ADMIN = frozenset({Role.SENIOR, Role.ADMIN})
_ANY_ROLE = frozenset({Role.ADMIN, Role.CANDIDATE, Role.SENIOR})
_ADMIN_ONLY = frozenset({Role.ADMIN})

# ── Service accessors ─────────────────────────────────────────────────────────


def _jd_service(request: Request):
    """Return the JobDescriptionService from app.state."""
    return request.app.state.jd_service


def _extraction_service(request: Request):
    """Return the JdExtractionService from app.state."""
    return request.app.state.jd_extraction_service


def _profiles_api(request: Request):
    """Return the ProfilesApi from app.state."""
    return request.app.state.profiles_api


# ── Job Description CRUD ───────────────────────────────────────────────────────


@router.post(
    "/jobs",
    status_code=status.HTTP_201_CREATED,
    response_model=JobDescriptionDTO,
    summary="Create a Job Description",
)
async def create_jd(
    request: Request,
    body: JdCreateRequest,
    principal: Annotated[
        Principal,
        # require() checks role membership; service enforces context rules.
        # Admins hold only the ADMIN role so context= would wrongly block them.
        # Seniors must be acting as SENIOR — enforced in the service.
        Depends(require(roles=_SENIOR_OR_ADMIN)),
    ],
) -> JobDescriptionDTO:
    """Create a new Job Description in DRAFT status.

    Accessible to accounts acting in the Senior context, or Admins.
    Seniors must be acting in the SENIOR context (dual-role accounts switch first).
    """
    from app.platform.security.errors import AuthorizationDenied  # noqa: PLC0415

    # Enforce context for Senior accounts (dual-role: Candidate+Senior).
    if not principal.is_admin and not principal.acting_as(Role.SENIOR):
        raise AuthorizationDenied()

    svc = _jd_service(request)
    return await svc.create(principal, body)


@router.get(
    "/jobs",
    response_model=JdBrowsePage,
    summary="Browse Open Job Descriptions",
)
async def browse_jds(
    request: Request,
    principal: Annotated[
        Principal,
        Depends(require(roles=_ANY_ROLE)),
    ],
    search: str | None = Query(None),
    skills: list[UUID] = Query(default_factory=list),
    location: str | None = Query(None),
    work_model: WorkModel | None = Query(None),
    employment_type: EmploymentType | None = Query(None),
    experience_level: ExperienceLevel | None = Query(None),
    after_published_at: str | None = Query(None),
    after_id: UUID | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
) -> JdBrowsePage:
    """Return a paginated list of Open Job Descriptions.

    Accessible to any authenticated, Approved account.
    """
    from datetime import datetime  # noqa: PLC0415

    after_published_at_dt: datetime | None = None
    if after_published_at is not None:
        try:
            after_published_at_dt = datetime.fromisoformat(after_published_at)
        except ValueError:
            from app.platform.errors.base import FieldViolation, ValidationFailed  # noqa: PLC0415
            raise ValidationFailed(
                fields=[FieldViolation(path="after_published_at", code="invalid_datetime")]
            )

    params = JdBrowseParams(
        search=search,
        skills=skills,
        location=location,
        work_model=work_model,
        employment_type=employment_type,
        experience_level=experience_level,
        after_published_at=after_published_at_dt,
        after_id=after_id,
        limit=limit,
    )
    svc = _jd_service(request)
    return await svc.browse(principal, params)


@router.get(
    "/jobs/{jd_id}",
    response_model=JobDescriptionDTO,
    summary="Get a Job Description",
)
async def get_jd(
    jd_id: UUID,
    request: Request,
    principal: Annotated[
        Principal,
        Depends(require(roles=_ANY_ROLE)),
    ],
) -> JobDescriptionDTO:
    """Fetch a Job Description by id.

    - Admin: sees all statuses.
    - Senior: sees own JDs + Open JDs.
    - Candidate: sees only Open JDs.
    """
    svc = _jd_service(request)
    return await svc.get(jd_id, principal)


def _require_senior_ctx_or_admin(
    principal: Principal = Depends(require(roles=_SENIOR_OR_ADMIN)),
) -> Principal:
    """Enforce that the caller is either an Admin or acting in the SENIOR context."""
    from app.platform.security.errors import AuthorizationDenied  # noqa: PLC0415

    if not principal.is_admin and not principal.acting_as(Role.SENIOR):
        raise AuthorizationDenied()
    return principal


_require_senior_ctx_or_admin._has_auth_dependency = True  # type: ignore[attr-defined]


@router.patch(
    "/jobs/{jd_id}",
    response_model=JobDescriptionDTO,
    summary="Update a Job Description",
)
async def update_jd(
    jd_id: UUID,
    request: Request,
    body: JdUpdateRequest,
    principal: Annotated[Principal, Depends(_require_senior_ctx_or_admin)],
) -> JobDescriptionDTO:
    """Partially update a DRAFT or OPEN Job Description.

    Only the creator or an Admin may update. Closed JDs cannot be edited.
    """
    svc = _jd_service(request)
    return await svc.update(jd_id, principal, body)


@router.post(
    "/jobs/{jd_id}:publish",
    response_model=JobDescriptionDTO,
    summary="Publish a Job Description",
)
async def publish_jd(
    jd_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(_require_senior_ctx_or_admin)],
) -> JobDescriptionDTO:
    """Transition a Job Description from DRAFT to OPEN.

    Validates that external_url is set when channel is EXTERNAL_CAREERS_URL.
    """
    svc = _jd_service(request)
    return await svc.publish(jd_id, principal)


@router.post(
    "/jobs/{jd_id}:close",
    response_model=JobDescriptionDTO,
    summary="Close a Job Description",
)
async def close_jd(
    jd_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(_require_senior_ctx_or_admin)],
) -> JobDescriptionDTO:
    """Transition an OPEN Job Description to CLOSED.

    Downstream application closure is handled by the ApplicationService.
    """
    svc = _jd_service(request)
    return await svc.close(jd_id, principal)


@router.put(
    "/jobs/{jd_id}/application-channel",
    response_model=JobDescriptionDTO,
    summary="Set the application channel",
)
async def set_application_channel(
    jd_id: UUID,
    request: Request,
    body: SetApplicationChannelRequest,
    principal: Annotated[Principal, Depends(_require_senior_ctx_or_admin)],
) -> JobDescriptionDTO:
    """Set or replace the application channel on a DRAFT or OPEN JD."""
    svc = _jd_service(request)
    return await svc.set_application_channel(jd_id, principal, body.channel)


@router.get(
    "/jobs/{jd_id}/contactable-seniors",
    response_model=list[SeniorContactDTO],
    summary="Get contactable Seniors for a JD",
)
async def get_contactable_seniors(
    jd_id: UUID,
    request: Request,
    principal: Annotated[
        Principal,
        Depends(require(roles=_ANY_ROLE)),
    ],
) -> list[SeniorContactDTO]:
    """Return all Seniors contactable for the given Job Description."""
    svc = _jd_service(request)
    profiles_api = _profiles_api(request)
    return await svc.get_contactable_seniors(jd_id, principal, profiles_api)


# ── Admin list ─────────────────────────────────────────────────────────────────


@router.get(
    "/admin/jobs",
    response_model=JdBrowsePage,
    summary="Admin: list all Job Descriptions",
)
async def admin_list_jds(
    request: Request,
    principal: Annotated[
        Principal,
        Depends(require(roles=_ADMIN_ONLY)),
    ],
    jd_status: JdStatus | None = Query(None, alias="status"),
    after_id: UUID | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
) -> JdBrowsePage:
    """List all Job Descriptions for Admin, with optional status filter."""
    params = JdAdminListParams(status=jd_status, after_id=after_id, limit=limit)
    svc = _jd_service(request)
    return await svc.list_for_admin(params)


# ── Extraction endpoints ───────────────────────────────────────────────────────


@router.post(
    "/jobs/extract:url",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=JdExtractionDraftDTO,
    summary="Submit URL for JD extraction",
)
async def extract_url(
    request: Request,
    body: JdExtractUrlRequest,
    principal: Annotated[Principal, Depends(_require_senior_ctx_or_admin)],
) -> JdExtractionDraftDTO:
    """Submit a public URL for async heuristic extraction into a draft JD."""
    svc = _extraction_service(request)
    return await svc.submit_url_extraction(body.url, principal)


@router.post(
    "/jobs/extract:text",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=JdExtractionDraftDTO,
    summary="Submit text for JD extraction",
)
async def extract_text(
    request: Request,
    body: JdExtractTextRequest,
    principal: Annotated[Principal, Depends(_require_senior_ctx_or_admin)],
) -> JdExtractionDraftDTO:
    """Submit raw text for async heuristic extraction into a draft JD."""
    svc = _extraction_service(request)
    return await svc.submit_text_extraction(body.raw_text, principal)


@router.get(
    "/jobs/extract/{draft_id}",
    response_model=JdExtractionDraftDTO,
    summary="Poll an extraction draft",
)
async def get_extraction_draft(
    draft_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(_require_senior_ctx_or_admin)],
) -> JdExtractionDraftDTO:
    """Poll an extraction draft for worker-populated results."""
    svc = _extraction_service(request)
    return await svc.get_draft(draft_id, principal)


@router.post(
    "/jobs/extract/{draft_id}:confirm",
    status_code=status.HTTP_201_CREATED,
    response_model=JobDescriptionDTO,
    summary="Confirm an extraction draft into a Job Description",
)
async def confirm_extraction_draft(
    draft_id: UUID,
    request: Request,
    body: JdCreateRequest,
    principal: Annotated[Principal, Depends(_require_senior_ctx_or_admin)],
) -> JobDescriptionDTO:
    """Confirm a completed extraction draft into a real DRAFT Job Description."""
    svc = _extraction_service(request)
    return await svc.confirm_draft(draft_id, principal, body)


__all__ = ["router"]
