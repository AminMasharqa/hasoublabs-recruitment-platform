"""The ``TaskQueue`` interface and its ARQ adapter.

Producers depend on the :class:`TaskQueue` protocol, never on ARQ. That is the
seam the design reserves for the Phase 2 broker swap (Celery/RabbitMQ or NATS for
AI fan-out): a new adapter, no call-site changes.

Idempotency is structural rather than advisory. Every enqueue takes a natural
idempotency key, which is hashed into the queue's job id; ARQ refuses a second
job with an id already queued or still holding a result, so a duplicated
enqueue (a retried request, two schedulers, an at-least-once upstream) collapses
into one execution.
"""

from __future__ import annotations

from abc import abstractmethod
from dataclasses import dataclass, field
import hashlib
import logging
from typing import TYPE_CHECKING, Any, Final, Protocol, cast, runtime_checkable

if TYPE_CHECKING:
    from datetime import timedelta

    from arq.connections import ArqRedis

    from app.platform.jobs.catalog import JobName

_LOG = logging.getLogger(__name__)

_JOB_ID_DIGEST_LENGTH: Final[int] = 16


def job_id_for(job: JobName, idempotency_key: str) -> str:
    """Derive the queue job id from a job name and its natural key.

    The key is hashed so an arbitrarily long or non-ASCII natural key (an email
    address, an object key) still yields a bounded, safe id.
    """
    digest = hashlib.blake2s(
        idempotency_key.encode("utf-8"),
        digest_size=_JOB_ID_DIGEST_LENGTH,
    ).hexdigest()
    return f"{job.value}:{digest}"


@runtime_checkable
class TaskQueue(Protocol):
    """Enqueue side of the background job system."""

    @abstractmethod
    async def enqueue(
        self,
        job: JobName,
        *args: object,
        idempotency_key: str,
        delay: timedelta | None = None,
        **kwargs: object,
    ) -> str | None:
        """Enqueue ``job``.

        Returns:
            The queue job id, or ``None`` when an identical job is already
            pending — that is the de-duplication signal, not an error.
        """
        ...


class ArqTaskQueue:
    """:class:`TaskQueue` backed by ARQ over Valkey."""

    def __init__(self, pool: ArqRedis) -> None:
        self._pool = pool

    async def enqueue(
        self,
        job: JobName,
        *args: object,
        idempotency_key: str,
        delay: timedelta | None = None,
        **kwargs: object,
    ) -> str | None:
        job_id = job_id_for(job, idempotency_key)
        enqueued = await self._pool.enqueue_job(
            job.value,
            *args,
            _job_id=job_id,
            _defer_by=delay,
            # ARQ types its own reserved kwargs, so a generic mapping has to be
            # widened here; job kwargs are plain JSON-serializable values.
            **cast("dict[str, Any]", kwargs),
        )
        if enqueued is None:
            _LOG.debug("Job %s already pending (job_id=%s); enqueue skipped", job, job_id)
            return None
        return job_id


@dataclass
class RecordingTaskQueue:
    """In-memory :class:`TaskQueue` for development and tests.

    Keeps the same de-duplication semantics as the ARQ adapter so a test that
    asserts "exactly one confirmation was queued" means the same thing here as in
    production.
    """

    enqueued: list[tuple[str, tuple[object, ...], dict[str, object]]] = field(
        default_factory=list
    )
    _seen: set[str] = field(default_factory=set)

    async def enqueue(
        self,
        job: JobName,
        *args: object,
        idempotency_key: str,
        delay: timedelta | None = None,  # noqa: ARG002 - part of the protocol
        **kwargs: object,
    ) -> str | None:
        job_id = job_id_for(job, idempotency_key)
        if job_id in self._seen:
            return None
        self._seen.add(job_id)
        self.enqueued.append((job.value, args, dict(kwargs)))
        return job_id

    def clear(self) -> None:
        self.enqueued.clear()
        self._seen.clear()


async def create_arq_pool(valkey_url: str) -> ArqRedis:
    """Open an ARQ connection pool against ``valkey_url``."""
    from arq.connections import RedisSettings, create_pool  # noqa: PLC0415

    return await create_pool(RedisSettings.from_dsn(valkey_url))
