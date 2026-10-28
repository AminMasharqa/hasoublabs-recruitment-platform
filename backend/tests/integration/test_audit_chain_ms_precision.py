"""Every audit writer hashes the timestamp PostgreSQL stores (R8 AC8, Property 45).

``occurred_at`` is ``timestamptz(3)``, so PostgreSQL keeps milliseconds. The
writers hashed ``datetime.now(UTC)`` at microsecond precision, and the verifier
re-hashes the millisecond value it reads back: 999 entries in 1000 reported a
tamper (Bug 5). Each writer path is exercised here and the window it wrote is
verified straight from the database.

Runs against ``alembic upgrade head`` through the real ``UnitOfWork``.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING
import uuid

import pytest
from sqlalchemy import func, select

from app.modules.audit.models import SYSTEM_ACTOR_UUID, AuditLogEntry
from app.modules.audit.repository import (
    append_audit_entry,
    append_failure_entry,
    verify_chain_window,
)
from app.platform.db.unit_of_work import UnitOfWork
from app.platform.taxonomy.models import Skill

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

pytestmark = pytest.mark.integration

#: A caller-supplied instant that is deliberately not on a millisecond boundary.
_SUB_MS = datetime(2026, 10, 6, 12, 0, 0, 123456, tzinfo=UTC)


async def _max_id(sessionmaker: async_sessionmaker[AsyncSession]) -> int:
    async with sessionmaker() as session:
        return int(await session.scalar(select(func.coalesce(func.max(AuditLogEntry.id), 0))))


async def test_entries_from_every_writer_verify_after_the_round_trip(
    pg_engine: AsyncEngine,
    pg_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    first = await _max_id(pg_sessionmaker) + 1

    # 1. The before_flush hook (its own clock).
    async with UnitOfWork(pg_sessionmaker) as uow:
        uow.session.add(
            Skill(name={"en": "Chain ms"}, normalized_name=f"chain-ms-{uuid.uuid4().hex[:10]}")
        )

    # 2. The service-level append, with a sub-millisecond caller timestamp.
    async with pg_sessionmaker() as session, session.begin():
        await append_audit_entry(
            session,
            actor_identity_id=SYSTEM_ACTOR_UUID,
            action="Probe.recorded",
            entity_type="Probe",
            entity_id="chain-ms",
            before=None,
            after={"k": "v"},
            occurred_at=_SUB_MS,
        )

    # 3. The separate-connection failure entry.
    await append_failure_entry(
        engine_url=pg_engine.url.render_as_string(hide_password=False),
        actor_identity_id=SYSTEM_ACTOR_UUID,
        action="operation.failed",
        entity_type="Transaction",
        entity_id="chain-ms",
        error_type="ProbeError",
        occurred_at=_SUB_MS,
    )

    last = await _max_id(pg_sessionmaker)
    assert last - first >= 2, "every writer path should have appended an entry"

    async with pg_sessionmaker() as session:
        ok, first_bad = await verify_chain_window(session, from_id=first, to_id=last)
    assert (ok, first_bad) == (True, None)
