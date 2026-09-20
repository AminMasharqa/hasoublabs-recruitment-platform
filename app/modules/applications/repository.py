"""Repository functions for the applications module (R7, Section 18).

All functions are async and take an ``AsyncSession`` as their first argument.
No business logic lives here — only queries, inserts, and bulk updates.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.orm import selectinload

from app.platform.db.base import utc_now
from app.platform.db.enums import (
    ApplicationChannel,
    ApplicationStatus,
    NON_TERMINAL_APPLICATION_STATUSES,
)
from app.modules.applications.models import Application, ApplicationStatusTransition

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


# ── Single-row lookups ────────────────────────────────────────────────────────


async def get_application(
    session: AsyncSession,
    application_id: UUID,
    *,
    candidate_id: UUID | None = None,
) -> Application | None:
    """Return the Application with the given id, or None if not found.

    If ``candidate_id`` is provided, the query is additionally scoped to that
    candidate (used to enforce ownership when a Candidate accesses own data).
    """
    stmt = select(Application).where(Application.id == application_id)
    if candidate_id is not None:
        stmt = stmt.where(Application.candidate_id == candidate_id)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def get_application_with_history(
    session: AsyncSession,
    application_id: UUID,
    *,
    candidate_id: UUID | None = None,
) -> Application | None:
    """Return the Application with its status_transitions eagerly loaded.

    Transitions are ordered by occurred_at ascending so callers can iterate them
    in chronological order without sorting.
    """
    stmt = (
        select(Application)
        .where(Application.id == application_id)
        .options(
            selectinload(Application.status_transitions).order_by(
                ApplicationStatusTransition.occurred_at.asc()
            )
        )
    )
    if candidate_id is not None:
        stmt = stmt.where(Application.candidate_id == candidate_id)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


# ── List queries ──────────────────────────────────────────────────────────────


async def list_candidate_applications(
    session: AsyncSession,
    candidate_id: UUID,
    *,
    after_id: UUID | None,
    limit: int,
) -> list[Application]:
    """Return a page of a candidate's own applications, newest first.

    Keyset pagination is done on (submitted_at DESC, id DESC).  If ``after_id``
    is provided, the query is filtered to rows older than that application.
    """
    stmt = (
        select(Application)
        .where(Application.candidate_id == candidate_id)
        .order_by(Application.submitted_at.desc(), Application.id.desc())
        .limit(limit)
    )
    if after_id is not None:
        # Look up the cursor row first so we can use values not UUIDs for the
        # keyset comparison (the partial index does not cover submitted_at).
        cursor_stmt = select(Application.submitted_at, Application.id).where(
            Application.id == after_id,
            Application.candidate_id == candidate_id,
        )
        cursor_result = await session.execute(cursor_stmt)
        cursor = cursor_result.first()
        if cursor is not None:
            stmt = stmt.where(
                (Application.submitted_at < cursor.submitted_at)
                | (
                    (Application.submitted_at == cursor.submitted_at)
                    & (Application.id < after_id)
                )
            )
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def list_jd_applicants(
    session: AsyncSession,
    jd_id: UUID,
    *,
    status: ApplicationStatus | None,
    after_id: UUID | None,
    limit: int,
) -> list[Application]:
    """Return a page of applications for the given JD, for Senior/Admin views.

    Supports optional status filter and keyset pagination.
    """
    stmt = (
        select(Application)
        .where(Application.jd_id == jd_id)
        .order_by(Application.submitted_at.desc(), Application.id.desc())
        .limit(limit)
    )
    if status is not None:
        stmt = stmt.where(Application.status == status)
    if after_id is not None:
        cursor_stmt = select(Application.submitted_at, Application.id).where(
            Application.id == after_id,
            Application.jd_id == jd_id,
        )
        cursor_result = await session.execute(cursor_stmt)
        cursor = cursor_result.first()
        if cursor is not None:
            stmt = stmt.where(
                (Application.submitted_at < cursor.submitted_at)
                | (
                    (Application.submitted_at == cursor.submitted_at)
                    & (Application.id < after_id)
                )
            )
    result = await session.execute(stmt)
    return list(result.scalars().all())


# ── Aggregate / existence queries ─────────────────────────────────────────────


async def count_candidate_applications_in_window(
    session: AsyncSession,
    candidate_id: UUID,
    *,
    window_start: datetime,
) -> int:
    """Count applications by a candidate submitted on or after ``window_start``.

    Used to enforce the rolling 24-hour rate limit (R7 AC13): if the count is
    already >= 20 the service raises RateLimited before creating another row.
    """
    result = await session.execute(
        select(func.count(Application.id)).where(
            Application.candidate_id == candidate_id,
            Application.submitted_at >= window_start,
        )
    )
    return int(result.scalar_one())


async def has_non_terminal_application(
    session: AsyncSession,
    candidate_id: UUID,
    jd_id: UUID,
) -> bool:
    """Return True if there is a non-terminal application for the given pair.

    Used to enforce the duplicate-prevention check (R7 AC7) before the DB's
    partial unique index fires.
    """
    stmt = select(Application.id).where(
        Application.candidate_id == candidate_id,
        Application.jd_id == jd_id,
        Application.status.in_(list(NON_TERMINAL_APPLICATION_STATUSES)),
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none() is not None


# ── Mutations ─────────────────────────────────────────────────────────────────


async def create_application(
    session: AsyncSession,
    *,
    candidate_id: UUID,
    jd_id: UUID,
    cv_version_id: UUID,
    routed_channel: ApplicationChannel,
) -> Application:
    """Insert a new Application row with status=Submitted and return it."""
    application = Application(
        candidate_id=candidate_id,
        jd_id=jd_id,
        cv_version_id=cv_version_id,
        status=ApplicationStatus.SUBMITTED,
        routed_channel=routed_channel,
        submitted_at=utc_now(),
    )
    session.add(application)
    await session.flush()  # populate the PK without committing
    return application


async def update_application_status(
    session: AsyncSession,
    application: Application,
    new_status: ApplicationStatus,
) -> None:
    """Update the status of an existing Application in-place.

    The caller is responsible for recording a corresponding status transition
    via ``record_status_transition``.
    """
    application.status = new_status
    session.add(application)
    await session.flush()


async def close_applications_for_jd(
    session: AsyncSession,
    jd_id: UUID,
) -> int:
    """Bulk-close all non-terminal applications for a Job_Description (R7 AC11).

    Runs as a single UPDATE statement, scoped to the non-terminal statuses, and
    returns the number of rows updated so the caller can log the cascade.
    """
    result = await session.execute(
        update(Application)
        .where(
            Application.jd_id == jd_id,
            Application.status.in_(list(NON_TERMINAL_APPLICATION_STATUSES)),
        )
        .values(status=ApplicationStatus.CLOSED, updated_at=utc_now())
        .returning(Application.id)
    )
    rows = result.fetchall()
    return len(rows)


# ── Status history ────────────────────────────────────────────────────────────


async def record_status_transition(
    session: AsyncSession,
    *,
    application_id: UUID,
    from_status: ApplicationStatus | None,
    to_status: ApplicationStatus,
    actor_account_id: UUID | None,
    reason: str | None,
) -> ApplicationStatusTransition:
    """Insert one history entry for a status change and return it."""
    transition = ApplicationStatusTransition(
        application_id=application_id,
        from_status=from_status.value if from_status is not None else None,
        to_status=to_status.value,
        actor_account_id=actor_account_id,
        reason=reason,
        occurred_at=utc_now(),
    )
    session.add(transition)
    await session.flush()
    return transition


async def list_status_history(
    session: AsyncSession,
    application_id: UUID,
) -> list[ApplicationStatusTransition]:
    """Return the full status history for an application, oldest first."""
    result = await session.execute(
        select(ApplicationStatusTransition)
        .where(ApplicationStatusTransition.application_id == application_id)
        .order_by(ApplicationStatusTransition.occurred_at.asc())
    )
    return list(result.scalars().all())


__all__ = [
    "close_applications_for_jd",
    "count_candidate_applications_in_window",
    "create_application",
    "get_application",
    "get_application_with_history",
    "has_non_terminal_application",
    "list_candidate_applications",
    "list_jd_applicants",
    "list_status_history",
    "record_status_transition",
    "update_application_status",
]
