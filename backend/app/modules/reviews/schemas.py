"""Pydantic v2 schemas for the reviews module (R9, Section 20).

Public DTOs and request schemas. Import these from other modules; never import
models.py or service.py directly.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class SubmitReviewRequest(BaseModel):
    """Request body for POST /candidates/{candidate_id}/reviews (R9 AC2, AC3, AC5).

    Attributes:
        rating_technical:     Technical skill rating, 1–5 inclusive.
        rating_communication: Communication skill rating, 1–5 inclusive.
        rating_culture_fit:   Culture-fit rating, 1–5 inclusive.
        rating_overall:       Overall impression rating, 1–5 inclusive.
        assessment:           Free-text assessment, 1–2000 characters.
        jd_id:                Optional — links this review to a Job Description.
        corrects_review_id:   Optional — marks this review as a correction of a
                              prior review by the same reviewer for the same
                              candidate (R9 AC3, AC5).
    """

    rating_technical: int = Field(..., ge=1, le=5, description="Technical skill rating (1–5)")
    rating_communication: int = Field(
        ..., ge=1, le=5, description="Communication skill rating (1–5)"
    )
    rating_culture_fit: int = Field(..., ge=1, le=5, description="Culture-fit rating (1–5)")
    rating_overall: int = Field(..., ge=1, le=5, description="Overall impression rating (1–5)")
    assessment: str = Field(..., min_length=1, max_length=2000, description="Free-text assessment")
    jd_id: UUID | None = Field(default=None, description="Optional linked Job Description ID")
    corrects_review_id: UUID | None = Field(
        default=None,
        description=(
            "ID of a prior review by the same reviewer for the same candidate "
            "that this review corrects (R9 AC5). Must belong to this reviewer."
        ),
    )


class ReviewDTO(BaseModel):
    """Read model returned from all review endpoints (R9 AC2).

    Attributes:
        id:                   Review UUID.
        candidate_id:         UUID of the reviewed candidate account.
        reviewer_account_id:  UUID of the reviewer (Senior or Admin) account.
        jd_id:                Optional linked Job Description UUID.
        seq:                  Per-candidate monotonic sequence number (R9 AC9).
        rating_technical:     Technical rating, 1–5.
        rating_communication: Communication rating, 1–5.
        rating_culture_fit:   Culture-fit rating, 1–5.
        rating_overall:       Overall rating, 1–5.
        assessment:           Free-text assessment text.
        corrects_review_id:   UUID of the review this corrects, if any (R9 AC3).
        created_at:           UTC timestamp of submission (R9 AC2).
    """

    id: UUID
    candidate_id: UUID
    reviewer_account_id: UUID
    jd_id: UUID | None
    seq: int
    rating_technical: int
    rating_communication: int
    rating_culture_fit: int
    rating_overall: int
    assessment: str
    corrects_review_id: UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ReviewFilterParams(BaseModel):
    """Query parameters for the Admin's full-timeline GET endpoint (R9 AC6).

    All filters are optional and combinable. When none are provided, all reviews
    for the candidate are returned ordered by (created_at ASC, seq ASC).

    Attributes:
        reviewer_id: Filter to reviews by a specific reviewer account.
        jd_id:       Filter to reviews linked to a specific Job Description.
        date_from:   Include only reviews created at or after this UTC instant.
        date_to:     Include only reviews created at or before this UTC instant.
        after_seq:   Keyset cursor — return reviews with seq > after_seq
                     (used together with after_id for a stable page boundary).
        after_id:    Keyset cursor UUID complement — disambiguates equal seq values.
        limit:       Maximum number of reviews to return (1–100, default 20).
    """

    reviewer_id: UUID | None = Field(default=None)
    jd_id: UUID | None = Field(default=None)
    date_from: datetime | None = Field(default=None)
    date_to: datetime | None = Field(default=None)
    after_seq: int | None = Field(default=None)
    after_id: UUID | None = Field(default=None)
    limit: int = Field(default=20, ge=1, le=100)


class SeniorReviewParams(BaseModel):
    """Query parameters for the Senior's own-reviews GET endpoint (R9 AC10).

    Attributes:
        after_seq: Keyset cursor — return reviews with seq > after_seq.
        limit:     Maximum number of reviews to return (1–100, default 20).
    """

    after_seq: int | None = Field(default=None)
    limit: int = Field(default=20, ge=1, le=100)


__all__ = [
    "ReviewDTO",
    "ReviewFilterParams",
    "SeniorReviewParams",
    "SubmitReviewRequest",
]
