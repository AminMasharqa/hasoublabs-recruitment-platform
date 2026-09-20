"""Domain error types for the jobs module (R6)."""

from __future__ import annotations

from collections.abc import Sequence

from app.platform.errors.base import PlatformError


# NOTE: JdNotFound is intentionally NOT defined here.
# Per the constant-time authorization requirement (R3 AC6), the service layer
# always raises AuthorizationDenied rather than leaking whether a resource
# exists.  Import AuthorizationDenied from app.platform.security.errors.


class JdAlreadyClosed(PlatformError):
    """422 — the Job Description is already closed and cannot be modified."""

    error_key = "jd_already_closed"
    status_code = 422
    message_key = "error.jd_already_closed"


class JdPublishPreconditionFailed(PlatformError):
    """422 — one or more preconditions are unmet before the JD can be published.

    The ``unmet`` list names each blocking precondition so the caller can surface
    structured feedback without parsing a free-form message.
    """

    error_key = "jd_publish_precondition_failed"
    status_code = 422
    message_key = "error.jd_publish_precondition_failed"

    def __init__(self, *, unmet: Sequence[str], **kwargs: object) -> None:
        super().__init__(details={"unmet": list(unmet)}, **kwargs)  # type: ignore[arg-type]


class JdEditForbiddenWhenClosed(PlatformError):
    """422 — editing a closed Job Description is not permitted."""

    error_key = "jd_edit_forbidden_when_closed"
    status_code = 422
    message_key = "error.jd_edit_forbidden_when_closed"


class ExtractionDraftExpired(PlatformError):
    """422 — the extraction draft has passed its TTL and can no longer be confirmed."""

    error_key = "extraction_draft_expired"
    status_code = 422
    message_key = "error.extraction_draft_expired"


class SsrfGuardRejected(PlatformError):
    """422 — the submitted URL was rejected by the SSRF guard (private/reserved address)."""

    error_key = "ssrf_guard_rejected"
    status_code = 422
    message_key = "error.ssrf_guard_rejected"


__all__ = [
    "ExtractionDraftExpired",
    "JdAlreadyClosed",
    "JdEditForbiddenWhenClosed",
    "JdPublishPreconditionFailed",
    "SsrfGuardRejected",
]
