"""Repository for job collection operations (R23).

Manages CRUD for JobSource, JobCollectionRun, and JobDescriptionFlag models.
All functions follow async patterns and take session as the first argument.
"""

from __future__ import annotations

from typing import Any
import uuid  # noqa: TC003 — resolved at runtime by SQLAlchemy ORM

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: TC002 — resolved at runtime

from app.modules.jobs.models import (
    JobCollectionRun,
    JobDescriptionFlag,
    JobSource,
)
from app.platform.db.base import utc_now
from app.platform.db.enums import (
    CollectionRunStatus,  # noqa: TC001 — resolved at runtime by SQLAlchemy ORM
    JobSourceType,  # noqa: TC001 — resolved at runtime by SQLAlchemy ORM
)

# ── JobSource queries ─────────────────────────────────────────────────────────


async def create_source(
    session: AsyncSession,
    *,
    name: str,
    source_type: JobSourceType,
    slug: str,
    workday_tenant: str | None,
    workday_site: str | None,
    poll_interval_hours: int,
) -> JobSource:
    """Create a new job source configuration.

    The source starts in enabled state and may be polled by scheduled jobs.
    """
    source = JobSource(
        name=name,
        source_type=source_type,
        slug=slug,
        workday_tenant=workday_tenant,
        workday_site=workday_site,
        poll_interval_hours=poll_interval_hours,
    )
    session.add(source)
    await session.flush()
    return source


