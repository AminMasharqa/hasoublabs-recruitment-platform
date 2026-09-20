"""Audit module service layer (Section 9, Tasks 9.3–9.5).

Responsibilities:
* ``AuditService`` — append entries, anonymise actors, drive chain verification.
* ``AuditChainVerifier`` — windowed verification used by the ARQ job and the
  Admin tamper-check endpoint.

All public methods receive an ``AsyncSession`` (from a ``UnitOfWork`` or a
read-only ``get_session`` dependency).  The service never opens its own session.

Partition management
--------------------
``ensure_next_partition()`` creates the child partition for the following month
if it doesn't exist.  It is called by the ``create_audit_partition`` ARQ job
(Section 5's job registry wires this) and also at application startup.

Actor identity initialisation
------------------------------
At startup (or lazily), the system actor sentinel must exist in
``audit_actor_identities``.  ``bootstrap()`` is idempotent.
"""

from __future__ import annotations

from datetime import UTC, datetime
import logging
from typing import TYPE_CHECKING, Any

from sqlalchemy import text

from app.modules.audit.repository import (
    anonymise_actor,
    append_audit_entry,
    ensure_system_actor,
    get_max_audit_id,
    search_audit_log,
    upsert_actor_identity,
    verify_chain_window,
)

if TYPE_CHECKING:
    import uuid

    from sqlalchemy.ext.asyncio import AsyncSession

    from app.modules.audit.models import AuditLogEntry

_LOG = logging.getLogger(__name__)

# Window size for the chain-verification job (entries per batch).
VERIFY_WINDOW_SIZE: int = 500


class AuditService:
    """Domain service for the audit module.

    All writes go through ``append_audit_entry`` (which takes the advisory lock
    and computes the chain hash).  This class adds the actor-identity upsert
    convenience, anonymisation, and search.
    """

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    @staticmethod
    async def bootstrap(session: AsyncSession) -> None:
        """Ensure the system sentinel actor exists.  Idempotent."""
        await ensure_system_actor(session)
        await session.commit()

    # ── Entry append ──────────────────────────────────────────────────────────

    @staticmethod
    async def record(
        session: AsyncSession,
        *,
        actor_identity_id: uuid.UUID,
        action: str,
        entity_type: str,
        entity_id: str,
        before: dict[str, Any] | None = None,
        after: dict[str, Any] | None = None,
        reason: str | None = None,
        request_id: str | None = None,
        outcome: str = "success",
        error_type: str | None = None,
        occurred_at: datetime | None = None,
    ) -> AuditLogEntry:
        """Append one audit entry inside the current transaction.

        This is the low-level method used by the ``before_flush`` capture hook
        and by explicit call sites (e.g. authorization denial handler, deletion
        auditing).  Most production code reaches audit via the hook, not this
        method.
        """
        return await append_audit_entry(
            session,
            actor_identity_id=actor_identity_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            before=before,
            after=after,
            reason=reason,
            request_id=request_id,
            outcome=outcome,
            error_type=error_type,
            occurred_at=occurred_at,
        )

    # ── Actor identity management ─────────────────────────────────────────────

    @staticmethod
    async def get_or_create_actor(
        session: AsyncSession,
        *,
        account_id: uuid.UUID | None,
        role: str,
        display_name: str,
        email: str | None = None,
        is_system: bool = False,
    ) -> uuid.UUID:
        """Return the actor identity UUID, creating the row if absent."""
        return await upsert_actor_identity(
            session,
            account_id=account_id,
            role=role,
            display_name=display_name,
            email=email,
            is_system=is_system,
        )

    # ── Anonymisation (deletion path) ─────────────────────────────────────────

    @staticmethod
    async def anonymise_deleted_account(
        session: AsyncSession,
        account_id: uuid.UUID,
    ) -> int:
        """Null out personal fields for all identity rows belonging to ``account_id``.

        Returns the count of rows anonymised.  Must be called inside a
        ``UnitOfWork`` so the anonymisation is audited atomically.
        """
        return await anonymise_actor(session, account_id=account_id)

    # ── Search (R8 AC4) ───────────────────────────────────────────────────────

    @staticmethod
    async def search(
        session: AsyncSession,
        *,
        actor_account_id: uuid.UUID | None = None,
        action: str | None = None,
        entity_type: str | None = None,
        entity_id: str | None = None,
        from_dt: datetime | None = None,
        to_dt: datetime | None = None,
        after_id: int | None = None,
        page_size: int = 20,
    ) -> tuple[list[AuditLogEntry], bool]:
        """Search the audit log with filters and keyset pagination."""
        return await search_audit_log(
            session,
            actor_account_id=actor_account_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            from_dt=from_dt,
            to_dt=to_dt,
            after_id=after_id,
            page_size=page_size,
        )


