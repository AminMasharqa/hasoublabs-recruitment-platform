"""The single error envelope every non-2xx response uses.

Shape (design: One Error Envelope)::

    {
      "error": "validation_failed",
      "message": "<localized>",
      "fields": [{"path": "phone_number", "code": "invalid_e164", "message": "..."}],
      "details": {"unmet": ["profile_complete"]},
      "request_id": "…",
      "retryable": false
    }

``error`` and ``code`` are stable machine keys; ``message`` is localized. Keys
never change with the locale, so the frontend contract is independent of
translation work.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, ConfigDict, Field

from app.platform.i18n.catalog import has_message, translate

if TYPE_CHECKING:
    from collections.abc import Sequence

    from app.platform.errors.base import FieldViolation, PlatformError


class FieldError(BaseModel):
    """One field-level error, addressable by a form library."""

    model_config = ConfigDict(frozen=True)

    path: str = Field(description="JSON-pointer-style path, e.g. education[2].start_date")
    code: str = Field(description="Stable machine sub-code, e.g. end_before_start")
    message: str = Field(description="Localized, human-readable message")


class ErrorEnvelope(BaseModel):
    """The one response body shape for every non-2xx response."""

    model_config = ConfigDict(frozen=True)

    error: str
    message: str
    fields: list[FieldError] | None = None
    details: dict[str, Any] | None = None
    request_id: str | None = None
    retryable: bool = False

    def to_payload(self) -> dict[str, Any]:
        """Serialize, omitting absent optional members."""
        return self.model_dump(exclude_none=True)


def render_field_errors(
    violations: Sequence[FieldViolation],
    locale: str | None = None,
) -> list[FieldError]:
    """Localize field violations, falling back to the machine sub-code."""
    rendered: list[FieldError] = []
    for violation in violations:
        message = (
            translate(violation.message_key, locale, **dict(violation.params))
            if has_message(violation.message_key, locale)
            else violation.code
        )
        rendered.append(
            FieldError(path=violation.path, code=violation.code, message=message)
        )
    return rendered


def build_envelope(
    exc: PlatformError,
    *,
    locale: str | None = None,
    request_id: str | None = None,
) -> ErrorEnvelope:
    """Build the envelope for a :class:`PlatformError`."""
    return ErrorEnvelope(
        error=exc.error_key,
        message=translate(exc.message_key, locale, **dict(exc.params)),
        fields=render_field_errors(exc.fields, locale) or None,
        details=dict(exc.details) or None,
        request_id=request_id,
        retryable=exc.retryable,
    )


def build_raw_envelope(
    *,
    error_key: str,
    locale: str | None = None,
    request_id: str | None = None,
    retryable: bool = False,
    fields: Sequence[FieldViolation] | None = None,
    details: dict[str, Any] | None = None,
) -> ErrorEnvelope:
    """Build an envelope for a non-:class:`PlatformError` condition.

    Used for framework-raised failures (unmatched route, unsupported media type,
    unhandled exception) so those responses share the one contract too.
    """
    return ErrorEnvelope(
        error=error_key,
        message=translate(f"error.{error_key}", locale),
        fields=render_field_errors(fields or (), locale) or None,
        details=details or None,
        request_id=request_id,
        retryable=retryable,
    )
