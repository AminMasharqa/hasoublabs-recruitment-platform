"""Domain error types for the profiles module (Task 15.4)."""

from __future__ import annotations

from app.platform.errors.base import FieldViolation, PlatformError  # noqa: F401 – re-exported


class ProfileValidationFailed(PlatformError):
    """422 — one or more profile fields failed validation.

    Raised by the service layer when field-level or cross-field checks fail.
    Always carries the complete list of violations so the client can annotate
    every invalid input at once rather than discovering errors one at a time.
    """

    error_key = "profile_validation_failed"
    status_code = 422
    message_key = "error.profile_validation_failed"


class SkillLimitExceeded(PlatformError):
    """422 — the candidate tried to add more than 20 skills (R4 AC4).

    Separate from ProfileValidationFailed so the client can show a targeted
    "you've reached the skill limit" message without parsing field paths.
    """

    error_key = "skill_limit_exceeded"
    status_code = 422
    message_key = "error.skill_limit_exceeded"


class ContactPreferenceInvalid(PlatformError):
    """422 — the Senior submitted an inconsistent contact-preference combination.

    Raised when contact_channel_pref != 'None' but contact_scope_pref is absent,
    or when company_affiliation is missing for a non-None channel (R4A AC2, AC3).
    """

    error_key = "contact_preference_invalid"
    status_code = 422
    message_key = "error.contact_preference_invalid"


__all__ = [
    "ContactPreferenceInvalid",
    "FieldViolation",
    "ProfileValidationFailed",
    "SkillLimitExceeded",
]
