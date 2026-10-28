"""ORM models for the reviews module (R9, Section 20).

Tables:
- reviews: immutable review rows; no UPDATE or DELETE (R9 AC3)
"""

from __future__ import annotations

from datetime import datetime
import uuid

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, UtcTimestampMs, UuidPkMixin, utc_now


class Review(UuidPkMixin, Base):
    """An immutable review submitted by a Senior (or Admin) for a Candidate (R9).

    Design invariants:
    * No UPDATE or DELETE — enforced by the migration DDL (REVOKE UPDATE, DELETE).
    * Corrections are new rows that carry ``corrects_review_id`` (R9 AC3).
    * ``seq`` is a per-candidate monotonic integer allocated by the service via
      a PostgreSQL advisory lock + MAX(seq)+1 (R9 AC9).
    * Timeline ordering is always ``(created_at ASC, seq ASC)`` — ``seq`` breaks
      ties on equal timestamps (R9 AC7).
    """

    __tablename__ = "reviews"

    # ── Ownership ─────────────────────────────────────────────────────────────
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    reviewer_account_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # ── Optional JD linkage ───────────────────────────────────────────────────
    jd_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("job_descriptions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # ── Per-candidate monotonic sequence number ───────────────────────────────
    # Allocated in the service layer via pg_advisory_xact_lock + MAX(seq)+1
    # so concurrent inserts for the same candidate are serialised (R9 AC9).
    seq: Mapped[int] = mapped_column(
        sa.Integer,
        nullable=False,
    )

    # ── Ratings (1–5, enforced by both Pydantic and DB CHECK) ─────────────────
    rating_technical: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    rating_communication: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    rating_culture_fit: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    rating_overall: Mapped[int] = mapped_column(sa.Integer, nullable=False)

    # ── Free-text assessment (1–2000 chars) ───────────────────────────────────
    assessment: Mapped[str] = mapped_column(sa.Text, nullable=False)

    # ── Correction linkage (self-referential, nullable) ───────────────────────
    corrects_review_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("reviews.id", ondelete="SET NULL"),
        nullable=True,
    )

    # ── Immutable timestamp ───────────────────────────────────────────────────
    created_at: Mapped[datetime] = mapped_column(
        UtcTimestampMs,
        nullable=False,
        default=utc_now,
        server_default=sa.func.now(),
    )

    __table_args__ = (
        # ── DB-level rating bounds ────────────────────────────────────────────
        sa.CheckConstraint(
            "rating_technical BETWEEN 1 AND 5",
            name="ck_reviews_rating_technical_range",
        ),
        sa.CheckConstraint(
            "rating_communication BETWEEN 1 AND 5",
            name="ck_reviews_rating_communication_range",
        ),
        sa.CheckConstraint(
            "rating_culture_fit BETWEEN 1 AND 5",
            name="ck_reviews_rating_culture_fit_range",
        ),
        sa.CheckConstraint(
            "rating_overall BETWEEN 1 AND 5",
            name="ck_reviews_rating_overall_range",
        ),
        # ── Assessment length ─────────────────────────────────────────────────
        sa.CheckConstraint(
            "char_length(assessment) BETWEEN 1 AND 2000",
            name="ck_reviews_assessment_length",
        ),
        # ── seq uniqueness per candidate ──────────────────────────────────────
        sa.UniqueConstraint(
            "candidate_id",
            "seq",
            name="uq_reviews_candidate_id_seq",
        ),
        # ── Timeline query index: (candidate_id, created_at ASC, seq ASC) ─────
        sa.Index(
            "idx_reviews_candidate_id_created_at_seq",
            "candidate_id",
            "created_at",
            "seq",
        ),
        # ── Senior's own-reviews lookup index ────────────────────────────────
        sa.Index(
            "idx_reviews_reviewer_account_id_candidate_id",
            "reviewer_account_id",
            "candidate_id",
        ),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<Review id={self.id!s} candidate_id={self.candidate_id!s} "
            f"reviewer_account_id={self.reviewer_account_id!s} seq={self.seq}>"
        )


__all__ = ["Review"]
