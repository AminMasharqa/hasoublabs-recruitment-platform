"""HTTP routes for the reviews module (R9, Section 20).

All FastAPI imports live here and only here per module conventions.
Every route carries a ``require(...)`` guard — no unguarded private routes.

Routes:
    # Admin + Senior — submit a review
    POST  /candidates/{candidate_id}/reviews           201 → ReviewDTO

    # Admin — full timeline with optional filters (R9 AC6, AC8)
    GET   /candidates/{candidate_id}/reviews           200 → list[ReviewDTO]

    # Senior (SENIOR context only) — own reviews (R9 AC10, AC8)
    GET   /candidates/{candidate_id}/reviews/mine      200 → list[ReviewDTO]

Authorization notes:
    - Candidate has NO read path at all (R9 AC8). The ``require()`` guards on
      both GET routes exclude the CANDIDATE role, so a Candidate hitting either
      endpoint receives 403 from the guard before any handler logic runs.
    - The POST route is open to both ADMIN and SENIOR so that admins can also
      record reviews (e.g. post-meeting notes). The service uses
      ``principal.account_id`` as the reviewer identity regardless of role.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, Query, Request, status

from app.modules.reviews.schemas import (
    ReviewDTO,
    ReviewFilterParams,
    SeniorReviewParams,
    SubmitReviewRequest,
)
from app.platform.security.guards import require
from app.platform.security.types import Role

if TYPE_CHECKING:
    from uuid import UUID

    from app.platform.security.principal import Principal

router = APIRouter(tags=["reviews"])


# ── Dependency helpers ────────────────────────────────────────────────────────


def _review_service(request: Request) -> Any:  # noqa: ANN401
    """Resolve ReviewService from application state."""
    return request.app.state.review_service


# ── Submit review (Admin + Senior) ────────────────────────────────────────────


@router.post(
    "/candidates/{candidate_id}/reviews",
    response_model=ReviewDTO,
    status_code=status.HTTP_201_CREATED,
    summary="Submit a review for a candidate",
    description=(
        "Append an immutable review to the candidate's timeline. "
        "Both Admins and Seniors (in any context) may submit reviews. "
        "Set ``corrects_review_id`` to mark this as a correction of a prior review "
        "by the same reviewer for the same candidate (R9 AC3, AC5). "
        "All field violations are returned together — no partial writes (R9 AC4)."
    ),
)
async def submit_review(
    candidate_id: UUID,
    data: SubmitReviewRequest,
    principal: Principal = Depends(
        require(roles=frozenset({Role.ADMIN, Role.SENIOR}))
    ),
    service: Any = Depends(_review_service),  # noqa: ANN401
) -> ReviewDTO:
    """Submit (append) a review to the candidate's timeline."""
    result: ReviewDTO = await service.submit(candidate_id, principal, data)
    return result


# ── Admin: full timeline ──────────────────────────────────────────────────────


@router.get(
    "/candidates/{candidate_id}/reviews",
    response_model=list[ReviewDTO],
    summary="Admin: list all reviews for a candidate",
    description=(
        "Returns the full review timeline for a candidate, ordered by "
        "``(created_at ASC, seq ASC)`` for a stable total order (R9 AC7). "
        "Supports optional filters: ``reviewer_id``, ``jd_id``, ``date_from``, "
        "``date_to``, and keyset pagination via ``after_seq`` + ``after_id``. "
        "Candidate role is denied by this guard (R9 AC8)."
    ),
)
async def admin_list_reviews(
    candidate_id: UUID,
    reviewer_id: UUID | None = Query(
        default=None, description="Filter by reviewer account"
    ),
    jd_id: UUID | None = Query(
        default=None, description="Filter by linked Job Description"
    ),
    date_from: str | None = Query(
        default=None, description="ISO-8601 UTC lower bound on created_at"
    ),
    date_to: str | None = Query(
        default=None, description="ISO-8601 UTC upper bound on created_at"
    ),
    after_seq: int | None = Query(
        default=None, description="Keyset cursor: seq lower bound"
    ),
    after_id: UUID | None = Query(
        default=None, description="Keyset cursor: UUID complement for equal seq"
    ),
    limit: int = Query(default=20, ge=1, le=100, description="Page size"),
    principal: Principal = Depends(
        require(roles=frozenset({Role.ADMIN}))
    ),
    service: Any = Depends(_review_service),  # noqa: ANN401
) -> list[ReviewDTO]:
    """Admin: return all reviews for a candidate with optional filters."""
    from datetime import datetime  # noqa: PLC0415

    def _parse_dt(value: str | None) -> datetime | None:
        if value is None:
            return None
        return datetime.fromisoformat(value.replace("Z", "+00:00"))

    params = ReviewFilterParams(
        reviewer_id=reviewer_id,
        jd_id=jd_id,
        date_from=_parse_dt(date_from),
        date_to=_parse_dt(date_to),
        after_seq=after_seq,
        after_id=after_id,
        limit=limit,
    )
    result: list[ReviewDTO] = await service.list_for_candidate_admin(
        candidate_id, principal, params
    )
    return result


# ── Senior: own reviews ───────────────────────────────────────────────────────


@router.get(
    "/candidates/{candidate_id}/reviews/mine",
    response_model=list[ReviewDTO],
    summary="Senior: list my own reviews for a candidate",
    description=(
        "Returns only the authenticated Senior's own reviews for a candidate, "
        "ordered by ``(created_at ASC, seq ASC)`` (R9 AC7, AC10). "
        "Requires SENIOR active context — a Senior acting as Candidate is denied. "
        "Candidate role is denied by this guard (R9 AC8)."
    ),
)
async def senior_list_own_reviews(
    candidate_id: UUID,
    after_seq: int | None = Query(
        default=None, description="Keyset cursor: seq lower bound"
    ),
    limit: int = Query(default=20, ge=1, le=100, description="Page size"),
    principal: Principal = Depends(
        require(roles=frozenset({Role.SENIOR}), context=Role.SENIOR)
    ),
    service: Any = Depends(_review_service),  # noqa: ANN401
) -> list[ReviewDTO]:
    """Senior: return only this reviewer's reviews for the given candidate."""
    params = SeniorReviewParams(after_seq=after_seq, limit=limit)
    result: list[ReviewDTO] = await service.list_own_reviews_for_candidate(
        candidate_id, principal, params
    )
    return result
