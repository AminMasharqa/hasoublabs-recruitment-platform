"""The web process hands producers a ``TaskQueue``, not the raw ARQ pool.

``CvUploadService`` and ``ExportService`` call ``TaskQueue.enqueue``, but
``_setup_services`` passed them the ``ArqRedis`` pool, which only has
``enqueue_job``. Every CV upload that passed validation therefore answered 500
after storing the file (its scan was never queued), and every export request
stayed pending forever, because ``ExportService`` logs and swallows the failure.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import arq
import pytest

from app.main import _setup_task_queue
from app.platform.jobs.catalog import JobName
from app.platform.jobs.queue import TaskQueue, job_id_for

pytestmark = pytest.mark.unit


class _FakePool:
    def __init__(self) -> None:
        self.jobs: list[tuple[str, dict[str, Any]]] = []

    async def enqueue_job(self, function: str, *args: object, **kwargs: Any) -> object:  # noqa: ANN401
        self.jobs.append((function, kwargs))
        return object()


async def test_producers_get_a_task_queue_over_the_pool(monkeypatch: pytest.MonkeyPatch) -> None:
    pool = _FakePool()

    async def _create_pool(*_args: object, **_kwargs: object) -> _FakePool:
        return pool

    monkeypatch.setattr(arq, "create_pool", _create_pool)
    application = SimpleNamespace(state=SimpleNamespace())
    settings = SimpleNamespace(valkey_url="redis://localhost:6379/0")

    queue = await _setup_task_queue(application, settings)  # type: ignore[arg-type]

    assert isinstance(queue, TaskQueue)
    # The pool itself stays on app.state, so shutdown can close it.
    assert application.state.arq_pool is pool

    await queue.enqueue(JobName.SCAN_CV, version_id="v1", idempotency_key="scan_cv:v1")
    assert pool.jobs == [
        (
            "scan_cv",
            {
                "version_id": "v1",
                "_job_id": job_id_for(JobName.SCAN_CV, "scan_cv:v1"),
                "_defer_by": None,
            },
        ),
    ]
