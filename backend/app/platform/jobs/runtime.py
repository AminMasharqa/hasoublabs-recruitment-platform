"""Worker-process runtime holder: session factory and task queue.

Background jobs need a database session and, occasionally, the queue itself, but
nothing hands them a request scope. The worker configures this holder once at
startup and jobs read it.

This indirection exists so ``platform/jobs`` does not have to guess the API that
Section 2 will expose for sessions. Once ``platform/db`` publishes its session
factory, :func:`configure_worker_runtime` can be called with it verbatim and this
module stays a two-line hand-off.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable

    from sqlalchemy.ext.asyncio import AsyncSession

    from app.platform.jobs.queue import TaskQueue

    SessionFactory = Callable[[], AsyncSession]


@dataclass(slots=True)
class WorkerRuntime:
    """Process-wide dependencies available to background jobs."""

    session_factory: SessionFactory | None = None
    queue: TaskQueue | None = None


_RUNTIME = WorkerRuntime()


def configure_worker_runtime(
    *,
    session_factory: SessionFactory | None = None,
    queue: TaskQueue | None = None,
) -> None:
    """Install the worker's dependencies. Called once from worker startup."""
    if session_factory is not None:
        _RUNTIME.session_factory = session_factory
    if queue is not None:
        _RUNTIME.queue = queue


def reset_worker_runtime() -> None:
    """Clear the runtime (tests)."""
    _RUNTIME.session_factory = None
    _RUNTIME.queue = None


def worker_session_factory() -> SessionFactory:
    """Return the configured session factory.

    Raises:
        RuntimeError: If the worker runtime was never configured — a
            misconfiguration that should fail loudly at first use rather than
            silently skipping database work.
    """
    if _RUNTIME.session_factory is None:
        msg = "Worker runtime has no session factory; call configure_worker_runtime()"
        raise RuntimeError(msg)
    return _RUNTIME.session_factory


def optional_session_factory() -> SessionFactory | None:
    """Return the session factory if configured, else ``None``."""
    return _RUNTIME.session_factory


def worker_queue() -> TaskQueue:
    """Return the configured task queue."""
    if _RUNTIME.queue is None:
        msg = "Worker runtime has no task queue; call configure_worker_runtime()"
        raise RuntimeError(msg)
    return _RUNTIME.queue
