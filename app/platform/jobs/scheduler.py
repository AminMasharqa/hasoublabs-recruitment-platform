"""APScheduler cron schedules behind a Valkey leader lock.

APScheduler runs *inside* the worker process, so N worker replicas would each
fire every schedule N times. A leader lock in Valkey elects one firing node, and
the fired job's idempotency key is derived from the schedule's time slot — belt
and braces, because a lock can be lost and re-acquired mid-tick, but two nodes
firing the same slot still produce the same queue job id and collapse into one
execution.
"""

from __future__ import annotations

import asyncio
import contextlib
from datetime import UTC, timedelta
import logging
import socket
import time
from typing import TYPE_CHECKING, Final
import uuid

from app.platform.jobs.catalog import SCHEDULES

if TYPE_CHECKING:
    from collections.abc import Sequence

    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from redis.asyncio import Redis

    from app.platform.jobs.catalog import Schedule
    from app.platform.jobs.queue import TaskQueue

_LOG = logging.getLogger(__name__)

DEFAULT_LEADER_KEY: Final[str] = "hasoub:scheduler:leader"
DEFAULT_LEADER_TTL: Final[timedelta] = timedelta(seconds=30)

#: Extend the lease only if we still hold it. Comparing before expiring is what
#: stops a node that lost the lock from stealing it back from the new leader.
_RENEW_LUA: Final[str] = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
"""

_RELEASE_LUA: Final[str] = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""


class LeaderLock:
    """Single-holder, TTL-bounded lock used to elect the scheduling node."""

    def __init__(
        self,
        redis: Redis,
        *,
        key: str = DEFAULT_LEADER_KEY,
        ttl: timedelta = DEFAULT_LEADER_TTL,
        identity: str | None = None,
    ) -> None:
        self._redis = redis
        self._key = key
        self._ttl_ms = max(1000, int(ttl.total_seconds() * 1000))
        self._identity = identity or f"{socket.gethostname()}:{uuid.uuid4().hex[:8]}"
        self._held = False
        self._renew = redis.register_script(_RENEW_LUA)
        self._release = redis.register_script(_RELEASE_LUA)

    @property
    def identity(self) -> str:
        return self._identity

    @property
    def is_leader(self) -> bool:
        return self._held

    @property
    def ttl(self) -> timedelta:
        return timedelta(milliseconds=self._ttl_ms)

    async def acquire(self) -> bool:
        """Try to become leader. Idempotent for the current holder."""
        try:
            acquired = await self._redis.set(
                self._key,
                self._identity,
                nx=True,
                px=self._ttl_ms,
            )
            if not acquired:
                # Re-acquire our own lease after a transient failure.
                acquired = bool(
                    await self._renew(keys=[self._key], args=[self._identity, self._ttl_ms])
                )
            self._held = bool(acquired)
        except Exception:  # noqa: BLE001 - Valkey outage means "not leader"
            _LOG.warning("Leader election unavailable; standing down", exc_info=True)
            self._held = False
        return self._held

    async def renew(self) -> bool:
        """Extend the lease; returns whether leadership is still held."""
        try:
            extended = bool(
                await self._renew(keys=[self._key], args=[self._identity, self._ttl_ms])
            )
        except Exception:  # noqa: BLE001 - treat as lost leadership
            _LOG.warning("Could not renew leader lease; standing down", exc_info=True)
            extended = False
        self._held = extended
        return extended

    async def release(self) -> None:
        """Release the lease if we hold it."""
        self._held = False
        with contextlib.suppress(Exception):
            await self._release(keys=[self._key], args=[self._identity])


class LeaderElectedScheduler:
    """Runs the schedule catalog on exactly one node at a time."""

    def __init__(
        self,
        *,
        queue: TaskQueue,
        lock: LeaderLock,
        schedules: Sequence[Schedule] = SCHEDULES,
    ) -> None:
        self._queue = queue
        self._lock = lock
        self._schedules = tuple(schedules)
        self._scheduler: AsyncIOScheduler | None = None
        self._lease_task: asyncio.Task[None] | None = None

    @property
    def is_leader(self) -> bool:
        return self._lock.is_leader

    async def start(self) -> None:
        """Start the lease loop and the APScheduler instance."""
        from apscheduler.schedulers.asyncio import AsyncIOScheduler  # noqa: PLC0415
        from apscheduler.triggers.cron import CronTrigger  # noqa: PLC0415
        from apscheduler.triggers.interval import IntervalTrigger  # noqa: PLC0415

        if self._scheduler is not None:
            return

        await self._lock.acquire()

        scheduler = AsyncIOScheduler(timezone=UTC)
        for schedule in self._schedules:
            trigger = (
                IntervalTrigger(seconds=schedule.interval_seconds, timezone=UTC)
                if schedule.interval_seconds is not None
                else CronTrigger(timezone=UTC, **(schedule.cron or {}))
            )
            scheduler.add_job(
                self._fire,
                trigger=trigger,
                args=[schedule],
                id=f"schedule:{schedule.job.value}",
                # A late tick is pointless for a 10-second drainer and harmful for
                # a nightly sweep, so overlap is disallowed and misfires coalesce.
                coalesce=True,
                max_instances=1,
                misfire_grace_time=max(5, schedule.granularity_seconds),
                replace_existing=True,
            )
        scheduler.start()
        self._scheduler = scheduler
        self._lease_task = asyncio.create_task(self._maintain_lease())
        _LOG.info(
            "Scheduler started with %d schedules (leader=%s, identity=%s)",
            len(self._schedules),
            self._lock.is_leader,
            self._lock.identity,
        )

    async def stop(self) -> None:
        """Stop scheduling and give up leadership."""
        if self._lease_task is not None:
            self._lease_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._lease_task
            self._lease_task = None
        if self._scheduler is not None:
            self._scheduler.shutdown(wait=False)
            self._scheduler = None
        await self._lock.release()

    async def _maintain_lease(self) -> None:
        """Renew the lease, or try to take over when the leader disappears."""
        interval = max(1.0, self._lock.ttl.total_seconds() / 3)
        while True:
            await asyncio.sleep(interval)
            if self._lock.is_leader:
                if not await self._lock.renew():
                    _LOG.info("Lost scheduler leadership")
            elif await self._lock.acquire():
                _LOG.info("Acquired scheduler leadership")

    async def _fire(self, schedule: Schedule) -> None:
        """Enqueue one scheduled job, if we are the leader."""
        if not self._lock.is_leader:
            return
        slot = int(time.time() // schedule.granularity_seconds)
        idempotency_key = f"schedule:{schedule.job.value}:{slot}"
        try:
            job_id = await self._queue.enqueue(
                schedule.job,
                idempotency_key=idempotency_key,
            )
        except Exception:  # noqa: BLE001 - one bad tick must not kill the scheduler
            _LOG.exception("Could not enqueue scheduled job %s", schedule.job)
            return
        if job_id is None:
            _LOG.debug("Scheduled job %s already queued for slot %d", schedule.job, slot)
