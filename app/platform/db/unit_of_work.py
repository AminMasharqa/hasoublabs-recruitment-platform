"""The Unit of Work — one transaction per operation (Task 2.1).

Every service call runs inside exactly one ``UnitOfWork``. On clean exit the
transaction commits; on *any* exception it rolls back and the exception
propagates. This is the boundary that makes R8 AC5 structural rather than
incidental: a failed multi-step operation leaves no intermediate entity state,
because the whole transaction is discarded together.

Design notes:

* **One transaction per operation.** The ``UnitOfWork`` owns the session for the
  duration of a single service call. Services never open their own session and
  never call ``commit()`` / ``rollback()`` directly — doing so from inside a
  service would split the operation across transaction boundaries and defeat the
  atomicity guarantee (and, once the audit ``before_flush`` listener lands in
  Section 9, would let audit rows commit apart from the change they describe).
* **Commit is implicit and single.** The commit happens once, on successful exit
  of the context. Callers signal failure by raising; they do not commit.
* **The failure audit entry is written elsewhere.** R8 AC5 also requires exactly
  one failure entry per failed operation, and that entry must survive this
  rollback — so it is written on a *separate* short-lived connection by the audit
  layer (Section 9, design D-7), never inside this transaction.

Usage::

    async with UnitOfWork() as uow:
        await some_repository.add(uow.session, entity)
        await other_repository.update(uow.session, other)
    # committed here iff the block raised nothing
"""

from __future__ import annotations

from types import TracebackType

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.platform.db.engine import get_sessionmaker


class UnitOfWork:
    """An async context manager wrapping a single database transaction.

    The session is created on ``__aenter__`` and closed on ``__aexit__``. The
    transaction commits if the ``async with`` block completes without raising,
    and rolls back otherwise. The originating exception is never swallowed.
    """

    __slots__ = ("_sessionmaker", "_session")

    def __init__(
        self,
        sessionmaker: async_sessionmaker[AsyncSession] | None = None,
    ) -> None:
        # The sessionmaker is injectable so tests can bind a UoW to a
        # Testcontainers engine without touching the process-wide singleton.
        self._sessionmaker = sessionmaker or get_sessionmaker()
        self._session: AsyncSession | None = None

    @property
    def session(self) -> AsyncSession:
        """The session for this transaction.

        Raises ``RuntimeError`` if accessed outside the ``async with`` block, so
        a session leak (using the UoW after it has closed) fails loudly instead
        of silently operating on a detached session.
        """
        if self._session is None:
            msg = "UnitOfWork.session accessed outside an active context"
            raise RuntimeError(msg)
        return self._session

    async def __aenter__(self) -> UnitOfWork:
        self._session = self._sessionmaker()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> bool:
        session = self._session
        if session is None:  # pragma: no cover - defensive; __aenter__ always sets it
            return False
        try:
            if exc_type is None:
                await session.commit()
            else:
                await session.rollback()
        finally:
            await session.close()
            self._session = None
        # Never suppress the original exception.
        return False


__all__ = ["UnitOfWork"]
