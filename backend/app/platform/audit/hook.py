"""SQLAlchemy ``before_flush`` audit capture hook (Section 9, Task 9.2).

This replaces the Section 9 mock.  The public surface — ``register_audit_capture``
— is unchanged so ``UnitOfWork`` and any other caller need no edits.

How it works
------------
1. The listener fires *inside the caller's transaction* (before_flush), so audit
   rows share the same ACID boundary as the mutation they describe.  If the
   transaction rolls back, the audit rows roll back with it; the separate-connection
   failure entry (written in ``UnitOfWork.__aexit__``) is the one that survives.
2. For each entity in ``session.new`` / ``session.dirty`` / ``session.deleted``
   the listener builds ``before`` / ``after`` JSONB maps of the changed columns
   only (inserts: before=None; deletes: after=None; updates: only changed attrs).
3. Sensitive columns are replaced with ``"[REDACTED]"`` using the redaction map in
   ``audit.repository``.
4. The actor identity UUID comes from ``audit_actor_id_var`` (set by middleware /
   background-job wrapper).  Falls back to ``SYSTEM_ACTOR_UUID`` if unset.
5. The hash-chain append uses ``session.connection()`` (sync) to execute raw
   INSERTs inside the ongoing flush transaction, taking ``pg_advisory_xact_lock``
   to serialise chain appends.

Captured actions
----------------
* ``<entity_type>.created``   — ``session.new``
* ``<entity_type>.updated``   — ``session.dirty``  (only changed attrs)
* ``<entity_type>.deleted``   — ``session.deleted``

Excluded from capture
---------------------
* ``AuditLogEntry`` itself — capturing audit rows would be infinite recursion.
* ``AuditActorIdentity`` — identity upserts happen within the same transaction;
  capturing them would produce noise with no signal.
* Entities whose ``__tablename__`` is in ``_EXCLUDED_TABLES``.
"""

from __future__ import annotations

import contextlib
from datetime import UTC, datetime
import enum
import logging
from typing import TYPE_CHECKING, Any
import uuid

import sqlalchemy as sa
from sqlalchemy import event, inspect, text
from sqlalchemy.orm import Session as SyncSession

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

_LOG = logging.getLogger(__name__)

_REGISTERED_MARKER = "_hasoub_audit_capture_registered"

#: Tables for which we never emit audit rows (internal platform tables that
#: would produce noise, plus the audit tables themselves to prevent recursion).
_EXCLUDED_TABLES: frozenset[str] = frozenset(
    {
        "audit_log",
        "audit_actor_identities",
        "outbox_emails",
        "notifications",
        "job_dead_letters",
    }
)


def _table_name(instance: object) -> str | None:
    try:
        mapper = inspect(instance)
        tbl = getattr(getattr(mapper, "mapper", None), "local_table", None)
        return str(tbl.name) if tbl is not None else None
    except Exception:  # noqa: BLE001
        return None


def _get_column_value(instance: object, attr_name: str) -> object:
    """Return the current in-memory value of a mapped column."""
    try:
        return getattr(instance, attr_name)
    except Exception:  # noqa: BLE001
        return None


def _coerce(val: object) -> object:
    """Coerce non-JSON-serialisable scalar types to strings."""
    if hasattr(val, "isoformat"):  # datetime / date
        return val.isoformat()
    if isinstance(val, bytes):
        return val.hex()
    if isinstance(val, uuid.UUID):
        return str(val)
    if isinstance(val, enum.Enum):
        return val.value
    return val

def _snapshot(instance: object, table: str) -> dict[str, Any]:
    """Build a full column snapshot of ``instance``, with sensitive fields redacted."""
    from app.modules.audit.repository import (  # noqa: PLC0415
        _REDACTED_SENTINEL,
        REDACTED_COLUMNS,
    )

    try:
        state = inspect(instance)
        mapper = getattr(state, "mapper", None)
        if mapper is None:
            return {}
    except Exception:  # noqa: BLE001
        return {}

    result: dict[str, Any] = {}
    for col in mapper.column_attrs:
        col_name = col.key
        full_key = f"{table}.{col_name}"
        if full_key in REDACTED_COLUMNS:
            result[col_name] = _REDACTED_SENTINEL
        else:
            result[col_name] = _coerce(_get_column_value(instance, col_name))
    return result


