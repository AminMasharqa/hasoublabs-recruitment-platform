"""ARQ worker entrypoint.

Run with::

    uv run arq app.worker.WorkerSettings

This module lives outside ``app/platform`` on purpose: it is the one place
allowed to import both the platform layer and the domain modules that own task
handlers, the same role ``app/main.py`` plays for routers. Each module owner
registers their tasks by adding one entry to :data:`_TASK_MODULES`.
"""

from __future__ import annotations

import importlib
import logging
from typing import TYPE_CHECKING, Final

from app.config import get_settings
from app.platform.jobs.catalog import SCHEDULES, UNIMPLEMENTED_JOBS
from app.platform.jobs.registry import registered_task
from app.platform.jobs.worker import build_worker_settings
from app.platform.mail.config import configure_mail
from app.platform.mail.secrets import ValkeySecretStore
from app.platform.mail.sender import SmtpMailSender, SmtpSettings

if TYPE_CHECKING:
    from collections.abc import Callable

    from sqlalchemy.ext.asyncio import AsyncSession

    from app.config import Settings

_LOG = logging.getLogger(__name__)

#: Modules whose import registers task handlers, with the jobs each one owns.
#:
#: Kept as data rather than a block of import statements so one module cannot
#: take the whole worker down with it (see :func:`_register_tasks`). Each module
#: owner adds one entry here.
_TASK_MODULES: Final[tuple[str, ...]] = (
    # Platform
    "app.platform.mail.tasks",  # drain_email_outbox
    # Wave A
    "app.modules.audit.tasks",  # verify_audit_chain, create_audit_partition
    # Wave B
    "app.modules.identity.tasks",  # expire_verification_codes
    "app.modules.cvs.tasks",  # scan_cv, verify_cv_checksums
    # Wave C
    "app.modules.jobs.tasks",  # extract_jd_from_url, extract_jd_from_text
    # Wave D
    "app.modules.reporting.tasks",  # generate_export, refresh_report_rollups
)


def _register_tasks() -> list[str]:
    """Import every module that registers background tasks.

    Import side effects are the registration mechanism, so this must run before
    the worker settings are built.

    Each module is imported independently and a failure is collected rather than
    raised: ``WorkerSettings`` is built at *import* time, so one bad module used
    to abort the whole process and take every unrelated job family with it —
    including ``drain_email_outbox``, which no email can be delivered without.
    Degrading one family beats serving none. :func:`_report_job_coverage` then
    makes the gap loud, and fatal in production.

    Returns:
        The dotted names of the modules that could not be imported.
    """
    failed: list[str] = []
    for module_name in _TASK_MODULES:
        try:
            importlib.import_module(module_name)
        except Exception:
            _LOG.exception(
                "Task module %s failed to import; the jobs it owns will not be served",
                module_name,
            )
            failed.append(module_name)
    return failed


def _report_job_coverage(settings: Settings, failed_modules: list[str]) -> None:
    """Check that every scheduled job actually has a handler.

    A schedule with no handler is invisible until it fires: APScheduler enqueues
    the job, the worker has no function under that name, and the tick fails —
    every tick, forever. Reporting it once at boot is the difference between a
    one-line startup error and an archaeology session in the worker log.

    Mirrors ``assert_all_routes_have_auth``: a warning in development, a refusal
    to start in production. Jobs listed in
    :data:`~app.platform.jobs.catalog.UNIMPLEMENTED_JOBS` are known gaps and are
    reported at INFO instead.
    """
    missing = [
        schedule.job.value
        for schedule in SCHEDULES
        if registered_task(schedule.job) is None and schedule.job not in UNIMPLEMENTED_JOBS
    ]
    known_gaps = [
        schedule.job.value for schedule in SCHEDULES if schedule.job in UNIMPLEMENTED_JOBS
    ]

    if known_gaps:
        _LOG.info(
            "Scheduled jobs with no handler yet (declared in UNIMPLEMENTED_JOBS,"
            " not enqueued): %s",
            ", ".join(sorted(known_gaps)),
        )

    if not missing and not failed_modules:
        return

    parts = ["Boot-time job registration check FAILED."]
    if failed_modules:
        parts.append("These task modules did not import:")
        parts.extend(f"  - {name}" for name in failed_modules)
    if missing:
        parts.append("These scheduled jobs have no registered handler:")
        parts.extend(f"  - {name}" for name in sorted(missing))
        parts.append(
            "Register each with @task(JobName...) or add it to UNIMPLEMENTED_JOBS."
        )
    msg = "\n".join(parts)

    if settings.is_production:
        raise RuntimeError(msg)
    _LOG.error(msg)


def _build_session_factory(settings: Settings) -> Callable[[], AsyncSession]:
    """Open the worker's database session factory.

    PROVISIONAL: Section 2 (Khalid) owns the engine and session factory. When
    ``platform/db`` publishes one, this function becomes a single import of it —
    the worker only needs "something callable that returns a session".
    """
    from sqlalchemy.ext.asyncio import (  # noqa: PLC0415
        async_sessionmaker,
        create_async_engine,
    )

    engine = create_async_engine(
        str(settings.database_url),
        pool_pre_ping=True,
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
    )
    return async_sessionmaker(engine, expire_on_commit=False)


def _configure_mail(settings: Settings) -> None:
    """Install the SMTP transport and the send-time secret store."""
    from redis.asyncio import Redis  # noqa: PLC0415

    configure_mail(
        sender=SmtpMailSender(
            SmtpSettings(
                host=settings.smtp_host,
                port=settings.smtp_port,
                username=settings.smtp_username,
                password=settings.smtp_password,
                from_address=settings.smtp_from_address,
                from_name=settings.smtp_from_name,
                # Mailpit in development speaks plain SMTP; a provider endpoint
                # is reached over STARTTLS.
                start_tls=settings.is_production or settings.app_env == "staging",
            )
        ),
        secret_store=ValkeySecretStore(Redis.from_url(str(settings.valkey_url))),
    )


def build_settings() -> type:
    """Assemble the ARQ worker settings class."""
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)
    failed_modules = _register_tasks()
    _report_job_coverage(settings, failed_modules)
    _configure_mail(settings)
    return build_worker_settings(
        valkey_url=str(settings.valkey_url),
        session_factory=_build_session_factory(settings),
    )


WorkerSettings = build_settings()
