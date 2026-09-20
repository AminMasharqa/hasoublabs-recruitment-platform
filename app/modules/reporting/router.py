"""FastAPI routes for the reporting module (R28, R29, Section 21).

All routes are Admin-only (R28 AC1, R28 AC6, R29 AC5).
Services are resolved from ``request.app.state``.
This is the only file in the module that may import from ``fastapi``.

Routes
------
GET  /admin/reports/activity                   200 → ActivityReportDTO
GET  /admin/reports/candidate-progress         200 → CandidateProgressReport
POST /admin/exports/{entity_type}              202 → ExportStatusDTO
GET  /admin/exports/{job_id}                   200 → ExportStatusDTO
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status

from app.modules.reporting.schemas import (
    ActivityReportDTO,
    ActivityReportParams,
    CandidateProgressParams,
    CandidateProgressReport,
    ExportRequest,
    ExportStatusDTO,
)
from app.platform.security.guards import require
from app.platform.security.principal import Principal
from app.platform.security.types import Role

router = APIRouter(tags=["reporting"])

_ADMIN_GUARD = require(roles=frozenset({Role.ADMIN}))


# ── Dependency helpers ─────────────────────────────────────────────────────────


def _report_service(request: Request) -> Any:  # noqa: ANN401
    svc = getattr(request.app.state, "report_service", None)
    if svc is None:
        raise RuntimeError("report_service not wired to app.state")
    return svc


def _export_service(request: Request) -> Any:  # noqa: ANN401
    svc = getattr(request.app.state, "export_service", None)
    if svc is None:
        raise RuntimeError("export_service not wired to app.state")
    return svc


# ── Activity report ────────────────────────────────────────────────────────────


@router.get(
    "/admin/reports/activity",
    response_model=ActivityReportDTO,
    summary="Admin: activity summary report",
    description=(
        "Returns aggregate activity metrics for the given date range: CVs uploaded, "
        "registrations, rejections, applications by status. Filterable by date range "
        "and Job_Description. Admin only (R28 AC1, AC2, AC3). "
        "Every call is recorded in the Audit_Log (R28 AC7)."
    ),
)
async def get_activity_report(
    request: Request,
    date_from: str | None = Query(default=None, description="ISO-8601 UTC lower bound"),
    date_to: str | None = Query(default=None, description="ISO-8601 UTC upper bound"),
    jd_id: UUID | None = Query(default=None, description="Filter applications by JD"),
    principal: Principal = Depends(_ADMIN_GUARD),
) -> ActivityReportDTO:
    """Generate the activity report."""
    from datetime import datetime  # noqa: PLC0415

    def _parse_dt(value: str | None) -> datetime | None:
        if value is None:
            return None
        return datetime.fromisoformat(value.replace("Z", "+00:00"))

    params = ActivityReportParams(
        date_from=_parse_dt(date_from),
        date_to=_parse_dt(date_to),
        jd_id=jd_id,
    )
    svc = _report_service(request)
    return await svc.activity_report(params, principal)


# ── Candidate progress ─────────────────────────────────────────────────────────


@router.get(
    "/admin/reports/candidate-progress",
    response_model=CandidateProgressReport,
    summary="Admin: candidate progress tracking",
    description=(
        "Returns each Candidate's current Account_Status and all their application "
        "statuses across Job_Descriptions. Paginated. Admin only (R28 AC4, AC5). "
        "Every call is recorded in the Audit_Log (R28 AC7)."
    ),
)
async def get_candidate_progress(
    request: Request,
    after_id: UUID | None = Query(default=None, description="Pagination cursor (account id)"),
    limit: int = Query(default=20, ge=1, le=100, description="Page size"),
    principal: Principal = Depends(_ADMIN_GUARD),
) -> CandidateProgressReport:
    """Return paginated candidate progress rows."""
    params = CandidateProgressParams(after_id=after_id, limit=limit)
    svc = _report_service(request)
    return await svc.candidate_progress(params, principal)


# ── Export request ─────────────────────────────────────────────────────────────


@router.post(
    "/admin/exports/{entity_type}",
    response_model=ExportStatusDTO,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Admin: request data export to .xlsx",
    description=(
        "Enqueues an async .xlsx export for ``entity_type`` "
        "(``candidates``, ``job_descriptions``, or ``applications``). "
        "Returns a job id to poll. Admin only (R29 AC1–AC5). "
        "Every request is recorded in the Audit_Log (R29 AC6)."
    ),
)
async def request_export(
    entity_type: str,
    request: Request,
    body: ExportRequest,
    principal: Principal = Depends(_ADMIN_GUARD),
) -> ExportStatusDTO:
    """Enqueue an async export job."""
    svc = _export_service(request)
    return await svc.request_export(entity_type, body, principal)


# ── Export status / download ───────────────────────────────────────────────────


@router.get(
    "/admin/exports/{job_id}",
    response_model=ExportStatusDTO,
    summary="Admin: poll export job status",
    description=(
        "Poll the status of an async export job. When status == ``ready``, "
        "``download_url`` contains a signed, short-lived MinIO pre-signed URL. "
        "Returns 403 if the job does not exist (constant-time denial). Admin only."
    ),
)
async def get_export_status(
    job_id: UUID,
    request: Request,
    principal: Principal = Depends(_ADMIN_GUARD),
) -> ExportStatusDTO:
    """Return the current status of an export job."""
    svc = _export_service(request)
    return await svc.get_export_status(job_id, principal)


__all__ = ["router"]