async def get_source(
    session: AsyncSession,
    source_id: uuid.UUID,
) -> JobSource | None:
    """Fetch a single JobSource by id."""
    stmt = select(JobSource).where(JobSource.id == source_id)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def get_source_by_type_slug(
    session: AsyncSession,
    source_type: JobSourceType,
    slug: str,
) -> JobSource | None:
    """Fetch a JobSource by its unique (source_type, slug) pair."""
    stmt = select(JobSource).where(
        (JobSource.source_type == source_type) & (JobSource.slug == slug)
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def list_sources(
    session: AsyncSession,
    *,
    enabled_only: bool = False,
    after_id: uuid.UUID | None = None,
    limit: int,
) -> list[JobSource]:
    """List job sources in ascending id order (keyset pagination).

    If ``enabled_only`` is True, only return sources with enabled=True.
    Ordered by id for stable keyset pagination: WHERE id > after_id LIMIT limit.
    """
    stmt = select(JobSource)
    if enabled_only:
        stmt = stmt.where(JobSource.enabled)
    if after_id is not None:
        stmt = stmt.where(JobSource.id > after_id)
    stmt = stmt.order_by(JobSource.id).limit(limit + 1)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def update_source(
    session: AsyncSession,
    source: JobSource,
    **fields: object,
) -> None:
    """Update arbitrary fields on a JobSource ORM object.

    The object is already tracked in the session, so we just setattr and flush.
    """
    for attr, value in fields.items():
        setattr(source, attr, value)
    await session.flush()


async def delete_source(
    session: AsyncSession,
    source: JobSource,
) -> None:
    """Delete a JobSource."""
    await session.delete(source)
    await session.flush()


# ── JobCollectionRun queries ──────────────────────────────────────────────────


async def create_run(
    session: AsyncSession,
    *,
    source_id: uuid.UUID,
) -> JobCollectionRun:
    """Create a new collection run for a source.

    The run starts in RUNNING status with all counters at 0.
    """
    run = JobCollectionRun(source_id=source_id)
    session.add(run)
    await session.flush()
    return run


async def finish_run(
    session: AsyncSession,
    run: JobCollectionRun,
    *,
    status: CollectionRunStatus,
    jobs_fetched: int,
    jobs_created: int,
    jobs_skipped: int,
    jobs_flagged: int,
    error_detail: str | None,
) -> None:
    """Finish a collection run with final status and statistics.

    Sets finished_at to the current time and populates all result counters.
    """
    run.status = status
    run.finished_at = utc_now()
    run.jobs_fetched = jobs_fetched
    run.jobs_created = jobs_created
    run.jobs_skipped = jobs_skipped
    run.jobs_flagged = jobs_flagged
    run.error_detail = error_detail
    await session.flush()


async def list_runs(
    session: AsyncSession,
    source_id: uuid.UUID,
    *,
    after_id: uuid.UUID | None = None,
    limit: int,
) -> list[JobCollectionRun]:
    """List collection runs for a source in ascending id order (keyset pagination).

    Ordered by id: WHERE id > after_id ORDER BY id LIMIT limit.
    """
    stmt = select(JobCollectionRun).where(JobCollectionRun.source_id == source_id)
    if after_id is not None:
        stmt = stmt.where(JobCollectionRun.id > after_id)
    stmt = stmt.order_by(JobCollectionRun.id).limit(limit + 1)
    result = await session.execute(stmt)
    return list(result.scalars().all())


# ── JobDescriptionFlag queries ────────────────────────────────────────────────


async def create_flag(
    session: AsyncSession,
    *,
    source_id: uuid.UUID,
    run_id: uuid.UUID,
    external_url: str,
    raw_payload: dict[str, Any],
    missing_fields: list[str],
) -> JobDescriptionFlag:
    """Create a flag for a job that could not be automatically created.

    The flag is created in unresolved state (resolved_at and resolved_by are NULL).
    """
    flag = JobDescriptionFlag(
        source_id=source_id,
        run_id=run_id,
        external_url=external_url,
        raw_payload=raw_payload,
        missing_fields=missing_fields,
    )
    session.add(flag)
    await session.flush()
    return flag


async def list_flags(
    session: AsyncSession,
    *,
    resolved: bool = False,
    after_id: uuid.UUID | None = None,
    limit: int,
) -> list[JobDescriptionFlag]:
    """List flags in ascending id order (keyset pagination).

    If ``resolved`` is False (default), only unresolved flags (resolved_at IS NULL).
    If ``resolved`` is True, only resolved flags (resolved_at IS NOT NULL).
    Ordered by id: WHERE resolved_at filter AND id > after_id ORDER BY id LIMIT limit.
    """
    stmt = select(JobDescriptionFlag)
    if resolved:
        stmt = stmt.where(JobDescriptionFlag.resolved_at.is_not(None))
    else:
        stmt = stmt.where(JobDescriptionFlag.resolved_at.is_(None))
    if after_id is not None:
        stmt = stmt.where(JobDescriptionFlag.id > after_id)
    stmt = stmt.order_by(JobDescriptionFlag.id).limit(limit + 1)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def resolve_flag(
    session: AsyncSession,
    flag: JobDescriptionFlag,
    *,
    resolved_by: uuid.UUID,
) -> None:
    """Mark a flag as resolved.

    Sets resolved_at to the current time and records who resolved it.
    """
    flag.resolved_at = utc_now()
    flag.resolved_by = resolved_by
    await session.flush()


async def get_flag(
    session: AsyncSession,
    flag_id: uuid.UUID,
) -> JobDescriptionFlag | None:
    """Fetch a single flag by id."""
    stmt = select(JobDescriptionFlag).where(JobDescriptionFlag.id == flag_id)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


# ── JobDescription queries ────────────────────────────────────────────────────


async def external_url_exists(
    session: AsyncSession,
    url: str,
) -> bool:
    """Check if a job description with the given external_url already exists.

    Uses raw SQL for simplicity: SELECT 1 FROM job_descriptions WHERE external_url = :url.
    """
    result = await session.execute(
        text("SELECT 1 FROM job_descriptions WHERE external_url = :url LIMIT 1"),
        {"url": url},
    )
    return result.first() is not None


__all__ = [
    "create_flag",
    "create_run",
    "create_source",
    "delete_source",
    "external_url_exists",
    "finish_run",
    "get_flag",
    "get_source",
    "get_source_by_type_slug",
    "list_flags",
    "list_runs",
    "list_sources",
    "resolve_flag",
    "update_source",
]
