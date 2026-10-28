"""Exception handlers that render every failure through the one error envelope.

Registered by the app factory (Section 22.1). ``AuthorizationDenied`` is
intentionally left to Section 4's own handler: FastAPI resolves handlers by
walking the exception's MRO from most to least specific, so a dedicated
``AuthorizationDenied`` handler wins over the :class:`PlatformError` handler
here and keeps the fixed-latency denial path intact.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, Final

from fastapi import status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import ORJSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.platform.errors.base import FieldViolation, PlatformError, ValidationFailed
from app.platform.errors.envelope import build_envelope, build_raw_envelope
from app.platform.i18n.locales import negotiate_locale
from app.platform.middleware.context import current_locale, current_request_id

if TYPE_CHECKING:
    from collections.abc import Sequence

    from fastapi import FastAPI, Request
    from starlette.responses import Response

_LOG = logging.getLogger(__name__)

_SERVER_ERROR_FLOOR: Final[int] = 500

#: Framework-raised statuses mapped onto stable machine keys.
_ERROR_KEY_BY_STATUS: Final[dict[int, str]] = {
    status.HTTP_400_BAD_REQUEST: "bad_request",
    status.HTTP_401_UNAUTHORIZED: "authentication_required",
    status.HTTP_403_FORBIDDEN: "not_authorized",
    status.HTTP_404_NOT_FOUND: "not_found",
    status.HTTP_405_METHOD_NOT_ALLOWED: "method_not_allowed",
    status.HTTP_409_CONFLICT: "conflicting_state",
    status.HTTP_415_UNSUPPORTED_MEDIA_TYPE: "unsupported_media_type",
    status.HTTP_422_UNPROCESSABLE_ENTITY: "validation_failed",
    status.HTTP_429_TOO_MANY_REQUESTS: "rate_limited",
    status.HTTP_500_INTERNAL_SERVER_ERROR: "internal_server_error",
    status.HTTP_503_SERVICE_UNAVAILABLE: "upstream_unavailable",
}

#: Pydantic v2 error types mapped onto our field sub-codes. Unmapped types fall
#: through as-is: a pydantic type string is itself a stable machine key.
_FIELD_CODE_BY_PYDANTIC_TYPE: Final[dict[str, str]] = {
    "missing": "required",
    "string_too_long": "too_long",
    "string_too_short": "too_short",
    "string_pattern_mismatch": "invalid",
    "value_error": "invalid",
    "assertion_error": "invalid",
    "enum": "invalid_enum",
    "literal_error": "invalid_enum",
    "greater_than": "out_of_range",
    "greater_than_equal": "out_of_range",
    "less_than": "out_of_range",
    "less_than_equal": "out_of_range",
    "too_long": "too_long",
    "too_short": "too_short",
    "url_parsing": "invalid_url",
    "url_scheme": "invalid_url",
    "url_too_long": "invalid_url",
}

_BODY_SOURCES: Final[frozenset[str]] = frozenset({"body"})


def register_error_handlers(app: FastAPI) -> None:
    """Register the envelope handlers on ``app``."""
    app.add_exception_handler(PlatformError, _platform_error_handler)
    app.add_exception_handler(RequestValidationError, _request_validation_handler)
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)
    app.add_exception_handler(Exception, _unhandled_exception_handler)


# ── Handlers ──────────────────────────────────────────────────────────────────


async def _platform_error_handler(request: Request, exc: Exception) -> Response:
    error = _as_platform_error(exc)
    locale = _locale_for(request)
    request_id = _request_id_for(request)

    if error.status_code >= _SERVER_ERROR_FLOOR:
        _LOG.error(
            "%s (request_id=%s): %s",
            error.error_key,
            request_id,
            error.log_message or "-",
            exc_info=error,
        )
    else:
        _LOG.info("%s (request_id=%s)", error.error_key, request_id)

    envelope = build_envelope(error, locale=locale, request_id=request_id)
    return ORJSONResponse(
        status_code=error.status_code,
        content=envelope.to_payload(),
        headers=dict(error.headers) or None,
    )


async def _request_validation_handler(request: Request, exc: Exception) -> Response:
    violations = (
        _violations_from_pydantic(exc.errors())
        if isinstance(exc, RequestValidationError)
        else ()
    )
    return await _platform_error_handler(request, ValidationFailed(fields=violations))


async def _http_exception_handler(request: Request, exc: Exception) -> Response:
    http_status = getattr(exc, "status_code", status.HTTP_500_INTERNAL_SERVER_ERROR)
    headers = getattr(exc, "headers", None) or {}
    error_key = _ERROR_KEY_BY_STATUS.get(http_status, "http_error")
    envelope = build_raw_envelope(
        error_key=error_key,
        locale=_locale_for(request),
        request_id=_request_id_for(request),
        retryable=http_status in {status.HTTP_503_SERVICE_UNAVAILABLE},
    )
    return ORJSONResponse(
        status_code=http_status,
        content=envelope.to_payload(),
        headers=dict(headers) or None,
    )


async def _unhandled_exception_handler(request: Request, exc: Exception) -> Response:
    """Return a bare 500: a machine key, a localized message, and the request id.

    An exception message can carry a national ID or a file path, so it is logged
    and never serialized (design: Failure Policies).
    """
    request_id = _request_id_for(request)
    _LOG.exception("Unhandled error (request_id=%s)", request_id, exc_info=exc)
    envelope = build_raw_envelope(
        error_key="internal_server_error",
        locale=_locale_for(request),
        request_id=request_id,
    )
    return ORJSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=envelope.to_payload(),
    )


# ── Helpers ───────────────────────────────────────────────────────────────────


def _as_platform_error(exc: Exception) -> PlatformError:
    if isinstance(exc, PlatformError):
        return exc
    return PlatformError(log_message=repr(exc))


def _locale_for(request: Request) -> str:
    """Resolve the response locale, preferring the context bound by middleware."""
    locale = current_locale()
    if locale:
        return locale
    state_locale = getattr(request.state, "locale", None)
    if isinstance(state_locale, str):
        return state_locale
    return negotiate_locale(accept_language=request.headers.get("accept-language"))


def _request_id_for(request: Request) -> str | None:
    request_id = current_request_id()
    if request_id:
        return request_id
    state_request_id = getattr(request.state, "request_id", None)
    return state_request_id if isinstance(state_request_id, str) else None


def _violations_from_pydantic(
    errors: Sequence[dict[str, Any]],
) -> tuple[FieldViolation, ...]:
    """Convert pydantic errors into the envelope's field violations.

    Every violated field is reported, never just the first — R1 AC9, R2 AC3,
    R4 AC8, R5 AC2, R7 AC2 and R9 AC4 all say "each"/"every".
    """
    violations: list[FieldViolation] = []
    for error in errors:
        loc = tuple(error.get("loc", ()))
        raw_type = str(error.get("type", "invalid"))
        violations.append(
            FieldViolation(
                path=_loc_to_path(loc),
                code=_FIELD_CODE_BY_PYDANTIC_TYPE.get(raw_type, raw_type),
            )
        )
    return tuple(violations)


def _loc_to_path(loc: Sequence[Any]) -> str:
    """Render a pydantic ``loc`` tuple as ``education[2].graduation_year``.

    A non-body source is kept as the first path segment (``query.page_size``) so
    the client can tell a bad query parameter from a bad body field.
    """
    parts = list(loc)
    if parts and str(parts[0]) in _BODY_SOURCES:
        parts = parts[1:]
    if not parts:
        return "$"
    path = str(parts[0])
    for part in parts[1:]:
        path += f"[{part}]" if isinstance(part, int) else f".{part}"
    return path
