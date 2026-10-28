"""Pydantic v2 schemas for the applications module (R7, Section 18).

Request bodies, response DTOs, and cross-module transfer objects.
No SQLAlchemy or FastAPI imports allowed here.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.platform.db.enums import ApplicationStatus


# ── Response DTOs ─────────────────────────────────────────────────────────────


class ApplicationDTO(BaseModel):
    """Full representation of one Application row."""

    id: UUID
    candidate_id: UUID
    jd_id: UUID
    cv_version_id: UUID
    status: str
    routed_channel: str
    submitted_at: datetime
    # Denormalized JD fields for display — populated by the service layer.
    jd_title: str = ""
    jd_company: str = ""
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ApplicationStatusTransitionDTO(BaseModel):
    """One entry in an application's status history (append-only)."""

    id: UUID
    application_id: UUID
    from_status: str | None
    to_status: str
    actor_account_id: UUID | None
    reason: str | None
    occurred_at: datetime

    model_config = {"from_attributes": True}


class ExternalRedirectDTO(BaseModel):
    """Returned when the JD routes applications through an external careers URL.

    R7 AC8: No Application row is created; the candidate is redirected.
    """

    redirect_url: str
    channel: str = "External_Careers_URL"


# ── Request bodies ────────────────────────────────────────────────────────────


class ApplyRequest(BaseModel):
    """Body for POST /jobs/{jd_id}/apply.

    A candidate may optionally name the CV variant to attach. If omitted,
    the service resolves the primary active variant.
    """

    cv_variant_id: UUID | None = None


class UpdateStatusRequest(BaseModel):
    """Body for PATCH /admin/applications/{id}/status (admin only)."""

    status: ApplicationStatus
    reason: str | None = None


class ApplicationListParams(BaseModel):
    """Query parameters for GET /me/applications."""

    after_id: UUID | None = None
    limit: int = Field(default=20, ge=1, le=100)


class JdApplicantsParams(BaseModel):
    """Query parameters for GET /jobs/{jd_id}/applicants."""

    status: ApplicationStatus | None = None
    after_id: UUID | None = None
    limit: int = Field(default=20, ge=1, le=100)


# ── Service return type ───────────────────────────────────────────────────────


@dataclass
class ApplicationResultDTO:
    """Result of ApplicationService.apply().

    For in-platform channels (Senior_Dashboard, Admin_Dashboard), ``application``
    is populated and ``redirect_url`` is None.

    For External_Careers_URL, ``application`` is None and ``redirect_url`` is
    the destination URL (R7 AC8).
    """

    channel: str
    application: ApplicationDTO | None
    redirect_url: str | None


__all__ = [
    "ApplicationDTO",
    "ApplicationListParams",
    "ApplicationResultDTO",
    "ApplicationStatusTransitionDTO",
    "ApplyRequest",
    "ExternalRedirectDTO",
    "JdApplicantsParams",
    "UpdateStatusRequest",
]
