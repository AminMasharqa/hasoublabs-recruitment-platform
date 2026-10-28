"""Audit entries name the principal who acted and the request it came from (R8 AC2, Bug 23).

Nothing ever set the audit actor or request id: the hook and the Unit of Work
read their own context variables, which no middleware or guard wrote. All 8,214
entries in the dev database named the ``system`` actor and carried no request id.

Now the auth dependency calls ``bind_principal_actor``, which resolves the
principal to an ``audit_actor_identities`` row through the resolver registered at
startup, and the audit writers read the request id from the request context the
middleware binds. These tests drive both writers (the ``before_flush`` hook and
the rollback failure entry) through the real ``UnitOfWork`` after that binding.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import TYPE_CHECKING
import uuid

import pytest
from sqlalchemy import text

from app.modules.audit.service import AuditActorResolver
from app.platform.audit.actor import bind_principal_actor, configure_actor_identity_resolver
from app.platform.db import unit_of_work
from app.platform.db.unit_of_work import UnitOfWork
from app.platform.middleware.context import bind_request_context, reset_request_context
from app.platform.security.principal import Principal
from app.platform.security.types import AccountStatus, Role
from app.platform.taxonomy.models import Skill

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

pytestmark = pytest.mark.integration


class _IdentityApi:
    def __init__(self, email: str) -> None:
        self.email = email

    async def get_account(self, account_id: uuid.UUID) -> SimpleNamespace:
        return SimpleNamespace(id=account_id, email=self.email)


@asynccontextmanager
async def _bound_admin(
    sessionmaker: async_sessionmaker[AsyncSession],
) -> AsyncIterator[SimpleNamespace]:
    """Bind an Admin principal as the actor of a request, as the auth guard does.

    A context manager rather than a fixture: the binding is context variables,
    which must be set in the test's own task to be visible to it.
    """
    email = f"actor-{uuid.uuid4().hex[:10]}@example.test"
    async with sessionmaker() as session:
        account_id = (
            await session.execute(
                text(
                    "INSERT INTO accounts (email, roles, password_hash) "
                    "VALUES (:email, ARRAY['ADMIN']::role[], 'x') RETURNING id"
                ),
                {"email": email},
            )
        ).scalar_one()
        await session.commit()

    configure_actor_identity_resolver(
        AuditActorResolver(
            lambda: UnitOfWork(sessionmaker),
            identity_api=_IdentityApi(email),  # type: ignore[arg-type]
        )
    )
    request_id = f"req-{uuid.uuid4().hex}"
    tokens = bind_request_context(request_id=request_id, locale="en", started_at=0.0)
    try:
        await bind_principal_actor(
            Principal(
                account_id=account_id,
                roles=frozenset({Role.ADMIN}),
                active_context=Role.ADMIN,
                status=AccountStatus.APPROVED,
                session_id="s",
            )
        )
        yield SimpleNamespace(account_id=account_id, email=email, request_id=request_id)
    finally:
        reset_request_context(tokens)
        configure_actor_identity_resolver(None)


async def _entries(
    sessionmaker: async_sessionmaker[AsyncSession], request_id: str
) -> list[SimpleNamespace]:
    async with sessionmaker() as session:
        rows = (
            await session.execute(
                text(
                    "SELECT l.action, l.outcome, i.account_id, i.role, i.display_name, i.email "
                    "FROM audit_log l JOIN audit_actor_identities i "
                    "ON i.id = l.actor_identity_id WHERE l.request_id = :rid ORDER BY l.id"
                ),
                {"rid": request_id},
            )
        ).all()
    return [SimpleNamespace(**row._mapping) for row in rows]


async def test_a_mutation_is_attributed_to_the_principal_and_its_request(
    pg_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    async with _bound_admin(pg_sessionmaker) as bound_admin, UnitOfWork(pg_sessionmaker) as uow:
        uow.session.add(
            Skill(name={"en": "Actor"}, normalized_name=f"actor-{uuid.uuid4().hex[:10]}")
        )

    entries = await _entries(pg_sessionmaker, bound_admin.request_id)
    assert [(e.action, e.outcome) for e in entries] == [("Skill.created", "success")]
    entry = entries[0]
    assert entry.account_id == bound_admin.account_id
    assert entry.role == "ADMIN"
    assert entry.email == bound_admin.email
    assert entry.display_name == f"{bound_admin.email} (Admin)"


async def test_a_rolled_back_operation_is_attributed_too(
    pg_sessionmaker: async_sessionmaker[AsyncSession],
    pg_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The failure entry is written on a separate connection from the process-wide
    # engine; point that at the test database.
    monkeypatch.setattr(unit_of_work, "get_engine", lambda: pg_engine)

    async with _bound_admin(pg_sessionmaker) as bound_admin:
        with pytest.raises(ValueError, match="boom"):  # noqa: PT012 - the UoW is the subject
            async with UnitOfWork(pg_sessionmaker):
                raise ValueError("boom")

    entries = await _entries(pg_sessionmaker, bound_admin.request_id)
    assert [(e.action, e.outcome) for e in entries] == [("operation.failed", "failure")]
    assert entries[0].account_id == bound_admin.account_id
