"""Platform error taxonomy, the one error envelope, and its handlers."""

from app.platform.errors.base import (
    AccountNotApproved,
    AuthenticationRequired,
    CodeEntryLocked,
    ConflictingState,
    FieldViolation,
    IllegalTransition,
    IntegrityViolation,
    PlatformError,
    PreconditionUnmet,
    RateLimited,
    UpstreamUnavailable,
    ValidationFailed,
)
from app.platform.errors.envelope import (
    ErrorEnvelope,
    FieldError,
    build_envelope,
    build_raw_envelope,
)
from app.platform.errors.handlers import register_error_handlers

__all__ = [
    "AccountNotApproved",
    "AuthenticationRequired",
    "CodeEntryLocked",
    "ConflictingState",
    "ErrorEnvelope",
    "FieldError",
    "FieldViolation",
    "IllegalTransition",
    "IntegrityViolation",
    "PlatformError",
    "PreconditionUnmet",
    "RateLimited",
    "UpstreamUnavailable",
    "ValidationFailed",
    "build_envelope",
    "build_raw_envelope",
    "register_error_handlers",
]
