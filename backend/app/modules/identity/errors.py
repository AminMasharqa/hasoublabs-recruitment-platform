"""Identity domain errors (Task 12.4).

All errors derive from PlatformError so they are automatically rendered
through the one error envelope handler in app/platform/errors/handlers.py.
"""

from __future__ import annotations

from app.platform.errors.base import PlatformError


class InvalidRegistrationLink(PlatformError):
    """400 — the supplied registration token is missing, expired, or revoked."""

    error_key = "invalid_registration_link"
    status_code = 400
    message_key = "error.invalid_registration_link"


class ResidencyValidationFailed(PlatformError):
    """422 — the supplied residency proof did not pass validation."""

    error_key = "residency_validation_failed"
    status_code = 422
    message_key = "error.residency_validation_failed"

    def __init__(self, *, reason: str, log_message: str | None = None) -> None:
        super().__init__(
            details={"reason": reason},
            log_message=log_message or reason,
        )
        self.reason = reason


class InvalidVerificationCode(PlatformError):
    """422 — the submitted verification code does not match the stored hash."""

    error_key = "invalid_verification_code"
    status_code = 422
    message_key = "error.invalid_verification_code"


class VerificationCodeExpired(PlatformError):
    """422 — the verification code window has passed."""

    error_key = "verification_code_expired"
    status_code = 422
    message_key = "error.verification_code_expired"


class DuplicateEmail(PlatformError):
    """409 — an active account already exists with the same email + role."""

    error_key = "duplicate_email"
    status_code = 409
    message_key = "error.duplicate_email"


class MfaRequired(PlatformError):
    """401 — the account has MFA enrolled but no code was submitted."""

    error_key = "mfa_required"
    status_code = 401
    message_key = "error.mfa_required"


class InvalidMfaCode(PlatformError):
    """401 — the submitted TOTP code is incorrect."""

    error_key = "invalid_mfa_code"
    status_code = 401
    message_key = "error.invalid_mfa_code"


class AccountNotFound(PlatformError):
    """403 — account not found; rendered as authorization denied to prevent
    resource-existence leakage. Use AuthorizationDenied from the security layer
    when the route is a guarded endpoint; use this only in service helpers."""

    error_key = "not_authorized"
    status_code = 403
    message_key = "error.not_authorized"
