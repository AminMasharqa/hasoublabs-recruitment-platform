"""Audit log persistence — hash chain, actor upsert, and search queries (R8).

The chain primitives (lock key, redaction map, hashing, the separate-connection
failure entry) and the request context variables live in ``app.platform.audit``,
because the platform's ``before_flush`` hook and Unit of Work write entries too.
They are re-exported here under their original names.

Hash chain algorithm
--------------------
    prev_hash   = entry_hash of the most-recently committed row (NULL for genesis)
    payload     = canonical_json(entry fields, excluding prev_hash and entry_hash)
    entry_hash  = SHA-256( payload || prev_hash_bytes )   # bytes concatenation

``pg_advisory_xact_lock(AUDIT_CHAIN_KEY)`` is taken before reading the tail so
no two concurrent transactions can race on the chain.  The lock is
transaction-scoped and released automatically on commit/rollback.
"""

from __future__ import annotations

from datetime import UTC, datetime
import logging
from typing import TYPE_CHECKING, Any
import uuid

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.platform.audit.chain import (
    AUDIT_CHAIN_LOCK_KEY,
    REDACTED_COLUMNS,
    append_failure_entry,
    compute_entry_hash,
)
from app.platform.audit.context import (
    audit_actor_id_var,
    audit_reason_var,
    audit_request_id_var,
)
from app.platform.audit.models import (
    SYSTEM_ACTOR_UUID,
    AuditActorIdentity,
    AuditLogEntry,
)
from app.platform.db.base import truncate_to_ms, utc_now

if TYPE_CHECKING:

    from sqlalchemy.ext.asyncio import AsyncSession

_LOG = logging.getLogger(__name__)

# ── Actor identity upsert ─────────────────────────────────────────────────────

async def upsert_actor_identity(
    session: AsyncSession,
    *,
    account_id: uuid.UUID | None,
    role: str,
    display_name: str,
    email: str | None,
    is_system: bool = False,
) -> uuid.UUID:
    """Insert or return the existing actor identity UUID.

    Uses PostgreSQL's ``ON CONFLICT DO NOTHING`` so concurrent writers don't
    race, then falls back to a SELECT if the row already existed.
    """
    identity_id = uuid.uuid4()
    stmt = (
        pg_insert(AuditActorIdentity)
        .values(
            id=identity_id,
            account_id=account_id,
            role=role,
            display_name=display_name,
            email=email,
            is_system=is_system,
        )
        .on_conflict_do_nothing(
            constraint="uq_audit_actor_identities_account_id_role"
        )
        .returning(AuditActorIdentity.id)
    )
    result = await session.execute(stmt)
    row = result.scalar_one_or_none()
    if row is not None:
        return uuid.UUID(str(row))

    # Row existed already — fetch it.
    existing = await session.scalar(
        select(AuditActorIdentity.id).where(
            AuditActorIdentity.account_id == account_id,
            AuditActorIdentity.role == role,
        )
    )
    return uuid.UUID(str(existing))


async def ensure_system_actor(session: AsyncSession) -> uuid.UUID:
    """Guarantee the sentinel ``system`` actor row exists, return its UUID."""
    stmt = (
        pg_insert(AuditActorIdentity)
        .values(
            id=SYSTEM_ACTOR_UUID,
            account_id=None,
            role="system",
            display_name="system",
            email=None,
            is_system=True,
        )
        .on_conflict_do_nothing(index_elements=["id"])
        .returning(AuditActorIdentity.id)
    )
    result = await session.execute(stmt)
    row = result.scalar_one_or_none()
    return SYSTEM_ACTOR_UUID if row is None else uuid.UUID(str(row))


# ── Hash-chain append ─────────────────────────────────────────────────────────

async def append_audit_entry(
    session: AsyncSession,
    *,
    actor_identity_id: uuid.UUID,
    action: str,
    entity_type: str,
    entity_id: str,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
    reason: str | None = None,
    request_id: str | None = None,
    outcome: str = "success",
    error_type: str | None = None,
    occurred_at: datetime | None = None,
) -> AuditLogEntry:
    """Append one entry to the audit log inside the current transaction.

    Takes ``pg_advisory_xact_lock(AUDIT_CHAIN_LOCK_KEY)`` before reading the
    chain tail so concurrent writers serialise rather than fork the chain.

    The lock is transaction-scoped: it is released automatically when the
    caller's transaction commits or rolls back (R8 AC2).
    """
    # 1. Serialize chain access.
    await session.execute(
        text("SELECT pg_advisory_xact_lock(:key)"),
        {"key": AUDIT_CHAIN_LOCK_KEY},
    )

    # 2. Read the tail (most-recent entry_hash).
    tail_hash: bytes | None = await session.scalar(
        select(AuditLogEntry.entry_hash)
        .order_by(AuditLogEntry.id.desc())
        .limit(1)
        .with_for_update(skip_locked=False)  # waits; the advisory lock above guards us
    )

    # 3. Build the entry fields used for hashing (no hash columns yet). The
    #    timestamp is hashed as stored, at ms precision, or the verifier
    #    re-hashes a different value (Bug 5).
    ts = truncate_to_ms(occurred_at) if occurred_at else utc_now()
    entry_fields: dict[str, Any] = {
        "actor_identity_id": str(actor_identity_id),
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "before": before,
        "after": after,
        "reason": reason,
        "request_id": request_id,
        "outcome": outcome,
        "error_type": error_type,
        "occurred_at": ts,
    }

    # 4. Compute entry hash.
    entry_hash = compute_entry_hash(entry_fields, tail_hash)

    # 5. Insert.
    entry = AuditLogEntry(
        occurred_at=ts,
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
        prev_hash=tail_hash,
        entry_hash=entry_hash,
    )
    session.add(entry)
    # Flush so the DB assigns ``id`` — the service layer may need it.
    await session.flush([entry])
    return entry


