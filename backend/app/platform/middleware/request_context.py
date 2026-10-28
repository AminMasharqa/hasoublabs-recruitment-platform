"""Request-context ASGI middleware: request id, timing, locale, OTel attributes.

Deliberately a *pure ASGI* middleware rather than a ``BaseHTTPMiddleware``
subclass: Starlette runs ``BaseHTTPMiddleware.dispatch`` in a separate task from
the endpoint, so ``ContextVar`` values set there are invisible to the handler,
the service layer, and the audit listener. A pure ASGI middleware runs in the
same task, which is what makes :mod:`app.platform.middleware.context` work at
all.

It also records ``request.state.start_time`` from a monotonic clock at the
outermost point of the request, which is the reference the constant-time
authorization-denial floor measures against (design: Constant-Time
Authorization Denial, Section 4).
"""

from __future__ import annotations

import re
import time
from typing import TYPE_CHECKING, Final

from starlette.datastructures import Headers, MutableHeaders

from app.platform.i18n.locales import negotiate_locale
from app.platform.middleware.context import (
    bind_request_context,
    new_request_id,
    reset_request_context,
)

if TYPE_CHECKING:
    from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUEST_ID_HEADER: Final[str] = "x-request-id"
CONTENT_LANGUAGE_HEADER: Final[str] = "content-language"

#: An inbound request id is echoed into logs and audit rows, so it is treated as
#: untrusted input: bounded length, no control characters, no header injection.
_SAFE_REQUEST_ID: Final[re.Pattern[str]] = re.compile(r"\A[A-Za-z0-9._:-]{8,64}\Z")


def sanitize_request_id(value: str | None) -> str | None:
    """Return ``value`` when it is a safe request id, otherwise ``None``."""
    if value is None:
        return None
    candidate = value.strip()
    return candidate if _SAFE_REQUEST_ID.match(candidate) else None


class RequestContextMiddleware:
    """Bind per-request ambient context and echo the request id back.

    Args:
        app: The next ASGI application in the stack.
        trust_inbound_request_id: Accept a caller-supplied ``X-Request-ID`` so a
            trace can span the reverse proxy. Enable only when the edge strips
            client-supplied values; otherwise a client can collide ids.
    """

    def __init__(self, app: ASGIApp, *, trust_inbound_request_id: bool = False) -> None:
        self._app = app
        self._trust_inbound = trust_inbound_request_id

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return

        started_at = time.monotonic()
        headers = Headers(scope=scope)

        request_id: str | None = None
        if self._trust_inbound:
            request_id = sanitize_request_id(headers.get(REQUEST_ID_HEADER))
        request_id = request_id or new_request_id()

        locale = negotiate_locale(accept_language=headers.get("accept-language"))

        state = scope.setdefault("state", {})
        state["request_id"] = request_id
        state["start_time"] = started_at
        state["locale"] = locale

        self._annotate_span(request_id=request_id, locale=locale)

        async def send_with_context(message: Message) -> None:
            if message["type"] == "http.response.start":
                response_headers = MutableHeaders(scope=message)
                response_headers.setdefault(REQUEST_ID_HEADER, request_id)
                response_headers.setdefault(CONTENT_LANGUAGE_HEADER, locale)
                response_headers.append("vary", "Accept-Language")
            await send(message)

        tokens = bind_request_context(
            request_id=request_id,
            locale=locale,
            started_at=started_at,
        )
        try:
            await self._app(scope, receive, send_with_context)
        finally:
            reset_request_context(tokens)

    @staticmethod
    def _annotate_span(*, request_id: str, locale: str) -> None:
        """Attach correlation attributes to the active OpenTelemetry span.

        Kept best-effort: observability must never fail a request.
        """
        try:
            from opentelemetry import trace  # noqa: PLC0415
        except ImportError:  # pragma: no cover - OTel is a hard dependency
            return
        span = trace.get_current_span()
        if not span.is_recording():
            return
        span.set_attribute("hasoub.request_id", request_id)
        span.set_attribute("hasoub.locale", locale)
