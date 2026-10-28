"""ARQ background tasks for the audit module (R8).

Tasks registered here:
- ``verify_audit_chain``: walks a window of the audit hash chain and verifies it,
  resuming from the last verified id so a 7-year table is not re-walked every
  hour (R8 AC8).
- ``create_audit_partition``: keeps ``audit_log``'s monthly RANGE partitions one
  month ahead of the clock. ``audit_log`` has no DEFAULT partition, so a missing
  partition makes every audit insert — and therefore every audited write — fail.

Both handlers are read-mostly and idempotent, so ARQ may retry them freely.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, Final

from app.platform.jobs.catalog import JobName
from app.platform.jobs.registry import RetryPolicy, task

if TYPE_CHECKING:
    from redis.asyncio import Redis

_LOG = logging.getLogger(__name__)

#: Valkey key holding the lowest ``audit_log.id`` not yet known to be valid.
#:
#: The progress marker lives in Valkey rather than a Postgres metadata table so
#: this job needs no migration. Losing it is harmless: the cursor falls back to
#: the genesis entry and the next run re-verifies the whole chain, which is
#: slower but never wrong.
CHAIN_CURSOR_KEY: Final[str] = "hasoub:audit:chain_verify_cursor"

#: First ``audit_log.id`` — the chain's genesis entry.
_GENESIS_ID: Final[int] = 1


@task(
    JobName.VERIFY_AUDIT_CHAIN,
    retry=RetryPolicy(max_tries=2, base_delay_seconds=120),
    timeout_seconds=600,
)
async def verify_audit_chain(
    ctx: dict[str, Any],
    *,
    start_id: int | None = None,
    **_kwargs: object,
) -> dict[str, Any]:
    """Verify the audit hash chain from the stored cursor to the current tail.

    Args:
        ctx: ARQ context. ``ctx["redis"]`` carries the cursor between runs.
        start_id: Verify from this id instead of the stored cursor. Pass
            ``1`` to force a full re-walk (the Admin tamper-check path).

    Returns:
        A summary dict: ``status`` is ``"verified"``, ``"up_to_date"`` or
        ``"tampered"``.

    A mismatch does **not** advance the cursor, so the next run re-reports it,
    and :class:`AuditChainVerifier` has already logged it at CRITICAL. The
    verification is read-only — it never repairs the chain, because a chain that
    can be repaired is not evidence of anything.
    """
    from app.modules.audit.repository import get_max_audit_id  # noqa: PLC0415
    from app.modules.audit.service import AuditChainVerifier  # noqa: PLC0415
    from app.platform.jobs.runtime import worker_session_factory  # noqa: PLC0415

    redis = ctx.get("redis")
    cursor = start_id if start_id is not None else await _load_cursor(redis)
    session_factory = worker_session_factory()

    async with session_factory() as session:
        tail_id = await get_max_audit_id(session)
        if tail_id is None or cursor > tail_id:
            # Empty log, or nothing appended since the last run.
            return {
                "status": "up_to_date",
                "verified_through": tail_id,
                "cursor": cursor,
            }
        ok, bad_id = await AuditChainVerifier().verify_since(session, start_id=cursor)

    if not ok:
        return {
            "status": "tampered",
            "first_bad_id": bad_id,
            "from_id": cursor,
            "through_id": tail_id,
        }

    # Entries appended while the walk was running are picked up next run; the
    # cursor deliberately trails the tail we actually read.
    await _store_cursor(redis, tail_id + 1)
    _LOG.info("audit: chain verified over [%s, %s]", cursor, tail_id)
    return {
        "status": "verified",
        "from_id": cursor,
        "through_id": tail_id,
        "entries": tail_id - cursor + 1,
    }


@task(
    JobName.CREATE_AUDIT_PARTITION,
    retry=RetryPolicy(max_tries=3, base_delay_seconds=60),
    timeout_seconds=60,
)
async def create_audit_partition(
    ctx: dict[str, Any],  # noqa: ARG001 - ARQ passes the context to every handler
    **_kwargs: object,
) -> dict[str, Any]:
    """Ensure the current and next monthly ``audit_log`` partitions exist.

    Both statements are ``CREATE TABLE IF NOT EXISTS``, so this is safe to run
    on every tick and safe to retry mid-run.
    """
    from app.modules.audit.service import (  # noqa: PLC0415
        ensure_current_partition,
        ensure_next_partition,
    )
    from app.platform.jobs.runtime import worker_session_factory  # noqa: PLC0415

    session_factory = worker_session_factory()
    async with session_factory() as session:
        await ensure_current_partition(session)
        await ensure_next_partition(session)
        # DDL runs in the ambient transaction; commit or the partitions vanish.
        await session.commit()

    return {"status": "ensured"}


async def _load_cursor(redis: Redis | None) -> int:
    """Read the stored cursor, falling back to the genesis entry."""
    if redis is None:
        return _GENESIS_ID
    try:
        raw = await redis.get(CHAIN_CURSOR_KEY)
    except Exception:  # noqa: BLE001 - a Valkey miss costs time, not correctness
        _LOG.warning("audit: could not read chain cursor; verifying from genesis")
        return _GENESIS_ID
    if raw is None:
        return _GENESIS_ID
    try:
        return max(_GENESIS_ID, int(raw))
    except (TypeError, ValueError):
        _LOG.warning("audit: chain cursor %r is not an integer; ignoring", raw)
        return _GENESIS_ID


async def _store_cursor(redis: Redis | None, value: int) -> None:
    """Persist the cursor. Failure is logged, never raised."""
    if redis is None:
        return
    try:
        await redis.set(CHAIN_CURSOR_KEY, str(value))
    except Exception:  # noqa: BLE001 - losing the cursor only costs a re-walk
        _LOG.warning("audit: could not persist chain cursor %s", value)


__all__ = [
    "CHAIN_CURSOR_KEY",
    "create_audit_partition",
    "verify_audit_chain",
]