# ── Hash-chain verification (used by the ARQ job) ────────────────────────────

async def verify_chain_window(
    session: AsyncSession,
    *,
    from_id: int,
    to_id: int,
) -> tuple[bool, int | None]:
    """Verify the hash chain from ``from_id`` to ``to_id`` (inclusive).

    Returns ``(ok, first_bad_id)`` where ``first_bad_id`` is the ``id`` of the
    first entry whose hash doesn't match, or ``None`` when ``ok`` is ``True``.
    """
    rows = list(
        (
            await session.execute(
                select(
                    AuditLogEntry.id,
                    AuditLogEntry.prev_hash,
                    AuditLogEntry.entry_hash,
                    AuditLogEntry.actor_identity_id,
                    AuditLogEntry.action,
                    AuditLogEntry.entity_type,
                    AuditLogEntry.entity_id,
                    AuditLogEntry.before,
                    AuditLogEntry.after,
                    AuditLogEntry.reason,
                    AuditLogEntry.request_id,
                    AuditLogEntry.outcome,
                    AuditLogEntry.error_type,
                    AuditLogEntry.occurred_at,
                )
                .where(
                    AuditLogEntry.id >= from_id,
                    AuditLogEntry.id <= to_id,
                )
                .order_by(AuditLogEntry.id.asc())
            )
        ).all()
    )

    prev_hash: bytes | None = None
    if rows:
        # Load the entry just before the window to seed prev_hash.
        seed_row = (
            await session.execute(
                select(AuditLogEntry.entry_hash)
                .where(AuditLogEntry.id < from_id)
                .order_by(AuditLogEntry.id.desc())
                .limit(1)
            )
        ).one_or_none()
        prev_hash = seed_row[0] if seed_row else None

    for row in rows:
        entry_fields = {
            "actor_identity_id": str(row.actor_identity_id),
            "action": row.action,
            "entity_type": row.entity_type,
            "entity_id": row.entity_id,
            "before": row.before,
            "after": row.after,
            "reason": row.reason,
            "request_id": row.request_id,
            "outcome": row.outcome,
            "error_type": row.error_type,
            "occurred_at": row.occurred_at,
        }
        expected_hash = compute_entry_hash(entry_fields, prev_hash)
        if row.entry_hash != expected_hash:
            return False, row.id
        prev_hash = row.entry_hash

    return True, None


# ── Search queries (R8 AC4) ───────────────────────────────────────────────────

async def search_audit_log(
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
    """Return a page of entries matching the given filters.

    Uses keyset pagination on ``(occurred_at DESC, id DESC)`` so the 7-year
    table never uses OFFSET.

    Returns ``(entries, has_more)``.
    """
    stmt = select(AuditLogEntry).order_by(
        AuditLogEntry.occurred_at.desc(),
        AuditLogEntry.id.desc(),
    )

    if actor_account_id is not None:
        # Join through audit_actor_identities to filter by account UUID.
        stmt = stmt.join(
            AuditActorIdentity,
            AuditLogEntry.actor_identity_id == AuditActorIdentity.id,
        ).where(AuditActorIdentity.account_id == actor_account_id)

    if action is not None:
        stmt = stmt.where(AuditLogEntry.action == action)
    if entity_type is not None:
        stmt = stmt.where(AuditLogEntry.entity_type == entity_type)
    if entity_id is not None:
        stmt = stmt.where(AuditLogEntry.entity_id == entity_id)
    if from_dt is not None:
        stmt = stmt.where(AuditLogEntry.occurred_at >= from_dt)
    if to_dt is not None:
        stmt = stmt.where(AuditLogEntry.occurred_at <= to_dt)
    if after_id is not None:
        stmt = stmt.where(AuditLogEntry.id < after_id)

    stmt = stmt.limit(page_size + 1)

    rows = list((await session.scalars(stmt)).all())
    has_more = len(rows) > page_size
    return rows[:page_size], has_more


async def get_max_audit_id(session: AsyncSession) -> int | None:
    """Return the highest ``id`` in audit_log, or ``None`` if empty."""
    return await session.scalar(select(func.max(AuditLogEntry.id)))


async def anonymise_actor(
    session: AsyncSession,
    *,
    account_id: uuid.UUID,
    anonymised_at: datetime | None = None,
) -> int:
    """Null out personal fields for all identity rows belonging to ``account_id``.

    Called by the Admin deletion path.  The hash-chained ``audit_log`` rows are
    left byte-identical — only the ``audit_actor_identities`` sidecar is touched.
    Returns the number of rows anonymised.
    """
    ts = anonymised_at or datetime.now(UTC)
    rows = list(
        (
            await session.scalars(
                select(AuditActorIdentity).where(
                    AuditActorIdentity.account_id == account_id,
                    AuditActorIdentity.anonymised_at.is_(None),
                )
            )
        ).all()
    )
    for row in rows:
        row.display_name = "[anonymised]"
        row.email = None
        row.anonymised_at = ts

    if rows:
        await session.flush(rows)

    return len(rows)


__all__ = [
    "AUDIT_CHAIN_LOCK_KEY",
    "REDACTED_COLUMNS",
    "anonymise_actor",
    "append_audit_entry",
    "append_failure_entry",
    "audit_actor_id_var",
    "audit_reason_var",
    "audit_request_id_var",
    "compute_entry_hash",
    "ensure_system_actor",
    "get_max_audit_id",
    "search_audit_log",
    "upsert_actor_identity",
    "verify_chain_window",
]
