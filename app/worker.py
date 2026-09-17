"""ARQ worker entrypoint.

Run with::

    uv run arq app.worker.WorkerSettings

This module lives outside ``app/platform`` on purpose: it is the one place
allowed to import both the platform layer and the domain modules that own task
handlers, the same role ``app/main.py`` plays for routers. Each module owner
registers their tasks by adding one import to :func:`_register_tasks`.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from app.config import get_settings
from app.platform.jobs.worker import build_worker_settings
from app.platform.mail.config import configure_mail
from app.platform.mail.secrets import ValkeySecretStore
from app.platform.mail.sender import SmtpMailSender, SmtpSettings

if TYPE_CHECKING:
    from collections.abc import Callable

    from sqlalchemy.ext.asyncio import AsyncSession

    from app.config import Settings

_LOG = logging.getLogger(__name__)


def _register_tasks() -> None:
    """Import every module that registers background tasks.

    Import side effects are the registration mechanism, so this must run before
    the worker settings are built.
    """
    import app.platform.mail.tasks  # noqa: F401, PLC0415 - registers drain_email_outbox

    # Module owners add their task module here as their Wave lands:
    # import app.modules.identity.tasks   # expire_verification_codes
    # import app.modules.cvs.tasks        # scan_cv, verify_cv_checksums
    # import app.modules.audit.tasks      # verify_audit_chain
    # import app.modules.jobs.tasks       # extract_jd_from_url / _text
    # import app.modules.reporting.tasks  # generate_export, refresh_report_rollups


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
    _register_tasks()
    _configure_mail(settings)
    return build_worker_settings(
        valkey_url=str(settings.valkey_url),
        session_factory=_build_session_factory(settings),
    )


WorkerSettings = build_settings()
