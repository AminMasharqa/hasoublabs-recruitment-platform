"""Domain error types for the applications module (R7, Section 18)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.platform.errors.base import PlatformError

if TYPE_CHECKING:
    from collections.abc import Sequence


class ApplicationNotReady(PlatformError):  # noqa: N818
    """422 — Candidate is not Application-Ready; missing_fields lists what's missing.

    Raised when a candidate tries to apply but their profile is incomplete (no CV,
    missing required fields, etc.) — R7 AC1, AC2.
    """

    error_key = "application_not_ready"
    status_code = 422
    message_key = "error.application_not_ready"

    def __init__(
        self,
        *,
        missing_fields: list[str],
        log_message: str | None = None,
    ) -> None:
        super().__init__(
            details={"missing_fields": missing_fields},
            log_message=log_message,
        )
        self.missing_fields = missing_fields


class DuplicateApplication(PlatformError):  # noqa: N818
    """409 — a non-terminal application already exists for this candidate+JD pair.

    Raised when a candidate attempts to apply to a job they already have a
    Submitted or Under Review application for — R7 AC7.
    """

    error_key = "duplicate_application"
    status_code = 409
    message_key = "error.duplicate_application"


class JdNotOpen(PlatformError):  # noqa: N818
    """422 — the JD is not Open; application cannot be submitted.

    Raised when the target Job_Description is in Draft or Closed state — R7 AC3.
    """

    error_key = "jd_not_open"
    status_code = 422
    message_key = "error.jd_not_open"


__all__ = ["ApplicationNotReady", "DuplicateApplication", "JdNotOpen"]
