"""Integration tests for UnitOfWork transaction semantics (Task 2.3).

Verifies the R8 AC5 foundation: a raised exception inside a ``UnitOfWork`` leaves
the database byte-identical to the pre-operation snapshot (no intermediate state
persists), while a clean exit commits exactly the intended rows.

The tests exercise a real table from the baseline migration (``outbox_emails``)
against a real PostgreSQL container, because the guarantee under test is a
transactional-database property — mocking the session would test nothing.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.platform.db.unit_of_work import UnitOfWork
from app.platform.mail.models import OutboxEmail, OutboxEmailState

pytestmark = [pytest.mark.integration]


async def _outbox_count(sessionmaker: async_sessionmaker[AsyncSession]) -> int:
    async with sessionmaker() as session:
        result = await session.execute(select(func.count()).select_from(OutboxEmail))
        return int(result.scalar_one())


async def _outbox_keys(sessionmaker: async_sessionmaker[AsyncSession]) -> set[str]:
    async with sessionmaker() as session:
        result = await session.execute(select(OutboxEmail.idempotency_key))
        return set(result.scalars().all())


def _new_outbox_row() -> OutboxEmail:
    return OutboxEmail(
        idempotency_key=f"test:{uuid.uuid4()}",
        to_address="candidate@example.com",
        template="verification_code",
        locale="ar",
        payload={"secret_refs": []},
        state=OutboxEmailState.PENDING,
    )


class _InjectedFailure(RuntimeError):
    """Sentinel exception injected mid-operation to trigger rollback."""


async def test_rollback_leaves_database_unchanged(
    pg_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """An exception inside the UoW rolls back every write in that operation."""
    before_keys = await _outbox_keys(pg_sessionmaker)

    injected_key: str | None = None
    with pytest.raises(_InjectedFailure):
        async with UnitOfWork(sessionmaker=pg_sessionmaker) as uow:
            row = _new_outbox_row()
            injected_key = row.idempotency_key
            uow.session.add(row)
            await uow.session.flush()  # row now exists within the transaction
            # Multi-step operation fails partway through, after a write.
            raise _InjectedFailure

    after_keys = await _outbox_keys(pg_sessionmaker)

    # The flushed row must not survive the rollback: state is byte-identical.
    assert after_keys == before_keys
    assert injected_key is not None
    assert injected_key not in after_keys


async def test_commit_persists_exactly_the_written_rows(
    pg_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """A clean exit commits exactly the rows written in the operation."""
    before_count = await _outbox_count(pg_sessionmaker)

    row = _new_outbox_row()
    async with UnitOfWork(sessionmaker=pg_sessionmaker) as uow:
        uow.session.add(row)

    after_keys = await _outbox_keys(pg_sessionmaker)
    assert await _outbox_count(pg_sessionmaker) == before_count + 1
    assert row.idempotency_key in after_keys


async def test_rollback_after_multiple_writes_persists_none(
    pg_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """No partial subset of a failed multi-write operation is persisted."""
    before_keys = await _outbox_keys(pg_sessionmaker)

    rows = [_new_outbox_row() for _ in range(3)]
    with pytest.raises(_InjectedFailure):
        async with UnitOfWork(sessionmaker=pg_sessionmaker) as uow:
            for row in rows:
                uow.session.add(row)
                await uow.session.flush()
            raise _InjectedFailure

    after_keys = await _outbox_keys(pg_sessionmaker)
    assert after_keys == before_keys
    for row in rows:
        assert row.idempotency_key not in after_keys


async def test_session_unavailable_outside_context(
    pg_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """Accessing the session after the context closes fails loudly."""
    uow = UnitOfWork(sessionmaker=pg_sessionmaker)
    async with uow:
        assert uow.session is not None
    with pytest.raises(RuntimeError, match="outside an active context"):
        _ = uow.session
