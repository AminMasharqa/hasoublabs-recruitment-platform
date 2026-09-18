"""One-transaction-per-operation Unit of Work (MOCK for Task 2.1).

PROVISIONAL / MOCK OWNERSHIP NOTE
---------------------------------
The ``UnitOfWork`` belongs to Section 2 (db/UoW/migrations — Salma) and is not
yet merged. This stand-in implements the contract the design specifies (design:
Correctness by Construction — "One transaction per operation. A UnitOfWork wraps
each service call; any exception rolls the whole thing back") so downstream
owners can write services against it now. Section 2 replaces the body; the
public surface — ``async with UnitOfWork() as uow: uow.session`` — stays put.

Deliberately NOT implemented here (Section 2 / Section 9 own these):
- the separate-connection single failure audit entry on rollback (R8 AC5);
- the real audit hash chain. The audit capture hook installed below is the
  Section 9 mock and records nothing yet (see ``platform/audit``).
"""

from __future__ import annotations

from types import TracebackType
from typing import TYPE_CHECKING

from app.platform.audit import register_audit_capture
from app.platform.db.session import get_sessionmaker

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


class UnitOfWork:
    """Async context manager wrapping exactly one database transaction.

    Commits on clean exit, rolls the whole transaction back on any exception, so
    "no intermediate entity state persisted" (R8 AC5, AC6) is structural rather
    than dependent on each caller remembering to roll back.

    Usage::

        async with UnitOfWork() as uow:
            uow.session.add(some_row)
            # commit happens automatically on clean exit
    """

    def __init__(self, session_factory: async_sessionmaker[AsyncSession] | None = None) -> None:
        self._session_factory = session_factory or get_sessionmaker()
        self._session: AsyncSession | None = None

    @property
    def session(self) -> AsyncSession:
        """The active session. Valid only inside the ``async with`` block."""
        if self._session is None:
            msg = "UnitOfWork.session accessed outside an active context"
            raise RuntimeError(msg)
        return self._session

    async def __aenter__(self) -> UnitOfWork:
        self._session = self._session_factory()
        # Install the audit capture listener on this session. MOCK: no-op until
        # Section 9 lands the real before_flush diff/hash-chain capture.
        register_audit_capture(self._session.sync_session)
        await self._session.begin()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        session = self.session
        try:
            if exc_type is None:
                await session.commit()
            else:
                # Any exception rolls the whole operation back. Section 2/9 add
                # the separate-connection single failure audit entry here.
                await session.rollback()
        finally:
            await session.close()
            self._session = None


__all__ = ["UnitOfWork"]
