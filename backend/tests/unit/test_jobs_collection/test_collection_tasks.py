"""Unit tests for collection_tasks.py (Task 8, R23)."""

from __future__ import annotations

import pytest

from app.platform.jobs.catalog import UNIMPLEMENTED_JOBS, JobName

pytestmark = pytest.mark.unit


def test_collect_jobs_for_source_task_is_not_unimplemented() -> None:
    """COLLECT_JOBS_FOR_SOURCE must be removed from UNIMPLEMENTED_JOBS once wired."""
    assert JobName.COLLECT_JOBS_FOR_SOURCE not in UNIMPLEMENTED_JOBS


def test_collect_jobs_for_source_task_is_registered() -> None:
    """Importing collection_tasks registers the handler in the global registry."""
    import app.modules.jobs.collection_tasks  # noqa: F401 — trigger registration

    from app.platform.jobs.registry import registered_task

    spec = registered_task(JobName.COLLECT_JOBS_FOR_SOURCE)
    assert spec is not None
    assert spec.name == JobName.COLLECT_JOBS_FOR_SOURCE


def test_dispatch_jobs_collection_task_is_registered() -> None:
    """Importing collection_tasks also registers the dispatcher handler."""
    import app.modules.jobs.collection_tasks  # noqa: F401 — trigger registration

    from app.platform.jobs.registry import registered_task

    spec = registered_task(JobName.DISPATCH_JOB_COLLECTION)
    assert spec is not None
    assert spec.name == JobName.DISPATCH_JOB_COLLECTION


def test_dispatch_jobs_collection_is_not_unimplemented() -> None:
    assert JobName.DISPATCH_JOB_COLLECTION not in UNIMPLEMENTED_JOBS


@pytest.mark.asyncio
async def test_collect_task_handles_missing_source_gracefully() -> None:
    """If collect_source raises JobSourceNotFound, the task returns source_not_found.

    The source may be deleted between the time the task was enqueued and when the
    worker picks it up.  The task must not re-raise — a dead-letter entry for an
    inherently unrecoverable situation would be misleading noise.
    """
    from unittest.mock import AsyncMock, MagicMock, patch
    import uuid

    from app.modules.jobs.collection_tasks import collect_jobs_for_source
    from app.modules.jobs.errors import JobSourceNotFound

    source_id = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    ctx: dict = {}

    mock_service = MagicMock()
    mock_service.collect_source = AsyncMock(side_effect=JobSourceNotFound())

    with (
        patch("app.platform.jobs.runtime.worker_session_factory", return_value=MagicMock()),
        patch(
            "app.modules.jobs.collection_service.JobCollectionService",
            return_value=mock_service,
        ),
    ):
        result = await collect_jobs_for_source(ctx, source_id=source_id, run_id=run_id)

    assert result == {"status": "source_not_found"}
