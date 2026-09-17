"""Request middleware: ambient context, request id, locale, OTel, rate limiting.

Wiring (Section 22.1) installs these outermost-first::

    app.add_middleware(RateLimitMiddleware, limiter=limiter, rule=global_rule)
    app.add_middleware(RequestContextMiddleware)

``RequestContextMiddleware`` must be the innermost of the two so the 429 the
rate limiter renders still carries a request id and the negotiated locale.
"""

from app.platform.middleware.context import (
    ANONYMOUS_ACTOR,
    SYSTEM_ACTOR,
    Actor,
    bind_request_context,
    current_actor,
    current_locale,
    current_reason,
    current_request_id,
    new_request_id,
    request_started_at,
    reset_request_context,
    set_actor,
    set_locale,
    set_reason,
    use_actor,
    use_reason,
    use_system_actor,
)
from app.platform.middleware.rate_limit import (
    LOGIN_PER_ACCOUNT,
    LOGIN_PER_SOURCE,
    REGISTRATION_PER_SOURCE,
    VERIFICATION_RESEND_PER_ACCOUNT,
    RateLimitDecision,
    RateLimiter,
    RateLimitMiddleware,
    RateLimitRule,
    application_rule,
    configure_rate_limiter,
    cv_upload_rule,
    get_rate_limiter,
    global_request_rule,
    rate_limit,
)
from app.platform.middleware.request_context import RequestContextMiddleware

__all__ = [
    "ANONYMOUS_ACTOR",
    "LOGIN_PER_ACCOUNT",
    "LOGIN_PER_SOURCE",
    "REGISTRATION_PER_SOURCE",
    "SYSTEM_ACTOR",
    "VERIFICATION_RESEND_PER_ACCOUNT",
    "Actor",
    "RateLimitDecision",
    "RateLimitMiddleware",
    "RateLimitRule",
    "RateLimiter",
    "RequestContextMiddleware",
    "application_rule",
    "bind_request_context",
    "configure_rate_limiter",
    "current_actor",
    "current_locale",
    "current_reason",
    "current_request_id",
    "cv_upload_rule",
    "get_rate_limiter",
    "global_request_rule",
    "new_request_id",
    "rate_limit",
    "request_started_at",
    "reset_request_context",
    "set_actor",
    "set_locale",
    "set_reason",
    "use_actor",
    "use_reason",
    "use_system_actor",
]
