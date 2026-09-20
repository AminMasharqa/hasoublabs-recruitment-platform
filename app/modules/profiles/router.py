"""HTTP routes for the profiles module (Task 15.4).

All FastAPI imports live here (and only here) per module conventions.
Every route carries a ``require(...)`` guard — no unguarded private routes.

Routes:
    # Candidate (Candidate context)
    GET  /me/profile
    PUT  /me/profile

    # Senior (Senior context)
    GET  /me/senior-profile
    PUT  /me/senior-profile

    # Admin
    GET  /admin/candidates/{account_id}/profile
    GET  /admin/seniors/{account_id}/profile

    # Any approved
    GET  /skills                  (q: search term)
    GET  /admin/skills/pending    (Admin only)
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from app.modules.profiles.schemas import (
    CandidateProfileDTO,
    CandidateProfileUpdateRequest,
    SeniorProfileDTO,
    SeniorProfileUpdateRequest,
)
from app.platform.security.guards import current_principal, require
from app.platform.security.principal import Principal
from app.platform.security.types import APPROVED_ONLY, Role

router = APIRouter(tags=["profiles"])


# ── Dependency helpers ────────────────────────────────────────────────────────


def _candidate_service(request: Request) -> Any:
    """Resolve CandidateProfileService from application state."""
    return request.app.state.candidate_profile_service


def _senior_service(request: Request) -> Any:
    """Resolve SeniorProfileService from application state."""
    return request.app.state.senior_profile_service


# ── Candidate routes ──────────────────────────────────────────────────────────


@router.get(
    "/me/profile",
    response_model=CandidateProfileDTO,
    summary="Get my candidate profile",
    description=(
        "Returns the authenticated candidate's profile. Creates an empty profile "
        "if none exists yet. Requires Candidate context."
    ),
)
async def get_my_candidate_profile(
    principal: Principal = Depends(
        require(roles=frozenset({Role.CANDIDATE}), context=Role.CANDIDATE)
    ),
    service: Any = Depends(_candidate_service),
) -> CandidateProfileDTO:
    """Retrieve (or initialise) the authenticated candidate's profile."""
    result: CandidateProfileDTO = await service.get_or_create(principal.account_id)
    return result


@router.put(
    "/me/profile",
    response_model=CandidateProfileDTO,
    summary="Update my candidate profile",
    description=(
        "Full-replace update of the authenticated candidate's profile. "
        "All provided sub-collections (education, work_experience, skills, languages) "
        "are replaced atomically. Partial updates are supported — only supplied "
        "fields are written. Requires Candidate context."
    ),
)
async def update_my_candidate_profile(
    data: CandidateProfileUpdateRequest,
    principal: Principal = Depends(
        require(roles=frozenset({Role.CANDIDATE}), context=Role.CANDIDATE)
    ),
    service: Any = Depends(_candidate_service),
) -> CandidateProfileDTO:
    """Validate and apply an update to the authenticated candidate's profile."""
    result: CandidateProfileDTO = await service.update(principal.account_id, data)
    return result


# ── Senior routes ─────────────────────────────────────────────────────────────


@router.get(
    "/me/senior-profile",
    response_model=SeniorProfileDTO,
    summary="Get my senior profile",
    description=(
        "Returns the authenticated senior's profile. Creates an empty profile "
        "if none exists yet. Requires Senior context."
    ),
)
async def get_my_senior_profile(
    principal: Principal = Depends(
        require(roles=frozenset({Role.SENIOR}), context=Role.SENIOR)
    ),
    service: Any = Depends(_senior_service),
) -> SeniorProfileDTO:
    """Retrieve (or initialise) the authenticated senior's profile."""
    result: SeniorProfileDTO = await service.get_or_create(principal.account_id)
    return result


@router.put(
    "/me/senior-profile",
    response_model=SeniorProfileDTO,
    summary="Update my senior profile",
    description=(
        "Update the authenticated senior's profile including contact preferences "
        "and field-of-expertise skills. Requires Senior context."
    ),
)
async def update_my_senior_profile(
    data: SeniorProfileUpdateRequest,
    principal: Principal = Depends(
        require(roles=frozenset({Role.SENIOR}), context=Role.SENIOR)
    ),
    service: Any = Depends(_senior_service),
) -> SeniorProfileDTO:
    """Validate and apply an update to the authenticated senior's profile."""
    result: SeniorProfileDTO = await service.update(principal.account_id, data)
    return result


