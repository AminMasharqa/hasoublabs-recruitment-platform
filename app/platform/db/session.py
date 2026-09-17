"""FastAPI request-scoped session dependency (Task 2.1).

Read-only handlers that only need a session (no multi-step mutation) can depend
on ``get_session`` directly. Mutating operations use the :class:`UnitOfWork`
instead, which owns the transaction boundary.

``get_session`` yields a session bound to the process-wide engine and closes it
when the request ends. It does **not** commit: a plain query needs no commit, and
any handler that writes must go through a ``UnitOfWork`` so the
one-transaction-per-operation guarantee (R8 AC5) is preserved. Importing
``fastapi`` here is allowed — this file is part of the ``platform`` layer, not a
domain module, so the "no fastapi outside router.py" rule does not apply.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession

from app.platform.db.engine import get_sessionmaker


async def get_session() -> AsyncIterator[AsyncSession]:
    """Yield a request-scoped read session, closing it when the request ends."""
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        yield session


__all__ = ["get_session"]