def _changed_attrs(instance: object, table: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return (before, after) dicts containing only the *changed* columns."""
    from app.modules.audit.repository import (  # noqa: PLC0415
        _REDACTED_SENTINEL,
        REDACTED_COLUMNS,
    )

    try:
        state = inspect(instance)
        mapper = getattr(state, "mapper", None)
        attrs = getattr(state, "attrs", None)
        if mapper is None or attrs is None:
            return {}, {}
    except Exception:  # noqa: BLE001
        return {}, {}

    before: dict[str, Any] = {}
    after: dict[str, Any] = {}

    for col in mapper.column_attrs:
        col_name = col.key
        try:
            history = attrs[col_name].history
        except (KeyError, AttributeError):
            continue
        if not history.has_changes():
            continue
        full_key = f"{table}.{col_name}"
        if full_key in REDACTED_COLUMNS:
            before[col_name] = _REDACTED_SENTINEL
            after[col_name] = _REDACTED_SENTINEL
        else:
            old_val = history.deleted[0] if history.deleted else None
            new_val = history.added[0] if history.added else None
            before[col_name] = _coerce(old_val)
            after[col_name] = _coerce(new_val)

    return before, after


def _entity_id(instance: object) -> str:
    """Return a string representation of the entity's primary key."""
    try:
        mapper = inspect(instance)
        pk = mapper.identity  # type: ignore[union-attr]
        if pk and len(pk) == 1:
            return str(pk[0])
        return str(pk) if pk else "unknown"
    except Exception:  # noqa: BLE001
        return "unknown"


def _entity_type(instance: object) -> str:
    """Return the class name of the entity (e.g. ``Account``)."""
    return type(instance).__name__


def register_audit_capture(target: object) -> None:  # noqa: ARG001
    """Attach the audit ``before_flush`` listener to the ORM session machinery.

    Args:
        target: accepted for backwards compatibility with existing call sites
            (``UnitOfWork`` passes the process-wide ``async_sessionmaker``; the
            legacy mock passed an ``AsyncSession.sync_session``). The value is
            no longer used to decide *what* to register against — see "Why
            ``Session``" below — but the parameter stays so callers need no
            edits.

    Why ``Session``, not the async target
    --------------------------------------
    SQLAlchemy's async ORM does not support attaching ORM events such as
    ``before_flush`` directly to ``AsyncSession``/``async_sessionmaker``: the
    flush machinery actually runs on the *synchronous* ``Session`` that every
    ``AsyncSession`` proxies internally (``AsyncSession.sync_session``, an
    instance of ``AsyncSession.sync_session_class``). This project does not
    configure a custom ``sync_session_class``, so that class is plain
    ``sqlalchemy.orm.Session`` — the same class shared by every
    ``async_sessionmaker`` in the process. Registering on that class is
    therefore both correct (it's where ``before_flush`` actually fires) and
    equivalent in scope to "every session this app creates", since the app
    creates no sync ORM sessions of its own.

    Idempotency
    -----------
    The registration marker is set on ``Session`` itself (the actual event
    target) rather than on whatever ``target`` was passed in, so calling this
    function once per ``UnitOfWork``/sessionmaker instance — as callers already
    do — still only attaches the listener once per process, and a second call
    with a *different* target object does not double-register it either.
    """
    if getattr(SyncSession, _REGISTERED_MARKER, False):
        return

    @event.listens_for(SyncSession, "before_flush")
    def _capture(  # noqa: ANN202
        session: Session,
        flush_context: object,  # noqa: ARG001
        instances: object,  # noqa: ARG001
    ) -> None:
        """Inspect dirty/new/deleted sets and emit one audit row per entity."""
        from app.modules.audit.models import AuditLogEntry  # noqa: PLC0415
        from app.modules.audit.repository import (  # noqa: PLC0415
            AUDIT_CHAIN_LOCK_KEY,
            audit_actor_id_var,
            audit_reason_var,
            audit_request_id_var,
            compute_entry_hash,
        )

        actor_id = audit_actor_id_var.get()
        reason = audit_reason_var.get()
        request_id = audit_request_id_var.get()

        entries_to_write: list[dict[str, Any]] = []

        # --- new (INSERT) ---
        for obj in list(session.new):
            tbl = _table_name(obj)
            if not tbl or tbl in _EXCLUDED_TABLES:
                continue
            entries_to_write.append(
                {
                    "action": f"{_entity_type(obj)}.created",
                    "entity_type": _entity_type(obj),
                    "entity_id": _entity_id(obj),
                    "before": None,
                    "after": _snapshot(obj, tbl) or None,
                }
            )

        # --- dirty (UPDATE) ---
        for obj in list(session.dirty):
            if not session.is_modified(obj):
                continue
            tbl = _table_name(obj)
            if not tbl or tbl in _EXCLUDED_TABLES:
                continue
            before, after = _changed_attrs(obj, tbl)
            if not before and not after:
                continue
            entries_to_write.append(
                {
                    "action": f"{_entity_type(obj)}.updated",
                    "entity_type": _entity_type(obj),
                    "entity_id": _entity_id(obj),
                    "before": before or None,
                    "after": after or None,
                }
            )

        # --- deleted (DELETE) ---
        for obj in list(session.deleted):
            tbl = _table_name(obj)
            if not tbl or tbl in _EXCLUDED_TABLES:
                continue
            entries_to_write.append(
                {
                    "action": f"{_entity_type(obj)}.deleted",
                    "entity_type": _entity_type(obj),
                    "entity_id": _entity_id(obj),
                    "before": _snapshot(obj, tbl) or None,
                    "after": None,
                }
            )

        if not entries_to_write:
            return

        # Write each entry using the sync connection inside the ongoing flush.
        # session.connection() returns the sync Connection that participates in
        # the current transaction — no new connection, no new transaction.
        try:
            conn = session.connection()

            # Take advisory lock to serialise chain appends.
            conn.execute(
                text("SELECT pg_advisory_xact_lock(:key)"),
                {"key": AUDIT_CHAIN_LOCK_KEY},
            )

            # Read the tail hash.
            tail_row = conn.execute(
                AuditLogEntry.__table__
                .select()
                .with_only_columns(AuditLogEntry.__table__.c.entry_hash)
                .order_by(AuditLogEntry.__table__.c.id.desc())
                .limit(1)
            ).one_or_none()
            prev_hash: bytes | None = tail_row[0] if tail_row else None

            now = datetime.now(UTC)

            for entry_data in entries_to_write:
                entry_fields: dict[str, Any] = {
                    "actor_identity_id": str(actor_id),
                    "action": entry_data["action"],
                    "entity_type": entry_data["entity_type"],
                    "entity_id": entry_data["entity_id"],
                    "before": entry_data["before"],
                    "after": entry_data["after"],
                    "reason": reason,
                    "request_id": request_id,
                    "outcome": "success",
                    "error_type": None,
                    "occurred_at": now,
                }
                entry_hash = compute_entry_hash(entry_fields, prev_hash)

                conn.execute(
                    sa.insert(AuditLogEntry).values(
                        occurred_at=now,
                        actor_identity_id=actor_id,
                        action=entry_data["action"],
                        entity_type=entry_data["entity_type"],
                        entity_id=entry_data["entity_id"],
                        before=entry_data["before"],
                        after=entry_data["after"],
                        reason=reason,
                        request_id=request_id,
                        outcome="success",
                        error_type=None,
                        prev_hash=prev_hash,
                        entry_hash=entry_hash,
                    )
                )
                prev_hash = entry_hash

        except Exception:
            _LOG.exception(
                "audit capture: failed to write %d entries for flush",
                len(entries_to_write),
            )
            # Re-raise so the transaction rolls back — we must never silently
            # drop audit rows for a committed mutation.
            raise

    with contextlib.suppress(AttributeError, TypeError):
        setattr(SyncSession, _REGISTERED_MARKER, True)  # noqa: SLF001


__all__ = ["register_audit_capture"]