# ── Admin routes ──────────────────────────────────────────────────────────────


@router.get(
    "/admin/candidates/{account_id}/profile",
    response_model=CandidateProfileDTO,
    summary="Admin: get any candidate's profile",
    description=(
        "Retrieve a candidate's full profile as an Admin. "
        "Returns 403 if no profile exists for the given account_id (no 404 leak)."
    ),
)
async def admin_get_candidate_profile(
    account_id: UUID,
    principal: Principal = Depends(  # noqa: ARG001
        require(roles=frozenset({Role.ADMIN}))
    ),
    service: Any = Depends(_candidate_service),
) -> CandidateProfileDTO:
    """Admin: load any candidate's full profile."""
    result: CandidateProfileDTO = await service.get_for_admin(account_id)
    return result


@router.get(
    "/admin/seniors/{account_id}/profile",
    response_model=SeniorProfileDTO,
    summary="Admin: get any senior's profile",
    description=(
        "Retrieve a senior's full profile as an Admin. "
        "Returns 403 if no profile exists for the given account_id (no 404 leak)."
    ),
)
async def admin_get_senior_profile(
    account_id: UUID,
    principal: Principal = Depends(  # noqa: ARG001
        require(roles=frozenset({Role.ADMIN}))
    ),
    service: Any = Depends(_senior_service),
) -> SeniorProfileDTO:
    """Admin: load any senior's full profile."""
    result: SeniorProfileDTO = await service.get_for_admin(account_id)
    return result


# ── Skill search routes ───────────────────────────────────────────────────────


@router.get(
    "/skills",
    summary="Search skills taxonomy",
    description=(
        "Full-text search over the canonical skill taxonomy. "
        "Returns up to 20 matching skills. Available to all Approved accounts."
    ),
)
async def search_skills(
    q: str = Query(default="", min_length=0, max_length=100, description="Search term"),
    principal: Principal = Depends(  # noqa: ARG001
        require(roles=frozenset({Role.ADMIN, Role.CANDIDATE, Role.SENIOR}))
    ),
    request: Request = None,  # type: ignore[assignment]
) -> list[dict]:  # type: ignore[type-arg]
    """Return matching skills from the taxonomy."""
    from sqlalchemy import select  # noqa: PLC0415
    from app.platform.db.engine import get_sessionmaker  # noqa: PLC0415
    from app.platform.taxonomy.models import Skill  # noqa: PLC0415

    session_factory = get_sessionmaker()
    async with session_factory() as session:
        if q:
            stmt = (
                select(Skill.id, Skill.normalized_name, Skill.name)
                .where(Skill.normalized_name.ilike(f"%{q.lower()}%"))
                .limit(20)
            )
        else:
            stmt = select(Skill.id, Skill.normalized_name, Skill.name).limit(20)

        result = await session.execute(stmt)
        rows = result.fetchall()

    return [
        {
            "id": str(row.id),
            "normalized_name": row.normalized_name,
            "name": row.name,
        }
        for row in rows
    ]


@router.get(
    "/admin/skills/pending",
    summary="Admin: list pending skill terms for review",
    description=(
        "Returns unmatched skill terms awaiting Admin taxonomy review (R4 AC3). "
        "Admin only."
    ),
)
async def admin_list_pending_skills(
    principal: Principal = Depends(  # noqa: ARG001
        require(roles=frozenset({Role.ADMIN}))
    ),
) -> list[dict]:  # type: ignore[type-arg]
    """Admin: list skill terms pending taxonomy review."""
    from sqlalchemy import select  # noqa: PLC0415
    from app.platform.db.engine import get_sessionmaker  # noqa: PLC0415
    from app.platform.taxonomy.models import UnmatchedSkillTerm  # noqa: PLC0415

    session_factory = get_sessionmaker()
    async with session_factory() as session:
        result = await session.execute(
            select(UnmatchedSkillTerm)
            .where(UnmatchedSkillTerm.pending_review.is_(True))
            .order_by(UnmatchedSkillTerm.created_at)
            .limit(100)
        )
        rows = result.scalars().all()

    return [
        {
            "id": str(row.id),
            "raw_term": row.raw_term,
            "normalized_term": row.normalized_term,
            "skill_id": str(row.skill_id) if row.skill_id else None,
            "pending_review": row.pending_review,
            "created_at": row.created_at.isoformat(),
        }
        for row in rows
    ]
