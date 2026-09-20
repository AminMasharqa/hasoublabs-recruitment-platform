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
* **The failure audit entry is written on a separate connection.** R8 AC5
  requires exactly one failure entry per failed operation, and that entry must
  survive this rollback — so it is written by ``audit.repository.append_failure_entry``
  on a dedicated short-lived connection in the rollback path of ``__aexit__``.

Usage::

    async with UnitOfWork() as uow:
        await some_repository.add(uow.session, entity)
        await other_repository.update(uow.session, other)
    # committed here iff the block raised nothing
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from app.platform.audit.hook import register_audit_capture
from app.platform.db.engine import get_engine, get_sessionmaker

if TYPE_CHECKING:
    from types import TracebackType

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

_LOG = logging.getLogger(__name__)


class UnitOfWork:
    """An async context manager wrapping a single database transaction.

    The session is created on ``__aenter__`` and closed on ``__aexit__``. The
    transaction commits if the ``async with`` block completes without raising,
    and rolls back otherwise. The originating exception is never swallowed.

    Audit integration (Section 9)
    ------------------------------
    * ``register_audit_capture`` is called on the sessionmaker at construction
      time (idempotent: the marker prevents double-registration).
    * On rollback, ``append_failure_entry`` writes exactly one failure entry on
      a separate short-lived connection, so it survives the rollback.
    """

    __slots__ = ("_sessionmaker", "_session")

    def __init__(
        self,
        sessionmaker: async_sessionmaker[AsyncSession] | None = None,
    ) -> None:
        # The sessionmaker is injectable so tests can bind a UoW to a
        # Testcontainers engine without touching the process-wide singleton.
        self._sessionmaker = sessionmaker or get_sessionmaker()
        # Attach the audit capture listener once per sessionmaker instance.
        register_audit_capture(self._sessionmaker)
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
                # Write exactly one failure audit entry on a separate connection
                # so it survives the rollback (R8 AC5).  Fire-and-forget; we log
                # but never mask the original exception.
                await self._write_failure_entry(exc)
        finally:
            await session.close()
            self._session = None
        # Never suppress the original exception.
        return False

    async def _write_failure_entry(self, exc: BaseException | None) -> None:
        """Write a failure audit entry on a separate short-lived connection."""
        try:
            from app.modules.audit.repository import (  # noqa: PLC0415
                append_failure_entry,
                audit_actor_id_var,
                audit_reason_var,
                audit_request_id_var,
            )

            engine = get_engine()
            engine_url = str(engine.url)

            await append_failure_entry(
                engine_url=engine_url,
                actor_identity_id=audit_actor_id_var.get(),
                action="operation.failed",
                entity_type="Transaction",
                entity_id="unknown",
                error_type=type(exc).__name__ if exc is not None else "UnknownError",
                reason=audit_reason_var.get(),
                request_id=audit_request_id_var.get(),
            )
        except Exception:
            _LOG.exception("UnitOfWork: failed to write failure audit entry")


__all__ = ["UnitOfWork"]
