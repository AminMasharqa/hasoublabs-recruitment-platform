"""Repository layer for the reviews module (R9, Section 20).

All functions are async and accept an open ``AsyncSession``. They contain no
business logic — only SQL and mapping. The service layer coordinates transactions
via UnitOfWork.

No UPDATE or DELETE functions are defined (R9 AC3).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy import func, select, text

from app.modules.reviews.models import Review

if TYPE_CHECKING:
    from datetime import datetime
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession


async def allocate_seq(session: AsyncSession, candidate_id: UUID) -> int:
    """Allocate the next per-candidate sequence number atomically (R9 AC9).

    Uses a PostgreSQL advisory transaction lock keyed on the candidate UUID so
    that concurrent service calls for the same candidate are serialised. The lock
    is released automatically at the end of the surrounding transaction.

    The query then computes MAX(seq) + 1 (or 1 if no reviews exist yet) in the
    same serialised window, guaranteeing a monotonically increasing gap-free
    sequence per candidate.

    Args:
        session:      The active ``AsyncSession`` (must be inside a transaction).
        candidate_id: The candidate's account UUID.

    Returns:
        The next sequence number to use (≥ 1).
    """
    # Hash the UUID string to a 31-bit positive integer for pg_advisory_xact_lock.
    # The abs() + modulo ensures the key is non-negative and fits in int32.
    lock_key = abs(hash(str(candidate_id))) % (2**31)
    await session.execute(text(f"SELECT pg_advisory_xact_lock({lock_key})"))

    result = await session.execute(
        select(func.coalesce(func.max(Review.seq), 0)).where(
            Review.candidate_id == candidate_id
        )
    )
    max_seq: int = result.scalar_one()
    return max_seq + 1


async def create_review(
    session: AsyncSession,
    *,
    candidate_id: UUID,
    reviewer_account_id: UUID,
    jd_id: UUID | None,
    seq: int,
    rating_technical: int,
    rating_communication: int,
    rating_culture_fit: int,
    rating_overall: int,
    assessment: str,
    corrects_review_id: UUID | None,
) -> Review:
    """Insert a new review row and return the flushed ORM instance (R9 AC2).

    The caller must have already validated all fields and allocated ``seq`` via
    :func:`allocate_seq` inside the same transaction.

    Args:
        session:              The active ``AsyncSession``.
        candidate_id:         UUID of the candidate being reviewed.
        reviewer_account_id:  UUID of the reviewing account.
        jd_id:                Optional Job Description UUID.
        seq:                  Pre-allocated per-candidate sequence number.
        rating_technical:     Rating 1–5.
        rating_communication: Rating 1–5.
        rating_culture_fit:   Rating 1–5.
        rating_overall:       Rating 1–5.
        assessment:           Free-text assessment (1–2000 chars).
        corrects_review_id:   Optional UUID of the review this corrects.

    Returns:
        The newly persisted :class:`Review` ORM object.
    """
    review = Review(
        candidate_id=candidate_id,
        reviewer_account_id=reviewer_account_id,
        jd_id=jd_id,
        seq=seq,
        rating_technical=rating_technical,
        rating_communication=rating_communication,
        rating_culture_fit=rating_culture_fit,
        rating_overall=rating_overall,
        assessment=assessment,
        corrects_review_id=corrects_review_id,
    )
    session.add(review)
    await session.flush()
    return review


async def get_review(
    session: AsyncSession,
    review_id: UUID,
    *,
    reviewer_id: UUID | None = None,
) -> Review | None:
    """Fetch a single review by its primary key.

    Args:
        session:     The active ``AsyncSession``.
        review_id:   The review UUID to look up.
        reviewer_id: When provided, also filters on ``reviewer_account_id``.
                     Used to verify reviewer ownership (R9 AC5, AC10).

    Returns:
        The :class:`Review` if found (and owned by ``reviewer_id`` when given),
        otherwise ``None``.
    """
    stmt = select(Review).where(Review.id == review_id)
    if reviewer_id is not None:
        stmt = stmt.where(Review.reviewer_account_id == reviewer_id)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def get_review_for_candidate(
    session: AsyncSession,
    review_id: UUID,
    candidate_id: UUID,
) -> Review | None:
    """Fetch a single review verifying it belongs to a specific candidate.

    Used during correction validation to confirm both reviewer and candidate
    ownership (R9 AC5).

    Args:
        session:      The active ``AsyncSession``.
        review_id:    The review UUID.
        candidate_id: The candidate's account UUID.

    Returns:
        The :class:`Review` if found for that candidate, otherwise ``None``.
    """
    result = await session.execute(
        select(Review).where(
            Review.id == review_id,
            Review.candidate_id == candidate_id,
        )
    )
    return result.scalar_one_or_none()


async def list_reviews_for_candidate(
    session: AsyncSession,
    candidate_id: UUID,
    *,
    reviewer_id: UUID | None,
    jd_id: UUID | None,
    after_seq: int | None,
    after_id: UUID | None,
    date_from: datetime | None,
    date_to: datetime | None,
    limit: int,
) -> list[Review]:
    """Return the Admin's full review timeline for a candidate (R9 AC6, AC7).

    Results are always ordered by ``(created_at ASC, seq ASC)`` for a total
    order even when two reviews share the same timestamp (R9 AC7).

    Keyset pagination uses ``after_seq`` + ``after_id`` as the cursor. The
    compound condition ``(seq > after_seq) OR (seq = after_seq AND id > after_id)``
    provides a stable page boundary even on equal ``seq`` values.

    Args:
        session:      The active ``AsyncSession``.
        candidate_id: The candidate's account UUID.
        reviewer_id:  Optional filter: only reviews by this reviewer.
        jd_id:        Optional filter: only reviews linked to this JD.
        after_seq:    Keyset cursor lower bound on ``seq``.
        after_id:     Keyset cursor UUID complement for equal-seq disambiguation.
        date_from:    Optional inclusive lower bound on ``created_at``.
        date_to:      Optional inclusive upper bound on ``created_at``.
        limit:        Maximum rows to return.

    Returns:
        Ordered list of :class:`Review` objects.
    """
    stmt = (
        select(Review)
        .where(Review.candidate_id == candidate_id)
        .order_by(Review.created_at.asc(), Review.seq.asc())
        .limit(limit)
    )

    if reviewer_id is not None:
        stmt = stmt.where(Review.reviewer_account_id == reviewer_id)

    if jd_id is not None:
        stmt = stmt.where(Review.jd_id == jd_id)

    if date_from is not None:
        stmt = stmt.where(Review.created_at >= date_from)

    if date_to is not None:
        stmt = stmt.where(Review.created_at <= date_to)

    if after_seq is not None:
        # Stable keyset pagination on (seq, id):
        # include rows where seq > after_seq, OR seq = after_seq AND id > after_id
        if after_id is not None:
            stmt = stmt.where(
                sa.or_(
                    Review.seq > after_seq,
                    sa.and_(Review.seq == after_seq, Review.id > after_id),
                )
            )
        else:
            stmt = stmt.where(Review.seq > after_seq)

    result = await session.execute(stmt)
    return list(result.scalars().all())


async def list_senior_own_reviews_for_candidate(
    session: AsyncSession,
    reviewer_id: UUID,
    candidate_id: UUID,
    *,
    after_seq: int | None,
    limit: int,
) -> list[Review]:
    """Return a Senior's own reviews for a specific candidate (R9 AC10).

    The Senior is strictly scoped to their own ``reviewer_account_id`` — they
    can never see other reviewers' assessments.

    Args:
        session:      The active ``AsyncSession``.
        reviewer_id:  The Senior's account UUID.
        candidate_id: The candidate's account UUID.
        after_seq:    Keyset cursor — return reviews with ``seq > after_seq``.
        limit:        Maximum rows to return.

    Returns:
        Ordered list of :class:`Review` objects belonging to this reviewer.
    """
    stmt = (
        select(Review)
        .where(
            Review.reviewer_account_id == reviewer_id,
            Review.candidate_id == candidate_id,
        )
        .order_by(Review.created_at.asc(), Review.seq.asc())
        .limit(limit)
    )

    if after_seq is not None:
        stmt = stmt.where(Review.seq > after_seq)

    result = await session.execute(stmt)
    return list(result.scalars().all())


__all__ = [
    "allocate_seq",
    "create_review",
    "get_review",
    "get_review_for_candidate",
    "list_reviews_for_candidate",
    "list_senior_own_reviews_for_candidate",
]
