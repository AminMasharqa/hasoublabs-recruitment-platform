"""Reporting repository — read-only queries and export-job mutations (R28, R29).

All activity-report and candidate-progress queries operate on existing tables
from other modules via raw SQL (``text()`` or direct ORM imports of the shared
``app.platform.db`` base).  No model from another domain module is imported here;
cross-module table names are referenced as strings.

The only write operations in this module are on the ``report_exports`` table.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.modules.reporting.models import ExportStatus, ReportExport
from app.platform.db.base import utc_now

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


# ── Activity report queries ────────────────────────────────────────────────────


async def count_candidates_registered(
    session: AsyncSession,
    *,
    date_from: datetime | None,
    date_to: datetime | None,
) -> int:
    """Count accounts with Candidate role registered in the given window (R28 AC2)."""
    stmt = text(
        """
        SELECT count(*) FROM accounts
        WHERE 'CANDIDATE' = ANY(roles)
          AND (:date_from IS NULL OR created_at >= :date_from)
          AND (:date_to   IS NULL OR created_at <= :date_to)
        """
    )
    result = await session.execute(stmt, {"date_from": date_from, "date_to": date_to})
    return int(result.scalar_one())


async def count_candidates_by_status(
    session: AsyncSession,
    status: str,
    *,
    date_from: datetime | None,
    date_to: datetime | None,
) -> int:
    """Count Candidate accounts reaching a specific status in the given window."""
    stmt = text(
        """
        SELECT count(*) FROM account_status_transitions
        WHERE to_status = :status
          AND (:date_from IS NULL OR occurred_at >= :date_from)
          AND (:date_to   IS NULL OR occurred_at <= :date_to)
          AND account_id IN (
              SELECT id FROM accounts WHERE 'CANDIDATE' = ANY(roles)
          )
        """
    )
    result = await session.execute(
        stmt, {"status": status, "date_from": date_from, "date_to": date_to}
    )
    return int(result.scalar_one())


async def count_cv_versions_uploaded(
    session: AsyncSession,
    *,
    date_from: datetime | None,
    date_to: datetime | None,
) -> int:
    """Count CV versions created in the given window (any state, R28 AC2)."""
    stmt = text(
        """
        SELECT count(*) FROM cv_versions
        WHERE (:date_from IS NULL OR created_at >= :date_from)
          AND (:date_to   IS NULL OR created_at <= :date_to)
        """
    )
    result = await session.execute(stmt, {"date_from": date_from, "date_to": date_to})
    return int(result.scalar_one())


async def count_applications_by_status(
    session: AsyncSession,
    *,
    date_from: datetime | None,
    date_to: datetime | None,
    jd_id: UUID | None,
) -> dict[str, int]:
    """Return a per-status count of applications in the given window (R28 AC2, AC3)."""
    stmt = text(
        """
        SELECT status, count(*) AS cnt
        FROM applications
        WHERE (:date_from IS NULL OR submitted_at >= :date_from)
          AND (:date_to   IS NULL OR submitted_at <= :date_to)
          AND (:jd_id     IS NULL OR jd_id = :jd_id::uuid)
        GROUP BY status
        """
    )
    result = await session.execute(
        stmt,
        {
            "date_from": date_from,
            "date_to": date_to,
            "jd_id": str(jd_id) if jd_id else None,
        },
    )
    return {row.status: int(row.cnt) for row in result.fetchall()}


# ── Candidate progress queries ─────────────────────────────────────────────────


async def list_candidate_progress(
    session: AsyncSession,
    *,
    after_id: UUID | None,
    limit: int,
) -> list[dict[str, Any]]:
    """Return Candidate accounts with their application statuses (R28 AC4).

    Returns a list of dicts with keys: account_id, email, account_status,
    created_at, applications (list of dicts with jd_id, application_id, status,
    submitted_at, jd_title).

    Keyset pagination on (created_at ASC, id ASC) using after_id.
    """
    # First fetch candidate accounts
    if after_id is not None:
        cursor_stmt = text(
            "SELECT created_at FROM accounts WHERE id = :after_id::uuid"
        )
        cursor_result = await session.execute(cursor_stmt, {"after_id": str(after_id)})
        cursor_row = cursor_result.first()
        after_created_at = cursor_row[0] if cursor_row else None
    else:
        after_created_at = None

    accounts_stmt = text(
        """
        SELECT id, email, status, created_at
        FROM accounts
        WHERE 'CANDIDATE' = ANY(roles)
          AND (:after_created_at IS NULL
               OR created_at > :after_created_at
               OR (created_at = :after_created_at AND id > :after_id::uuid))
        ORDER BY created_at ASC, id ASC
        LIMIT :limit
        """
    )
    accounts_result = await session.execute(
        accounts_stmt,
        {
            "after_created_at": after_created_at,
            "after_id": str(after_id) if after_id else "00000000-0000-0000-0000-000000000000",
            "limit": limit + 1,
        },
    )
    account_rows = accounts_result.fetchall()

    if not account_rows:
        return []

    account_ids = [str(row.id) for row in account_rows[:limit]]
    accounts_map = {
        str(row.id): {
            "account_id": row.id,
            "email": row.email,
            "account_status": row.status,
            "created_at": row.created_at,
            "applications": [],
        }
        for row in account_rows[:limit]
    }

    # Fetch applications for those candidates
    apps_stmt = text(
        """
        SELECT a.id, a.candidate_id, a.jd_id, a.status, a.submitted_at,
               coalesce(j.title, '') AS jd_title
        FROM applications a
        LEFT JOIN job_descriptions j ON j.id = a.jd_id
        WHERE a.candidate_id = ANY(:account_ids::uuid[])
        ORDER BY a.submitted_at DESC
        """
    )
    apps_result = await session.execute(
        apps_stmt, {"account_ids": account_ids}
    )
    for row in apps_result.fetchall():
        cid = str(row.candidate_id)
        if cid in accounts_map:
            accounts_map[cid]["applications"].append(
                {
                    "application_id": row.id,
                    "jd_id": row.jd_id,
                    "jd_title": row.jd_title,
                    "status": row.status,
                    "submitted_at": row.submitted_at,
                }
            )

    return list(accounts_map.values())


# ── Data for Excel exports ──────────────────────────────────────────────────────


async def fetch_candidates_for_export(
    session: AsyncSession,
) -> list[dict[str, Any]]:
    """Return all candidate accounts for .xlsx export (R29 AC1, AC4)."""
    stmt = text(
        """
        SELECT id, email, status, language_preference, created_at
        FROM accounts
        WHERE 'CANDIDATE' = ANY(roles)
        ORDER BY created_at ASC
        """
    )
    result = await session.execute(stmt)
    return [
        {
            "id": str(row.id),
            "email": row.email,
            "status": row.status,
            "language_preference": row.language_preference,
            "created_at": row.created_at.isoformat() if row.created_at else "",
        }
        for row in result.fetchall()
    ]


async def fetch_job_descriptions_for_export(
    session: AsyncSession,
) -> list[dict[str, Any]]:
    """Return all job descriptions for .xlsx export (R29 AC2, AC4)."""
    stmt = text(
        """
        SELECT id, title, company, location, status, employment_type,
               experience_level, work_model, published_at, closed_at, created_at
        FROM job_descriptions
        ORDER BY created_at ASC
        """
    )
    result = await session.execute(stmt)
    return [
        {
            "id": str(row.id),
            "title": row.title,
            "company": row.company,
            "location": row.location or "",
            "status": row.status,
            "employment_type": row.employment_type or "",
            "experience_level": row.experience_level or "",
            "work_model": row.work_model or "",
            "published_at": row.published_at.isoformat() if row.published_at else "",
            "closed_at": row.closed_at.isoformat() if row.closed_at else "",
            "created_at": row.created_at.isoformat() if row.created_at else "",
        }
        for row in result.fetchall()
    ]


async def fetch_applications_for_export(
    session: AsyncSession,
    *,
    date_from: datetime | None,
    date_to: datetime | None,
    jd_id: UUID | None,
) -> list[dict[str, Any]]:
    """Return applications for .xlsx export with optional filters (R29 AC3, AC4)."""
    stmt = text(
        """
        SELECT a.id, a.candidate_id, a.jd_id, a.status, a.routed_channel,
               a.submitted_at, a.created_at,
               coalesce(j.title, '') AS jd_title,
               coalesce(j.company, '') AS jd_company,
               acc.email AS candidate_email
        FROM applications a
        LEFT JOIN job_descriptions j ON j.id = a.jd_id
        LEFT JOIN accounts acc ON acc.id = a.candidate_id
        WHERE (:date_from IS NULL OR a.submitted_at >= :date_from)
          AND (:date_to   IS NULL OR a.submitted_at <= :date_to)
          AND (:jd_id     IS NULL OR a.jd_id = :jd_id::uuid)
        ORDER BY a.submitted_at ASC
        """
    )
    result = await session.execute(
        stmt,
        {
            "date_from": date_from,
            "date_to": date_to,
            "jd_id": str(jd_id) if jd_id else None,
        },
    )
    return [
        {
            "id": str(row.id),
            "candidate_id": str(row.candidate_id),
            "candidate_email": row.candidate_email or "",
            "jd_id": str(row.jd_id),
            "jd_title": row.jd_title,
            "jd_company": row.jd_company,
            "status": row.status,
            "routed_channel": row.routed_channel,
            "submitted_at": row.submitted_at.isoformat() if row.submitted_at else "",
            "created_at": row.created_at.isoformat() if row.created_at else "",
        }
        for row in result.fetchall()
    ]


# ── ReportExport mutations ──────────────────────────────────────────────────────


async def create_export_job(
    session: AsyncSession,
    *,
    entity_type: str,
    filters: dict[str, Any],
    requested_by: UUID,
) -> ReportExport:
    """Insert a new ReportExport row in PENDING status."""
    export = ReportExport(
        entity_type=entity_type,
        status=ExportStatus.PENDING,
        filters_json=filters,
        requested_by=str(requested_by),
    )
    session.add(export)
    await session.flush()
    return export


async def get_export_job(
    session: AsyncSession,
    job_id: UUID,
) -> ReportExport | None:
    """Fetch a ReportExport row by id."""
    return await session.get(ReportExport, job_id)


async def update_export_status(
    session: AsyncSession,
    export: ReportExport,
    status: ExportStatus,
    *,
    object_key: str | None = None,
    download_url: str | None = None,
    expires_at: datetime | None = None,
    error_message: str | None = None,
) -> None:
    """Update the status and optional result fields of a ReportExport."""
    export.status = status
    export.updated_at = utc_now()
    if object_key is not None:
        export.object_key = object_key
    if download_url is not None:
        export.download_url = download_url
    if expires_at is not None:
        export.expires_at = expires_at
    if error_message is not None:
        export.error_message = error_message
    await session.flush()


__all__ = [
    "count_applications_by_status",
    "count_candidates_by_status",
    "count_candidates_registered",
    "count_cv_versions_uploaded",
    "create_export_job",
    "fetch_applications_for_export",
    "fetch_candidates_for_export",
    "fetch_job_descriptions_for_export",
    "get_export_job",
    "list_candidate_progress",
    "update_export_status",
]
