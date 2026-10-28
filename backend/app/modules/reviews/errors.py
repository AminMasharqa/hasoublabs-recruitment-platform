"""Domain error types for the reviews module (R9, Section 20)."""

from __future__ import annotations

from app.platform.errors.base import PlatformError

# NOTE: ReviewNotFound is intentionally NOT defined here.
# Per the constant-time authorization requirement (R3 AC6), the service layer
# always raises AuthorizationDenied rather than leaking whether a resource exists.
# Import AuthorizationDenied from app.platform.security.errors.


class ReviewCorrectionNotAllowed(PlatformError):
    """422 — corrects_review_id references a review not by this reviewer or not for this candidate.

    Raised when the reviewer attempts to mark a correction (corrects_review_id)
    that belongs to a different reviewer or a different candidate (R9 AC5).
    """

    error_key = "review_correction_not_allowed"
    status_code = 422
    message_key = "error.review_correction_not_allowed"


__all__ = ["ReviewCorrectionNotAllowed"]
