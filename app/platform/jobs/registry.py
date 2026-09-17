"""Task registry: one decorator, one retry policy, one dead-letter path.

A handler registers itself with :func:`task` and gets three things applied
uniformly, so no individual job has to remember them:

1. **Ambient context** — the ``system`` actor and the queue job id as the request
   id, so audit rows written by a job carry a traceable actor and correlation id
   (design: `system` actor fallback).
2. **Exponential backoff** — re-raised as ARQ's ``Retry`` with a computed defer,
   because ARQ's own retry cadence is fixed and too aggressive for SMTP or a
   virus scanner.
3. **Dead-lettering** — after the last attempt the failure is recorded and
   swallowed, so the queue does not spin on a permanently broken job.
"""

from __future__ import annotations

from dataclasses import dataclass
import functools
import logging
import time
from typing import TYPE_CHECKING, Any, Final

from app.platform.i18n.locales import DEFAULT_LOCALE
from app.platform.jobs.dead_letter import record_dead_letter_safely
from app.platform.middleware.context import (
    SYSTEM_ACTOR,
    bind_request_context,
    reset_request_context,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from arq.worker import Function

    from app.platform.jobs.catalog import JobName

    JobHandler = Callable[..., Awaitable[Any]]

_LOG = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class RetryPolicy:
    """Exponential backoff with a ceiling."""

    max_tries: int = 5
    base_delay_seconds: float = 2.0
    max_delay_seconds: float = 300.0

    def delay_for(self, attempt: int) -> float:
        """Delay before attempt ``attempt + 1`` (``attempt`` is 1-based)."""
        exponent = max(0, attempt - 1)
        return min(self.base_delay_seconds * (2**exponent), self.max_delay_seconds)


#: Sensible default for I/O-bound jobs talking to SMTP, MinIO or ClamAV.
DEFAULT_RETRY: Final[RetryPolicy] = RetryPolicy()

#: Highest ``max_tries`` any registered task may use; the ARQ worker's own
#: ceiling is set from this so our policy is always the binding one.
MAX_WORKER_TRIES: Final[int] = 20


@dataclass(frozen=True, slots=True)
class TaskSpec:
    """A registered background job."""

    name: JobName
    handler: JobHandler
    retry: RetryPolicy = DEFAULT_RETRY
    timeout_seconds: float | None = None
    keep_result_seconds: float | None = None


_REGISTRY: dict[JobName, TaskSpec] = {}


def task(
    name: JobName,
    *,
    retry: RetryPolicy = DEFAULT_RETRY,
    timeout_seconds: float | None = None,
    keep_result_seconds: float | None = None,
) -> Callable[[JobHandler], JobHandler]:
    """Register a coroutine as the handler for ``name``.

    The handler's first parameter is the ARQ context dict::

        @task(JobName.DRAIN_EMAIL_OUTBOX, retry=RetryPolicy(max_tries=3))
        async def drain_email_outbox(ctx: dict[str, Any]) -> int:
            ...
    """
    if retry.max_tries > MAX_WORKER_TRIES:
        msg = f"{name}: max_tries {retry.max_tries} exceeds {MAX_WORKER_TRIES}"
        raise ValueError(msg)

    def decorator(handler: JobHandler) -> JobHandler:
        if name in _REGISTRY:
            msg = f"Job {name} is already registered by {_REGISTRY[name].handler!r}"
            raise ValueError(msg)
        _REGISTRY[name] = TaskSpec(
            name=name,
            handler=handler,
            retry=retry,
            timeout_seconds=timeout_seconds,
            keep_result_seconds=keep_result_seconds,
        )
        return handler

    return decorator


def registered_tasks() -> tuple[TaskSpec, ...]:
    """Return every registered task, in registration order."""
    return tuple(_REGISTRY.values())


def registered_task(name: JobName) -> TaskSpec | None:
    """Return one registered task, or ``None``."""
    return _REGISTRY.get(name)


def clear_registry() -> None:
    """Drop all registrations (tests only)."""
    _REGISTRY.clear()


def instrument(spec: TaskSpec) -> JobHandler:
    """Wrap a handler with context binding, backoff, and dead-lettering."""

    @functools.wraps(spec.handler)
    async def _run(ctx: dict[str, Any], *args: object, **kwargs: object) -> object:
        from arq.worker import Retry  # noqa: PLC0415

        job_id = str(ctx.get("job_id") or f"{spec.name.value}:unknown")
        attempt = int(ctx.get("job_try") or 1)
        tokens = bind_request_context(
            request_id=job_id,
            locale=DEFAULT_LOCALE,
            started_at=time.monotonic(),
            actor=SYSTEM_ACTOR,
        )
        try:
            return await spec.handler(ctx, *args, **kwargs)
        except Retry:
            raise
        except Exception as exc:
            if attempt < spec.retry.max_tries:
                delay = spec.retry.delay_for(attempt)
                _LOG.warning(
                    "Job %s attempt %d/%d failed; retrying in %.1fs",
                    spec.name,
                    attempt,
                    spec.retry.max_tries,
                    delay,
                    exc_info=exc,
                )
                raise Retry(defer=delay) from exc
            _LOG.error(
                "Job %s failed terminally after %d attempts; dead-lettering",
                spec.name,
                attempt,
                exc_info=exc,
            )
            await record_dead_letter_safely(
                job_name=spec.name.value,
                job_id=job_id,
                idempotency_key=str(kwargs.get("idempotency_key"))
                if "idempotency_key" in kwargs
                else None,
                args=args,
                kwargs=kwargs,
                attempts=attempt,
                error=exc,
            )
            return None
        finally:
            reset_request_context(tokens)

    return _run


def arq_functions() -> list[Function]:
    """Build the ARQ function list from the registry."""
    from arq.worker import func  # noqa: PLC0415

    return [
        func(
            instrument(spec),
            name=spec.name.value,
            timeout=spec.timeout_seconds,
            keep_result=spec.keep_result_seconds,
            max_tries=spec.retry.max_tries,
        )
        for spec in registered_tasks()
    ]
