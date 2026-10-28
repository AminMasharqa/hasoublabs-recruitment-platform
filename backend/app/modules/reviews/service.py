"""Service layer for the reviews module (R9, Section 20).

Domain logic and transaction orchestration. No FastAPI imports live here.
All writes go through UnitOfWork so failures roll back atomically (R9 AC4).
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from app.modules.reviews import repository as repo
from app.modules.reviews.errors import ReviewCorrectionNotAllowed
from app.modules.reviews.schemas import (
    ReviewDTO,
    ReviewFilterParams,
    SeniorReviewParams,
    SubmitReviewRequest,
)
from app.platform.errors.base import FieldViolation, ValidationFailed

if TYPE_CHECKING:
    from uuid import UUID

    from app.modules.reviews.models import Review
    from app.platform.security.principal import Principal

_LOG = logging.getLogger(__name__)


def _review_to_dto(review: Review) -> ReviewDTO:
    """Map an ORM :class:`Review` to a :class:`ReviewDTO`."""
    return ReviewDTO(
        id=review.id,
        candidate_id=review.candidate_id,
        reviewer_account_id=review.reviewer_account_id,
        jd_id=review.jd_id,
        seq=review.seq,
        rating_technical=review.rating_technical,
        rating_communication=review.rating_communication,
        rating_culture_fit=review.rating_culture_fit,
        rating_overall=review.rating_overall,
        assessment=review.assessment,
        corrects_review_id=review.corrects_review_id,
        created_at=review.created_at,
    )


def _validate_submit(data: SubmitReviewRequest) -> None:
    """Collect ALL field violations before raising (R9 AC4).

    Validates each rating (1–5) and the assessment (non-empty, max 2000 chars).
    Raises :class:`ValidationFailed` with the complete violation list if any
    constraint is broken — never raises on the first error alone.

    Note: Pydantic already enforces ``ge=1, le=5`` and ``min_length=1,
    max_length=2000`` at request-parse time. This second pass happens in
    the service so the service-layer contract is self-contained and testable
    without HTTP transport.

    Args:
        data: The submitted review payload.

    Raises:
        ValidationFailed: If any field fails validation.
    """
    violations: list[FieldViolation] = []

    ratings = {
        "rating_technical": data.rating_technical,
        "rating_communication": data.rating_communication,
        "rating_culture_fit": data.rating_culture_fit,
        "rating_overall": data.rating_overall,
    }
    for field_name, value in ratings.items():
        if not (1 <= value <= 5):
            violations.append(
                FieldViolation(
                    path=field_name,
                    code="rating_out_of_range",
                    params={"min": 1, "max": 5},
                )
            )

    # Assessment: non-empty after stripping whitespace
    if not data.assessment.strip():
        violations.append(FieldViolation(path="assessment", code="required"))
    elif len(data.assessment) > 2000:
        violations.append(
            FieldViolation(path="assessment", code="too_long", params={"max": 2000})
        )

    if violations:
        raise ValidationFailed(fields=violations)


class ReviewService:
    """Orchestrates review submission and timeline queries (R9).

    All write operations use a UnitOfWork so any failure rolls back completely
    with no intermediate state persisted (R9 AC4).

    Args:
        uow_factory: Zero-argument callable that returns a new :class:`UnitOfWork`.
    """

    def __init__(self, uow_factory: Any) -> None:  # noqa: ANN401
        self._uow_factory = uow_factory

    async def submit(
        self,
        candidate_id: UUID,
        principal: Principal,
        data: SubmitReviewRequest,
    ) -> ReviewDTO:
        """Submit (append) a review to the candidate's timeline.

        Steps (all validation happens before any write — R9 AC4):
        1. Validate all fields; collect every violation.
        2. If ``corrects_review_id`` is provided, verify it belongs to the same
           reviewer AND the same candidate (R9 AC5). Raises
           :class:`ReviewCorrectionNotAllowed` (422) on failure.
        3. Allocate the next ``seq`` via advisory lock + MAX+1 (R9 AC9).
        4. INSERT the review row.
        5. Return :class:`ReviewDTO`.

        Args:
            candidate_id: The UUID of the candidate being reviewed.
            principal:    The authenticated principal (Admin or Senior).
            data:         The submitted review payload.

        Returns:
            The newly created :class:`ReviewDTO`.

        Raises:
            ValidationFailed:           Any field is invalid (R9 AC4).
            ReviewCorrectionNotAllowed: ``corrects_review_id`` belongs to a
                                        different reviewer or candidate (R9 AC5).
        """
        # Step 1 — validate all fields; collect all violations before any DB call.
        _validate_submit(data)

        async with self._uow_factory() as uow:
            # Step 2 — correction ownership check (R9 AC5).
            if data.corrects_review_id is not None:
                prior = await repo.get_review_for_candidate(
                    uow.session,
                    data.corrects_review_id,
                    candidate_id,
                )
                if prior is None:
                    # The referenced review does not exist for this candidate.
                    raise ReviewCorrectionNotAllowed(
                        log_message=(
                            f"corrects_review_id {data.corrects_review_id} not found "
                            f"for candidate {candidate_id}"
                        )
                    )
                if prior.reviewer_account_id != principal.account_id:
                    # The referenced review belongs to a different reviewer.
                    raise ReviewCorrectionNotAllowed(
                        log_message=(
                            f"corrects_review_id {data.corrects_review_id} belongs to "
                            f"reviewer {prior.reviewer_account_id}, "
                            f"not {principal.account_id}"
                        )
                    )

            # Step 3 — allocate seq under advisory lock (R9 AC9).
            seq = await repo.allocate_seq(uow.session, candidate_id)

            # Step 4 — insert the review row.
            review = await repo.create_review(
                uow.session,
                candidate_id=candidate_id,
                reviewer_account_id=principal.account_id,
                jd_id=data.jd_id,
                seq=seq,
                rating_technical=data.rating_technical,
                rating_communication=data.rating_communication,
                rating_culture_fit=data.rating_culture_fit,
                rating_overall=data.rating_overall,
                assessment=data.assessment,
                corrects_review_id=data.corrects_review_id,
            )

            # Capture the DTO while the session is still open (avoids lazy-load
            # after session close).
            dto = _review_to_dto(review)

        # Step 5 — return the DTO (UoW has committed at this point).
        return dto

    async def list_for_candidate_admin(
        self,
        candidate_id: UUID,
        principal: Principal,  # noqa: ARG002 — guard already asserted ADMIN role
        params: ReviewFilterParams,
    ) -> list[ReviewDTO]:
        """Admin: all reviews for a candidate with optional filters (R9 AC6).

        The guard on the router enforces that only ADMIN callers reach here, so
        ``principal`` is accepted but not used for additional scoping.

        Args:
            candidate_id: The candidate's account UUID.
            principal:    The authenticated Admin principal.
            params:       Optional filter and pagination parameters.

        Returns:
            Ordered list of :class:`ReviewDTO` — ``(created_at ASC, seq ASC)`` (R9 AC7).
        """
        async with self._uow_factory() as uow:
            reviews = await repo.list_reviews_for_candidate(
                uow.session,
                candidate_id,
                reviewer_id=params.reviewer_id,
                jd_id=params.jd_id,
                after_seq=params.after_seq,
                after_id=params.after_id,
                date_from=params.date_from,
                date_to=params.date_to,
                limit=params.limit,
            )
        return [_review_to_dto(r) for r in reviews]

    async def list_own_reviews_for_candidate(
        self,
        candidate_id: UUID,
        principal: Principal,
        params: SeniorReviewParams,
    ) -> list[ReviewDTO]:
        """Senior: only their own reviews for this candidate (R9 AC10).

        Scopes the query strictly to ``reviewer_account_id = principal.account_id``
        so a Senior can never access other reviewers' assessments.

        Args:
            candidate_id: The candidate's account UUID.
            principal:    The authenticated Senior principal.
            params:       Optional pagination parameters.

        Returns:
            Ordered list of :class:`ReviewDTO` — only this reviewer's rows.
        """
        async with self._uow_factory() as uow:
            reviews = await repo.list_senior_own_reviews_for_candidate(
                uow.session,
                reviewer_id=principal.account_id,
                candidate_id=candidate_id,
                after_seq=params.after_seq,
                limit=params.limit,
            )
        return [_review_to_dto(r) for r in reviews]


__all__ = ["ReviewService"]
