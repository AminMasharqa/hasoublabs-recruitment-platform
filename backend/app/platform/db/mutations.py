"""Mutation helpers that keep every change visible to the audit hook (R8 AC1, AC6).

The audit trail is written by a ``before_flush`` hook (``platform/audit/hook.py``)
that diffs the session's new, dirty and deleted objects. A bulk ``update()`` or
``delete()`` statement never enters those sets: SQLAlchemy runs it directly and
synchronizes in-session objects as already committed, so the change is not
recorded at all. Repositories mutate through ORM objects instead, and use this
module where a statement would otherwise have been the convenient form.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import select

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession
    from sqlalchemy.sql import ColumnElement

    from app.platform.db.base import Base


async def delete_each(
    session: AsyncSession, model: type[Base], *criteria: ColumnElement[bool]
) -> int:
    """Delete the rows of ``model`` matching ``criteria`` one object at a time.

    Each deletion is recorded by the audit hook with the row's last values. The
    deletes are flushed before returning, so a caller replacing a collection can
    add rows that reuse a unique key in the same transaction.

    Returns:
        The number of rows deleted.
    """
    rows = (await session.scalars(select(model).where(*criteria))).all()
    for row in rows:
        await session.delete(row)
    await session.flush()
    return len(rows)


__all__ = ["delete_each"]
