"""Domain error types for the CVs module (R5, Task 14.4)."""

from __future__ import annotations

from app.platform.errors.base import PlatformError


class CvLimitExceeded(PlatformError):
    """422 — account already holds the maximum number of active CV variants."""

    error_key = "cv_limit_exceeded"
    status_code = 422
    message_key = "error.cv_limit_exceeded"


class LastVariantError(PlatformError):
    """422 — cannot archive the last remaining active variant.

    At least one active variant must exist so the candidate always has a CV to
    attach to an application (R5 AC1).
    """

    error_key = "last_variant_error"
    status_code = 422
    message_key = "error.last_variant_error"


class CvUploadValidationFailed(PlatformError):
    """422 — the uploaded file failed size, MIME, or structural validation.

    Raised before any object is written to storage, so no cleanup is needed.
    """

    error_key = "cv_upload_validation_failed"
    status_code = 422
    message_key = "error.cv_upload_validation_failed"


class CvIntegrityError(PlatformError):
    """500 — stored CV checksum does not match the database record.

    This is a server-side integrity alarm (R5 AC15), not a user error.
    Raised by the nightly sweep and by the download integrity check.
    """

    error_key = "cv_integrity_error"
    status_code = 500
    message_key = "error.cv_integrity_error"
