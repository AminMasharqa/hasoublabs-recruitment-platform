"""Valkey-backed rate limiting (Security constraint: rate limiting).

Two layers, because they answer different questions:

* :class:`RateLimitMiddleware` — a coarse per-source ceiling on every request,
  the cheap defence against one host hammering the API.
* :func:`rate_limit` — a per-route dependency carrying a named rule, for the four
  flows the requirements call out by name: login (per source **and** per
  account), registration submissions, CV uploads, and Application submissions.

The counter is a sliding-window log in a Valkey sorted set, evaluated inside one
Lua script so check-and-consume is atomic under concurrency. A fixed window
would let a caller spend two full windows' worth of budget across a window
boundary, which is exactly the burst a login limiter exists to stop.

Availability trade-off: when Valkey is unreachable the limiter **fails open** by
default and logs a warning, because a cache outage that locks every user out of
login is a worse failure than a briefly unenforced ceiling — the account lockout
after repeated failed logins is authoritative in PostgreSQL, not here. Set
``fail_open=False`` on a rule where the ceiling itself is the only control.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
import logging
import math
import secrets
import time
from typing import TYPE_CHECKING, Final, Literal

from app.platform.errors.base import RateLimited
from app.platform.errors.envelope import build_envelope
from app.platform.i18n.locales import negotiate_locale
from app.platform.middleware.context import current_actor

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from fastapi import FastAPI, Request
    from redis.asyncio import Redis
    from starlette.types import ASGIApp, Receive, Scope, Send

_LOG = logging.getLogger(__name__)

RateLimitSubject = Literal["source", "account", "global"]

#: Sliding-window log: drop expired entries, count, then consume a slot.
#: Returns ``{allowed, current_count, oldest_score_ms}``.
_SLIDING_WINDOW_LUA: Final[str] = """
local key = KEYS[1]
local now_ms = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now_ms - window_ms)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  return {0, count, tonumber(oldest[2])}
end
redis.call('ZADD', key, now_ms, member)
redis.call('PEXPIRE', key, window_ms)
return {1, count + 1, 0}
"""


@dataclass(frozen=True, slots=True)
class RateLimitRule:
    """A named ceiling of ``limit`` events per ``window`` for one subject."""

    name: str
    limit: int
    window: timedelta
    subject: RateLimitSubject = "source"
    fail_open: bool = True

    @property
    def window_ms(self) -> int:
        return max(1, int(self.window.total_seconds() * 1000))


@dataclass(frozen=True, slots=True)
class RateLimitDecision:
    """Outcome of consuming one slot."""

    allowed: bool
    remaining: int
    retry_after_seconds: int

    def raise_if_limited(self, rule: RateLimitRule) -> None:
        """Raise :class:`RateLimited` when the ceiling was exceeded."""
        if not self.allowed:
            raise RateLimited(
                retry_after_seconds=self.retry_after_seconds,
                scope=rule.name,
            )


# ── Default rule set ──────────────────────────────────────────────────────────
#
# The login and registration ceilings are not represented in `Settings` yet
# (that file belongs to Task 1). They live here as named constants so the numbers
# are reviewable in one place; folding them into `Settings` is a one-line
# follow-up for the config owner.

LOGIN_PER_SOURCE: Final[RateLimitRule] = RateLimitRule(
    name="login_per_source",
    limit=20,
    window=timedelta(minutes=5),
    subject="source",
)
LOGIN_PER_ACCOUNT: Final[RateLimitRule] = RateLimitRule(
    name="login_per_account",
    limit=10,
    window=timedelta(minutes=5),
    subject="account",
)
REGISTRATION_PER_SOURCE: Final[RateLimitRule] = RateLimitRule(
    name="registration_per_source",
    limit=5,
    window=timedelta(hours=1),
    subject="source",
)
VERIFICATION_RESEND_PER_ACCOUNT: Final[RateLimitRule] = RateLimitRule(
    name="verification_resend_per_account",
    limit=5,
    window=timedelta(hours=1),
    subject="account",
)


def cv_upload_rule(uploads_per_hour: int) -> RateLimitRule:
    """CV upload ceiling (``RATE_LIMIT_CV_UPLOADS_PER_HOUR``)."""
    return RateLimitRule(
        name="cv_upload_per_account",
        limit=uploads_per_hour,
        window=timedelta(hours=1),
        subject="account",
    )


def application_rule(applications_per_24h: int) -> RateLimitRule:
    """Application submission ceiling (``RATE_LIMIT_APPLICATIONS_PER_24H``)."""
    return RateLimitRule(
        name="application_per_account",
        limit=applications_per_24h,
        window=timedelta(hours=24),
        subject="account",
    )


def global_request_rule(requests_per_minute: int) -> RateLimitRule:
    """Coarse per-source ceiling applied by the middleware."""
    return RateLimitRule(
        name="requests_per_source",
        limit=requests_per_minute,
        window=timedelta(minutes=1),
        subject="source",
    )


# ── Limiter ───────────────────────────────────────────────────────────────────


class RateLimiter:
    """Sliding-window rate limiter backed by Valkey."""

    def __init__(
        self,
        redis: Redis,
        *,
        key_prefix: str = "rl",
        trust_forwarded_for: bool = False,
    ) -> None:
        self._redis = redis
        self._prefix = key_prefix
        self._trust_forwarded_for = trust_forwarded_for
        self._script = redis.register_script(_SLIDING_WINDOW_LUA)

    @property
    def trust_forwarded_for(self) -> bool:
        return self._trust_forwarded_for

    def key(self, rule: RateLimitRule, identifier: str) -> str:
        return f"{self._prefix}:{rule.name}:{identifier}"

    async def consume(self, rule: RateLimitRule, identifier: str) -> RateLimitDecision:
        """Consume one slot for ``identifier`` and report the outcome."""
        now_ms = int(time.time() * 1000)
        member = f"{now_ms}-{secrets.token_hex(6)}"
        try:
            raw = await self._script(
                keys=[self.key(rule, identifier)],
                args=[now_ms, rule.window_ms, rule.limit, member],
            )
        except Exception:  # noqa: BLE001 - any client or transport failure
            _LOG.warning(
                "Rate limiter unavailable for rule %s; fail_open=%s",
                rule.name,
                rule.fail_open,
                exc_info=True,
            )
            if rule.fail_open:
                return RateLimitDecision(
                    allowed=True,
                    remaining=rule.limit,
                    retry_after_seconds=0,
                )
            return RateLimitDecision(
                allowed=False,
                remaining=0,
                retry_after_seconds=int(rule.window.total_seconds()),
            )

        allowed = bool(int(raw[0]))
        count = int(raw[1])
        oldest_ms = int(raw[2] or 0)
        if allowed:
            return RateLimitDecision(
                allowed=True,
                remaining=max(0, rule.limit - count),
                retry_after_seconds=0,
            )
        retry_after = math.ceil(max(0, oldest_ms + rule.window_ms - now_ms) / 1000)
        return RateLimitDecision(
            allowed=False,
            remaining=0,
            retry_after_seconds=max(1, retry_after),
        )

    async def reset(self, rule: RateLimitRule, identifier: str) -> None:
        """Clear the window for ``identifier`` (e.g. after a successful login)."""
        try:
            await self._redis.delete(self.key(rule, identifier))
        except Exception:  # noqa: BLE001 - resetting is best-effort
            _LOG.warning("Could not reset rate-limit key for %s", rule.name, exc_info=True)

    async def enforce(self, rule: RateLimitRule, identifier: str) -> RateLimitDecision:
        """Consume a slot and raise :class:`RateLimited` when over the ceiling."""
        decision = await self.consume(rule, identifier)
        decision.raise_if_limited(rule)
        return decision


# ── Wiring helpers ────────────────────────────────────────────────────────────


def configure_rate_limiter(app: FastAPI, limiter: RateLimiter) -> None:
    """Attach ``limiter`` to the app so the dependency and middleware find it."""
    app.state.rate_limiter = limiter


def get_rate_limiter(request: Request) -> RateLimiter | None:
    """Return the configured limiter, or ``None`` when rate limiting is off."""
    limiter = getattr(request.app.state, "rate_limiter", None)
    return limiter if isinstance(limiter, RateLimiter) else None


def client_source(request: Request, *, trust_forwarded_for: bool = False) -> str:
    """Return the rate-limit identity of the caller.

    ``X-Forwarded-For`` is honoured only when the deployment terminates at a
    proxy that overwrites it; otherwise any client could mint a fresh identity
    per request and the ceiling would be decorative.
    """
    if trust_forwarded_for:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            first_hop = forwarded.split(",")[0].strip()
            if first_hop:
                return f"ip:{first_hop}"
    client = request.client
    return f"ip:{client.host}" if client and client.host else "ip:unknown"


def account_source(request: Request) -> str:
    """Return the per-account rate-limit identity, falling back to the source IP."""
    actor = current_actor()
    if actor.account_id is not None:
        return f"account:{actor.account_id}"
    limiter = get_rate_limiter(request)
    trust = limiter.trust_forwarded_for if limiter else False
    return client_source(request, trust_forwarded_for=trust)


def rate_limit(rule: RateLimitRule) -> Callable[[Request], Awaitable[None]]:
    """Build a FastAPI dependency that enforces ``rule``.

    Usage::

        @router.post("/jobs/{id}/apply", dependencies=[Depends(rate_limit(APPLY))])
    """

    async def _dependency(request: Request) -> None:
        limiter = get_rate_limiter(request)
        if limiter is None:
            _LOG.debug("Rate limiting disabled; rule %s not enforced", rule.name)
            return
        if rule.subject == "account":
            identifier = account_source(request)
        elif rule.subject == "source":
            identifier = client_source(
                request,
                trust_forwarded_for=limiter.trust_forwarded_for,
            )
        else:
            identifier = "global"
        await limiter.enforce(rule, identifier)

    return _dependency


class RateLimitMiddleware:
    """Coarse per-source request ceiling.

    Renders the 429 envelope itself: an ASGI middleware sits *outside* the
    exception-handler stack, so raising :class:`RateLimited` here would surface
    as a bare 500.
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        limiter: RateLimiter,
        rule: RateLimitRule,
        exempt_path_prefixes: tuple[str, ...] = ("/health", "/metrics"),
    ) -> None:
        self._app = app
        self._limiter = limiter
        self._rule = rule
        self._exempt = exempt_path_prefixes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or self._is_exempt(scope):
            await self._app(scope, receive, send)
            return

        decision = await self._limiter.consume(self._rule, self._identifier(scope))
        if decision.allowed:
            await self._app(scope, receive, send)
            return

        await self._send_rate_limited(scope, send, decision)

    def _is_exempt(self, scope: Scope) -> bool:
        path = str(scope.get("path", ""))
        return any(path.startswith(prefix) for prefix in self._exempt)

    def _identifier(self, scope: Scope) -> str:
        if self._limiter.trust_forwarded_for:
            forwarded = self._header(scope, b"x-forwarded-for")
            if forwarded:
                first_hop = forwarded.split(",")[0].strip()
                if first_hop:
                    return f"ip:{first_hop}"
        client = scope.get("client")
        return f"ip:{client[0]}" if client else "ip:unknown"

    async def _send_rate_limited(
        self,
        scope: Scope,
        send: Send,
        decision: RateLimitDecision,
    ) -> None:
        import orjson  # noqa: PLC0415

        error = RateLimited(
            retry_after_seconds=decision.retry_after_seconds,
            scope=self._rule.name,
        )
        state = scope.get("state") or {}
        locale = state.get("locale") or negotiate_locale(
            accept_language=self._header(scope, b"accept-language")
        )
        envelope = build_envelope(error, locale=locale, request_id=state.get("request_id"))
        body = orjson.dumps(envelope.to_payload())
        headers = [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode("latin-1")),
            (b"retry-after", str(decision.retry_after_seconds).encode("latin-1")),
        ]
        await send(
            {
                "type": "http.response.start",
                "status": error.status_code,
                "headers": headers,
            }
        )
        await send({"type": "http.response.body", "body": body})

    @staticmethod
    def _header(scope: Scope, name: bytes) -> str | None:
        for header_name, value in scope.get("headers", ()):
            if header_name == name:
                return value.decode("latin-1")
        return None