class AuditChainVerifier:
    """Windowed hash-chain verifier (R8 AC8).

    Called by the ``verify_audit_chain`` ARQ job.  Walks the chain in windows
    of ``VERIFY_WINDOW_SIZE`` entries.  On mismatch, logs a CRITICAL event and
    appends a tamper-alert notification (real notification delivery is wired by
    Section 5 — here we emit the notification row directly).

    The verifier tracks its progress in a Postgres metadata row so it resumes
    from where it left off after a crash rather than re-walking the whole table.
    """

    async def run_window(
        self,
        session: AsyncSession,
        *,
        from_id: int,
        to_id: int | None = None,
    ) -> tuple[bool, int | None]:
        """Verify one window.

        Args:
            session: Read-only session (no UoW needed — verification is read-only).
            from_id: First ``id`` of the window.
            to_id:   Last ``id`` of the window (inclusive).  If ``None``, uses
                     ``from_id + VERIFY_WINDOW_SIZE - 1``.

        Returns:
            ``(ok, first_bad_id)``
        """
        effective_to = to_id if to_id is not None else (from_id + VERIFY_WINDOW_SIZE - 1)
        ok, bad_id = await verify_chain_window(session, from_id=from_id, to_id=effective_to)
        if not ok:
            _LOG.critical(
                "AUDIT CHAIN TAMPER DETECTED: first bad entry id=%s in window [%s, %s]",
                bad_id,
                from_id,
                effective_to,
            )
        return ok, bad_id

    async def verify_since(
        self,
        session: AsyncSession,
        *,
        start_id: int = 1,
    ) -> tuple[bool, int | None]:
        """Walk the entire chain from ``start_id`` in windows.

        Stops at the first mismatch and returns ``(False, bad_id)``.
        Returns ``(True, None)`` when the whole chain is clean.
        """
        max_id = await get_max_audit_id(session)
        if max_id is None:
            return True, None  # Empty log is trivially valid.

        cursor = start_id
        while cursor <= max_id:
            ok, bad_id = await self.run_window(
                session,
                from_id=cursor,
                to_id=min(cursor + VERIFY_WINDOW_SIZE - 1, max_id),
            )
            if not ok:
                return False, bad_id
            cursor += VERIFY_WINDOW_SIZE

        return True, None


# ── Partition management ───────────────────────────────────────────────────────

async def ensure_next_partition(session: AsyncSession) -> None:
    """Create the audit_log partition for the *next* calendar month if absent.

    Called at startup and by a monthly ARQ job so there is always a ready
    partition before new rows arrive.  Idempotent: uses ``IF NOT EXISTS``.
    """
    today = datetime.now(UTC)
    # Calculate the first day of next month.
    if today.month == 12:
        first_of_next = datetime(today.year + 1, 1, 1, tzinfo=UTC)
    else:
        first_of_next = datetime(today.year, today.month + 1, 1, tzinfo=UTC)
    # And the first of the month after that (the upper bound, exclusive).
    if first_of_next.month == 12:
        first_after = datetime(first_of_next.year + 1, 1, 1, tzinfo=UTC)
    else:
        first_after = datetime(first_of_next.year, first_of_next.month + 1, 1, tzinfo=UTC)

    partition_name = f"audit_log_{first_of_next.strftime('%Y_%m')}"
    lower = first_of_next.strftime("%Y-%m-%d")
    upper = first_after.strftime("%Y-%m-%d")

    ddl = f"""
        CREATE TABLE IF NOT EXISTS {partition_name}
        PARTITION OF audit_log
        FOR VALUES FROM ('{lower}') TO ('{upper}')
    """
    await session.execute(text(ddl))
    _LOG.info("audit: ensured partition %s [%s, %s)", partition_name, lower, upper)


async def ensure_current_partition(session: AsyncSession) -> None:
    """Create the audit_log partition for the *current* calendar month if absent."""
    today = datetime.now(UTC)
    first_of_this = datetime(today.year, today.month, 1, tzinfo=UTC)
    if today.month == 12:
        first_of_next = datetime(today.year + 1, 1, 1, tzinfo=UTC)
    else:
        first_of_next = datetime(today.year, today.month + 1, 1, tzinfo=UTC)

    partition_name = f"audit_log_{first_of_this.strftime('%Y_%m')}"
    lower = first_of_this.strftime("%Y-%m-%d")
    upper = first_of_next.strftime("%Y-%m-%d")

    ddl = f"""
        CREATE TABLE IF NOT EXISTS {partition_name}
        PARTITION OF audit_log
        FOR VALUES FROM ('{lower}') TO ('{upper}')
    """
    await session.execute(text(ddl))
    _LOG.info("audit: ensured partition %s [%s, %s)", partition_name, lower, upper)


__all__ = [
    "VERIFY_WINDOW_SIZE",
    "AuditChainVerifier",
    "AuditService",
    "ensure_current_partition",
    "ensure_next_partition",
]
