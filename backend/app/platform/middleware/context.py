"""Per-request ambient context: request id, actor, reason, locale, timing.

Everything that needs to know *who* is acting and *why* reads it from here
rather than having it threaded through every call signature. The audit capture
listener (Section 9) is the primary consumer: it runs inside SQLAlchemy's
``before_flush``, where the request object is long out of reach, so actor and
reason have to be ambient (design: Audit Log Design).

Contract for other owners — these names are stable:

* :func:`current_actor` — never ``None``; ``ANONYMOUS_ACTOR`` before auth,
  ``SYSTEM_ACTOR`` inside background jobs.
* :func:`current_reason` — ``None`` unless a caller wrapped the operation in
  :func:`use_reason`.
* :func:`current_request_id` — the id echoed in ``X-Request-ID`` and stored on
  every audit row, so an audit entry can be traced back to one request.
* :func:`current_locale` — negotiated locale for the response.
* :func:`request_started_at` — monotonic clock reading taken at middleware
  entry, which is the reference point for the constant-time denial floor
  (Section 4).

Roles are carried as plain strings so the platform layer keeps its one-way
independence from the domain modules that define the role enum.
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Final
import uuid

from app.platform.i18n.locales import DEFAULT_LOCALE

if TYPE_CHECKING:
    from collections.abc import Iterator


@dataclass(frozen=True, slots=True)
class Actor:
    """Who is performing the current operation."""

    account_id: uuid.UUID | None = None
    roles: frozenset[str] = field(default_factory=frozenset)
    active_context: str | None = None
    session_id: uuid.UUID | None = None
    is_system: bool = False

    @property
    def label(self) -> str:
        """Stable, non-PII label for logs and audit rows."""
        if self.is_system:
            return "system"
        if self.account_id is None:
            return "anonymous"
        return str(self.account_id)

    @property
    def is_authenticated(self) -> bool:
        return self.account_id is not None or self.is_system


#: Actor used before authentication resolves (public routes, failed auth).
ANONYMOUS_ACTOR: Final[Actor] = Actor()

#: Actor used by background jobs and schedulers (design: `system` actor fallback).
SYSTEM_ACTOR: Final[Actor] = Actor(is_system=True)

_actor: ContextVar[Actor] = ContextVar("hasoub_actor", default=ANONYMOUS_ACTOR)
_reason: ContextVar[str | None] = ContextVar("hasoub_reason", default=None)
_request_id: ContextVar[str | None] = ContextVar("hasoub_request_id", default=None)
_locale: ContextVar[str] = ContextVar("hasoub_locale", default=DEFAULT_LOCALE)
_started_at: ContextVar[float | None] = ContextVar("hasoub_started_at", default=None)


# ── Readers ───────────────────────────────────────────────────────────────────


def current_actor() -> Actor:
    """Return the acting principal; ``ANONYMOUS_ACTOR`` when unauthenticated."""
    return _actor.get()


def current_reason() -> str | None:
    """Return the operator-supplied reason for the current mutation, if any."""
    return _reason.get()


def current_request_id() -> str | None:
    """Return the current request id, or ``None`` outside a request."""
    return _request_id.get()


def current_locale() -> str:
    """Return the negotiated locale for the current request."""
    return _locale.get()


def request_started_at() -> float | None:
    """Return the monotonic timestamp captured at middleware entry."""
    return _started_at.get()


# ── Writers ───────────────────────────────────────────────────────────────────


def set_actor(actor: Actor) -> Token[Actor]:
    """Set the acting principal (called by the auth dependency after it resolves)."""
    return _actor.set(actor)


def set_locale(locale: str) -> Token[str]:
    """Override the negotiated locale (e.g. once the account preference is known)."""
    return _locale.set(locale)


def set_reason(reason: str | None) -> Token[str | None]:
    """Set the reason recorded on audit rows for the current operation."""
    return _reason.set(reason)


@contextmanager
def use_actor(actor: Actor) -> Iterator[Actor]:
    """Temporarily act as ``actor`` (background jobs, admin impersonation-free tasks)."""
    token = _actor.set(actor)
    try:
        yield actor
    finally:
        _actor.reset(token)


@contextmanager
def use_system_actor() -> Iterator[Actor]:
    """Temporarily act as the ``system`` actor."""
    with use_actor(SYSTEM_ACTOR) as actor:
        yield actor


@contextmanager
def use_reason(reason: str | None) -> Iterator[None]:
    """Attach ``reason`` to every audit row written inside the block."""
    token = _reason.set(reason)
    try:
        yield
    finally:
        _reason.reset(token)


@dataclass(slots=True)
class _ContextTokens:
    request_id: Token[str | None]
    locale: Token[str]
    started_at: Token[float | None]
    actor: Token[Actor]
    reason: Token[str | None]


def bind_request_context(
    *,
    request_id: str,
    locale: str,
    started_at: float,
    actor: Actor = ANONYMOUS_ACTOR,
) -> _ContextTokens:
    """Bind the ambient request context; pair with :func:`reset_request_context`."""
    return _ContextTokens(
        request_id=_request_id.set(request_id),
        locale=_locale.set(locale),
        started_at=_started_at.set(started_at),
        actor=_actor.set(actor),
        reason=_reason.set(None),
    )


def reset_request_context(tokens: _ContextTokens) -> None:
    """Restore the context that was in force before :func:`bind_request_context`."""
    _reason.reset(tokens.reason)
    _actor.reset(tokens.actor)
    _started_at.reset(tokens.started_at)
    _locale.reset(tokens.locale)
    _request_id.reset(tokens.request_id)


def new_request_id() -> str:
    """Generate a fresh request id."""
    return str(uuid.uuid4())
