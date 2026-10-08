"""Audit hash-chain primitives shared by every audit writer (R8 AC2, AC5).

Platform-owned so the ``before_flush`` hook, the Unit of Work's failure path and
the authorization-denial handler can write entries without importing
``app.modules``. Chain reads (search, verification) stay in
``app.modules.audit.repository``.

Hash chain algorithm
--------------------
    prev_hash   = entry_hash of the most-recently committed row (NULL for genesis)
    payload     = canonical_json(entry fields, excluding prev_hash and entry_hash)
    entry_hash  = SHA-256( payload || prev_hash_bytes )   # bytes concatenation
"""

from __future__ import annotations

from datetime import UTC, datetime
import hashlib
import logging
from typing import Any
import uuid

import orjson
import sqlalchemy as sa
from sqlalchemy import select, text

from app.platform.audit.models import AuditLogEntry
from app.platform.db.base import truncate_to_ms, utc_now

_LOG = logging.getLogger(__name__)

# ── Advisory lock key ─────────────────────────────────────────────────────────
# Any 64-bit integer known to all writers; must match the chain-verifier.
AUDIT_CHAIN_LOCK_KEY: int = 0x4155445F4348_0001  # "AUDT_CH\x01" as int


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

REDACTED_SENTINEL = "[REDACTED]"


def redact(table_name: str, column_values: dict[str, Any]) -> dict[str, Any]:
    """Replace sensitive column values with the redaction sentinel."""
    out: dict[str, Any] = {}
    for col, val in column_values.items():
        key = f"{table_name}.{col}"
        out[col] = REDACTED_SENTINEL if key in REDACTED_COLUMNS else val
    return out


# ── Canonical JSON serialiser ─────────────────────────────────────────────────


def canonical_json(data: dict[str, Any]) -> bytes:
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
    payload = canonical_json(entry_fields)
    prev_bytes = prev_hash if prev_hash is not None else b""
    return hashlib.sha256(payload + prev_bytes).digest()


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
                    select(AuditLogEntry.entry_hash).order_by(AuditLogEntry.id.desc()).limit(1)
                )
            ).one_or_none()
            tail_hash = tail_row[0] if tail_row else None

            ts = truncate_to_ms(occurred_at) if occurred_at else utc_now()
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


__all__ = [
    "AUDIT_CHAIN_LOCK_KEY",
    "REDACTED_COLUMNS",
    "REDACTED_SENTINEL",
    "append_failure_entry",
    "compute_entry_hash",
    "redact",
]
