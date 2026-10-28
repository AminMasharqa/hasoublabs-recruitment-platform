"""An action that requires a reason records it on its audit entries (R8 AC2).

The reason of a rejection, suspension or deactivation was stored in
``account_status_transitions`` but never reached the audit log: nothing set the
ambient reason the ``before_flush`` hook reads, so every entry had
``reason = NULL``. The lifecycle service now binds the reason around the whole
Unit of Work, because the hook runs when the UoW flushes on exit.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
import uuid

import pytest
from sqlalchemy import text

from app.modules.identity.service import AccountLifecycleService
from app.platform.db.unit_of_work import UnitOfWork
from app.platform.middleware.context import (
    bind_request_context,
    current_reason,
    reset_request_context,
)
from app.platform.security.principal import Principal
from app.platform.security.types import AccountStatus, Role

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

pytestmark = pytest.mark.integration

_REASON = "Residency proof does not match the registry"


async def test_a_rejection_records_its_reason_on_the_audit_entries(
    pg_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    async with pg_sessionmaker() as session:
        account_id = (
            await session.execute(
                text(
                    "INSERT INTO accounts (email, roles, password_hash, status) "
                    "VALUES (:email, ARRAY['CANDIDATE']::role[], 'x', 'PendingApproval') "
                    "RETURNING id"
                ),
                {"email": f"reason-{uuid.uuid4().hex[:10]}@example.test"},
            )
        ).scalar_one()
        await session.commit()

    admin = Principal(
        account_id=uuid.uuid4(),
        roles=frozenset({Role.ADMIN}),
        active_context=Role.ADMIN,
        status=AccountStatus.APPROVED,
        session_id="s",
    )
    request_id = f"req-{uuid.uuid4().hex}"
    tokens = bind_request_context(request_id=request_id, locale="en", started_at=0.0)
    try:
        service = AccountLifecycleService(lambda: UnitOfWork(pg_sessionmaker))
        await service.reject(account_id, actor=admin, reason=_REASON)
        # Scoped: the reason does not leak into whatever the request does next.
        assert current_reason() is None
    finally:
        reset_request_context(tokens)

    async with pg_sessionmaker() as session:
        rows = (
            await session.execute(
                text("SELECT action, reason FROM audit_log WHERE request_id = :rid ORDER BY id"),
                {"rid": request_id},
            )
        ).all()

    actions = {row.action: row.reason for row in rows}
    # The status change and its transition record both carry the reason.
    assert actions["Account.updated"] == _REASON
    assert actions["AccountStatusTransition.created"] == _REASON
    assert {row.reason for row in rows} == {_REASON}
