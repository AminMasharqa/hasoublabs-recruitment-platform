"""Background jobs: ARQ queue, task registry, schedules, dead-letter store.

Producers use :class:`TaskQueue` and :class:`JobName`; handlers register with
:func:`task`. The worker entrypoint is assembled in ``app/worker.py`` because the
platform layer may not import the domain modules that own the handlers.
"""

from app.platform.jobs.catalog import (
    SCHEDULES,
    SCHEDULES_BY_JOB,
    JobName,
    Schedule,
)
from app.platform.jobs.dead_letter import record_dead_letter, record_dead_letter_safely
from app.platform.jobs.models import JobDeadLetter
from app.platform.jobs.queue import (
    ArqTaskQueue,
    RecordingTaskQueue,
    TaskQueue,
    create_arq_pool,
    job_id_for,
)
from app.platform.jobs.registry import (
    DEFAULT_RETRY,
    MAX_WORKER_TRIES,
    RetryPolicy,
    TaskSpec,
    arq_functions,
    clear_registry,
    instrument,
    registered_task,
    registered_tasks,
    task,
)
from app.platform.jobs.runtime import (
    configure_worker_runtime,
    optional_session_factory,
    reset_worker_runtime,
    worker_queue,
    worker_session_factory,
)
from app.platform.jobs.scheduler import LeaderElectedScheduler, LeaderLock
from app.platform.jobs.worker import build_worker_settings, redis_settings

__all__ = [
    "DEFAULT_RETRY",
    "MAX_WORKER_TRIES",
    "SCHEDULES",
    "SCHEDULES_BY_JOB",
    "ArqTaskQueue",
    "JobDeadLetter",
    "JobName",
    "LeaderElectedScheduler",
    "LeaderLock",
    "RecordingTaskQueue",
    "RetryPolicy",
    "Schedule",
    "TaskQueue",
    "TaskSpec",
    "arq_functions",
    "build_worker_settings",
    "clear_registry",
    "configure_worker_runtime",
    "create_arq_pool",
    "instrument",
    "job_id_for",
    "optional_session_factory",
    "record_dead_letter",
    "record_dead_letter_safely",
    "redis_settings",
    "registered_task",
    "registered_tasks",
    "reset_worker_runtime",
    "task",
    "worker_queue",
    "worker_session_factory",
]
