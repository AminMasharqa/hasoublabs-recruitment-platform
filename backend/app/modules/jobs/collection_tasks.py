"""ARQ background task for the job collection pipeline (R23).

Tasks registered here:
- ``collect_jobs_for_source``: run the collection loop for one job source,
  persisting a CollectionRun with counts and any flagged listings (R23 AC3–AC6).
"""

from __future__ import annotations

import logging

from app.platform.jobs.catalog import JobName
from app.platform.jobs.registry import RetryPolicy, task

_LOG = logging.getLogger(__name__)


@task(
    JobName.COLLECT_JOBS_FOR_SOURCE,
    retry=RetryPolicy(max_tries=3, base_delay_seconds=60),
    timeout_seconds=300,
)
async def collect_jobs_for_source(
    ctx: dict[str, object],  # noqa: ARG001 — ARQ context; kept for protocol compliance
    *,
    source_id: str,
    run_id: str,
    **_kwargs: object,
) -> dict[str, object]:
    """Collect jobs from a single ATS source.

    Called by the scheduler (interval-triggered) and by ``trigger_collect``
    (on-demand).  The run row is pre-created by the caller so both paths share
    one CollectionRun id.

    Args:
        ctx:       ARQ context dictionary (job_id, job_try, …).
        source_id: UUID string of the JobSource to collect from.
        run_id:    UUID string of the pre-created CollectionRun.

    Returns:
        ``{"status": "ok"}`` on success, or
        ``{"status": "source_not_found"}`` when the source was deleted between
        the enqueue and the execution — treated as a graceful no-op rather than
        a hard failure so the worker does not retry an inherently unrecoverable
        situation.
    """
    import uuid  # noqa: PLC0415

    from app.modules.jobs.collection_service import JobCollectionService  # noqa: PLC0415
    from app.modules.jobs.errors import JobSourceNotFound  # noqa: PLC0415
    from app.platform.db.unit_of_work import UnitOfWork  # noqa: PLC0415
    from app.platform.jobs.queue import ArqTaskQueue, RecordingTaskQueue  # noqa: PLC0415
    from app.platform.jobs.runtime import worker_session_factory  # noqa: PLC0415

    session_factory = worker_session_factory()

    def _uow_factory() -> UnitOfWork:
        return UnitOfWork(session_factory)  # type: ignore[arg-type]

    # The collection loop does not enqueue further tasks, so a no-enqueue stub
    # satisfies the protocol without needing a live Valkey pool.
    task_queue: ArqTaskQueue = RecordingTaskQueue()  # type: ignore[assignment]

    svc = JobCollectionService(_uow_factory, task_queue=task_queue)
    try:
        await svc.collect_source(uuid.UUID(source_id), run_id=uuid.UUID(run_id))
        return {"status": "ok"}
    except JobSourceNotFound:
        _LOG.warning(
            "collect_jobs_for_source: source %s not found during collection; "
            "it may have been deleted after the task was enqueued",
            source_id,
        )
        return {"status": "source_not_found"}
