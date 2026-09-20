"""Pydantic v2 schemas for the reporting module (R28, R29, Section 21).

Request and response DTOs for all reporting and export endpoints.
No SQLAlchemy or FastAPI imports are allowed here.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.modules.reporting.models import ExportStatus


# ── Activity report ────────────────────────────────────────────────────────────


class ActivityReportParams(BaseModel):
    """Query parameters for GET /admin/reports/activity."""

    date_from: datetime | None = Field(
        default=None, description="Inclusive UTC lower bound on created_at / submitted_at"
    )
    date_to: datetime | None = Field(
        default=None, description="Inclusive UTC upper bound"
    )
    jd_id: UUID | None = Field(
        default=None, description="Filter applications by this Job Description"
    )


class ActivityReportDTO(BaseModel):
    """Summary metrics for the activity report (R28 AC2)."""

    period_from: datetime | None
    period_to: datetime | None

    # Registrations
    candidates_registered: int = 0
    candidates_rejected: int = 0
    candidates_approved: int = 0

    # CVs (any state upload)
    cv_versions_uploaded: int = 0

    # Applications
    applications_submitted: int = 0
    applications_under_review: int = 0
    applications_forwarded: int = 0
    applications_closed: int = 0


# ── Candidate progress ─────────────────────────────────────────────────────────


class CandidateProgressParams(BaseModel):
    """Query parameters for GET /admin/reports/candidate-progress."""

    after_id: UUID | None = None
    limit: int = Field(default=20, ge=1, le=100)


class CandidateApplicationStatus(BaseModel):
    """One application's status entry on the progress row."""

    application_id: UUID
    jd_id: UUID
    jd_title: str
    status: str
    submitted_at: datetime


class CandidateProgressRow(BaseModel):
    """One row in the candidate-progress report (R28 AC4)."""

    account_id: UUID
    email: str
    account_status: str
    created_at: datetime
    applications: list[CandidateApplicationStatus]


class CandidateProgressReport(BaseModel):
    """Paginated candidate-progress report."""

    rows: list[CandidateProgressRow]
    has_next: bool
    next_cursor: UUID | None


# ── Export request / status ────────────────────────────────────────────────────


class ExportRequest(BaseModel):
    """Body for POST /admin/exports/{entity}."""

    date_from: datetime | None = None
    date_to: datetime | None = None
    jd_id: UUID | None = None


class ExportStatusDTO(BaseModel):
    """Response for both POST /admin/exports/{entity} and GET /admin/exports/{job_id}."""

    job_id: UUID
    entity_type: str
    status: ExportStatus
    download_url: str | None = None
    expires_at: datetime | None = None
    error_message: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


__all__ = [
    "ActivityReportDTO",
    "ActivityReportParams",
    "CandidateApplicationStatus",
    "CandidateProgressParams",
    "CandidateProgressReport",
    "CandidateProgressRow",
    "ExportRequest",
    "ExportStatusDTO",
]
