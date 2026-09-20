"""Audit log persistence — hash chain, actor upsert, and search queries (R8).

This module is the single place that writes to ``audit_log`` and reads from it.
The public surface used by the service layer is entirely async; the
``write_failure_entry_sync`` function uses a *synchronous* engine (asyncpg
cannot be driven in a thread-pool context) — it is called only from the
``UnitOfWork.__aexit__`` rollback path on a dedicated short-lived connection.

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

from contextvars import ContextVar
from datetime import UTC, datetime
import hashlib
import logging
from typing import TYPE_CHECKING, Any
import uuid

import orjson
import sqlalchemy as sa
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.modules.audit.models import (
    SYSTEM_ACTOR_UUID,
    AuditActorIdentity,
    AuditLogEntry,
)

if TYPE_CHECKING:

    from sqlalchemy.ext.asyncio import AsyncSession

_LOG = logging.getLogger(__name__)

# ── Advisory lock key ─────────────────────────────────────────────────────────
# Any 64-bit integer known to all writers; must match the chain-verifier.
AUDIT_CHAIN_LOCK_KEY: int = 0x4155445F4348_0001  # "AUDT_CH\x01" as int


# ── Context variables set by middleware ───────────────────────────────────────
# The auth middleware (Section 5) sets these at the start of every request.
# Background jobs set them directly before their operation.

#: The current actor identity UUID.  ``SYSTEM_ACTOR_UUID`` when no user is
#: authenticated (background jobs, startup hooks).
audit_actor_id_var: ContextVar[uuid.UUID] = ContextVar(
    "audit_actor_id", default=SYSTEM_ACTOR_UUID
)

#: Free-text reason for the current operation (e.g. rejection reason).
audit_reason_var: ContextVar[str | None] = ContextVar(
    "audit_reason", default=None
)

#: Request ID propagated from the middleware (``request.state.request_id``).
audit_request_id_var: ContextVar[str | None] = ContextVar(
    "audit_request_id", default=None
)


# ── Sensitive-column redaction map ────────────────────────────────────────────
# Columns whose *values* must never appear in audit JSONB (R8 AC2, R2 AC15).
# Values are replaced with the string ``"[REDACTED]"`` in the before/after maps.
# Key: ``"table_name.column_name"``.
REDACTED_COLUMNS: frozenset[str] = frozenset(
    {
        "residency_proofs.value_enc",
        "residency_proofs.value_digest",
        "accounts.password_hash",
        "email_verifications.code_hash",
        "email_verifications.code_digest",
    }
)

_REDACTED_SENTINEL = "[REDACTED]"


def _redact(table_name: str, column_values: dict[str, Any]) -> dict[str, Any]:
    """Replace sensitive column values with the redaction sentinel."""
    out: dict[str, Any] = {}
    for col, val in column_values.items():
        key = f"{table_name}.{col}"
        out[col] = _REDACTED_SENTINEL if key in REDACTED_COLUMNS else val
    return out


# ── Canonical JSON serialiser ─────────────────────────────────────────────────

def _canonical_json(data: dict[str, Any]) -> bytes:
    """Deterministic JSON: sorted keys, no whitespace, UTC datetimes as ISO-8601."""

    def _default(obj: object) -> object:
        if isinstance(obj, datetime):
            return obj.astimezone(UTC).isoformat()
        if isinstance(obj, uuid.UUID):
            return str(obj)
        if isinstance(obj, bytes):
            return obj.hex()
        raise TypeError(type(obj))

    return orjson.dumps(data, option=orjson.OPT_SORT_KEYS, default=_default)


# ── Hash computation ──────────────────────────────────────────────────────────

def compute_entry_hash(
    entry_fields: dict[str, Any],
    prev_hash: bytes | None,
) -> bytes:
    """SHA-256( canonical_json(entry_fields) || prev_hash_bytes ).

    ``entry_fields`` must NOT include ``prev_hash`` or ``entry_hash``.
    """
    payload = _canonical_json(entry_fields)
    prev_bytes = prev_hash if prev_hash is not None else b""
    return hashlib.sha256(payload + prev_bytes).digest()


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

    # 3. Build the entry fields used for hashing (no hash columns yet).
    ts = occurred_at or datetime.now(UTC)
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


# ── Separate-connection failure entry ─────────────────────────────────────────

async def append_failure_entry(
    *,
    engine_url: str,
    actor_identity_id: uuid.UUID,
    action: str,
    entity_type: str,
    entity_id: str,
    error_type: str,
    reason: str | None = None,
    request_id: str | None = None,
    occurred_at: datetime | None = None,
) -> None:
    """Write a failure audit entry on a *separate* short-lived connection.

    Called from ``UnitOfWork.__aexit__`` on rollback so the entry survives the
    parent transaction's rollback (R8 AC5).  Idempotent: if writing itself fails,
    the exception is logged and swallowed — losing a failure entry is better than
    masking the original error.
    """
    from sqlalchemy.ext.asyncio import create_async_engine  # noqa: PLC0415

    engine = create_async_engine(engine_url, pool_size=1, max_overflow=0)
    try:
        async with engine.begin() as conn:
            # Take advisory lock in this separate transaction too.
            await conn.execute(
                text("SELECT pg_advisory_xact_lock(:key)"),
                {"key": AUDIT_CHAIN_LOCK_KEY},
            )
            # Read tail in same transaction.
            tail_row = (
                await conn.execute(
                    select(AuditLogEntry.entry_hash)
                    .order_by(AuditLogEntry.id.desc())
                    .limit(1)
                )
            ).one_or_none()
            tail_hash = tail_row[0] if tail_row else None

            ts = occurred_at or datetime.now(UTC)
            entry_fields: dict[str, Any] = {
                "actor_identity_id": str(actor_identity_id),
                "action": action,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "before": None,
                "after": None,
                "reason": reason,
                "request_id": request_id,
                "outcome": "failure",
                "error_type": error_type,
                "occurred_at": ts,
            }
            entry_hash = compute_entry_hash(entry_fields, tail_hash)

            await conn.execute(
                sa.insert(AuditLogEntry).values(
                    occurred_at=ts,
                    actor_identity_id=actor_identity_id,
                    action=action,
                    entity_type=entity_type,
                    entity_id=entity_id,
                    before=None,
                    after=None,
                    reason=reason,
                    request_id=request_id,
                    outcome="failure",
                    error_type=error_type,
                    prev_hash=tail_hash,
                    entry_hash=entry_hash,
                )
            )
    except Exception:
        _LOG.exception(
            "audit: failed to write failure entry for action=%r entity=%s/%s",
            action,
            entity_type,
            entity_id,
        )
    finally:
        await engine.dispose()


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
