"""Bind the authenticated principal as the audit actor for the current request (R8 AC2).

Every audit row references an ``audit_actor_identities`` row. Building one for an
account needs its display name and email, which the identity module owns, and
``app/platform`` may not import ``app.modules``. So the lookup is injected: the
composition root registers an :class:`ActorIdentityResolver` at startup, and the
auth dependency calls :func:`bind_principal_actor` once it has a principal.

Until a resolver is registered (unit tests, scripts), entries keep the ``system``
actor, as they did before the request context was wired.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
import logging
from typing import TYPE_CHECKING, Protocol

from app.platform.audit.context import audit_actor_id_var
from app.platform.middleware.context import Actor, set_actor

if TYPE_CHECKING:
    from collections.abc import AsyncIterator
    import uuid

    from sqlalchemy.ext.asyncio import AsyncSession

    from app.platform.security.principal import Principal

_LOG = logging.getLogger(__name__)


class ActorIdentityResolver(Protocol):
    """Return the ``audit_actor_identities`` id for an account acting in a role."""

    async def resolve(self, account_id: uuid.UUID, role: str) -> uuid.UUID: ...

    async def resolve_in_session(
        self, session: AsyncSession, account_id: uuid.UUID, role: str, email: str
    ) -> uuid.UUID:
        """The same, inside ``session``'s transaction, for an account not yet committed."""
        ...


_resolver: ActorIdentityResolver | None = None


def configure_actor_identity_resolver(resolver: ActorIdentityResolver | None) -> None:
    """Register the resolver the auth dependency uses (``None`` unregisters it)."""
    global _resolver  # noqa: PLW0603 - one process-wide registration, set at startup
    _resolver = resolver


async def bind_principal_actor(principal: Principal) -> None:
    """Make ``principal`` the actor of everything audited for the rest of the request.

    Sets the ambient :class:`Actor` and, when a resolver is registered, the audit
    actor identity. Called before any role check, so an authorization denial is
    attributed too. A resolver failure is logged and leaves the ``system`` actor:
    auditing must never fail the request it describes.
    """
    set_actor(
        Actor(
            account_id=principal.account_id,
            roles=frozenset(str(role) for role in principal.roles),
            active_context=str(principal.active_context),
        )
    )
    if _resolver is None:
        return
    try:
        identity_id = await _resolver.resolve(principal.account_id, str(principal.active_context))
    except Exception:
        _LOG.exception("audit: could not resolve the actor identity of %s", principal.account_id)
        return
    audit_actor_id_var.set(identity_id)


@asynccontextmanager
async def acting_as_account(
    session: AsyncSession, *, account_id: uuid.UUID, role: str, email: str
) -> AsyncIterator[None]:
    """Attribute what the block records to an account acting without a session (R8 AC2).

    For public flows where the account is known to be the one acting: a
    registrant once their account row exists, and a verification once the code
    checks out. On a clean exit the block's changes are flushed while the
    account is the actor; the previous actor is always restored before the
    UnitOfWork commits or writes a failure entry, so a rolled-back identity is
    never referenced. The identity row is written in ``session``'s transaction
    (a registrant is not committed yet), in a savepoint, and a failure to write
    it is logged and leaves the current actor.
    """
    token = None
    if _resolver is not None:
        try:
            async with session.begin_nested():
                identity_id = await _resolver.resolve_in_session(session, account_id, role, email)
            token = audit_actor_id_var.set(identity_id)
        except Exception:
            _LOG.exception("audit: could not resolve the actor identity of %s", account_id)
    try:
        yield
        await session.flush()
    finally:
        if token is not None:
            audit_actor_id_var.reset(token)


__all__ = [
    "ActorIdentityResolver",
    "acting_as_account",
    "bind_principal_actor",
    "configure_actor_identity_resolver",
]
