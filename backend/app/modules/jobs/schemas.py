"""Pydantic v2 schemas for the jobs module (R6, Section 17, R23)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.platform.db.enums import (
    ApplicationChannel,
    CollectionRunStatus,
    EmploymentType,
    ExperienceLevel,
    JdStatus,
    JobSourceType,
    WorkModel,
)

# ── Request schemas ────────────────────────────────────────────────────────────


class JdCreateRequest(BaseModel):
    """Request body for creating a new Job Description (POST /jobs)."""

    title: str = Field(..., min_length=1, max_length=200)
    company: str = Field(..., min_length=1, max_length=200)
    location: str | None = Field(None, max_length=200)
    work_model: WorkModel | None = None
    employment_type: EmploymentType | None = None
    experience_level: ExperienceLevel | None = None
    description: str | None = Field(None, max_length=10_000)
    external_url: str | None = Field(None, max_length=500)
    application_channel: ApplicationChannel | None = None
    required_skill_terms: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("required_skill_terms", mode="before")
    @classmethod
    def deduplicate_terms(cls, v: list[str]) -> list[str]:
        """Preserve order while removing duplicates."""
        seen: set[str] = set()
        result: list[str] = []
        for term in v:
            if term not in seen:
                seen.add(term)
                result.append(term)
        return result


class JdUpdateRequest(BaseModel):
    """Request body for patching a Job Description (PATCH /jobs/{jd_id}).

    All fields are optional; only supplied fields are applied.
    """

    title: str | None = Field(None, min_length=1, max_length=200)
    company: str | None = Field(None, min_length=1, max_length=200)
    location: str | None = Field(None, max_length=200)
    work_model: WorkModel | None = None
    employment_type: EmploymentType | None = None
    experience_level: ExperienceLevel | None = None
    description: str | None = Field(None, max_length=10_000)
    external_url: str | None = Field(None, max_length=500)
    application_channel: ApplicationChannel | None = None
    required_skill_terms: list[str] | None = Field(None, max_length=20)

    @field_validator("required_skill_terms", mode="before")
    @classmethod
    def deduplicate_terms(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        seen: set[str] = set()
        result: list[str] = []
        for term in v:
            if term not in seen:
                seen.add(term)
                result.append(term)
        return result


class SetApplicationChannelRequest(BaseModel):
    """Request body for PUT /jobs/{jd_id}/application-channel."""

    channel: ApplicationChannel


# ── Browse / list params ───────────────────────────────────────────────────────


class JdBrowseParams(BaseModel):
    """Query parameters for GET /jobs (Open JD browse, any authenticated user)."""

    search: str | None = None
    skills: list[UUID] = Field(default_factory=list)
    location: str | None = None
    work_model: WorkModel | None = None
    employment_type: EmploymentType | None = None
    experience_level: ExperienceLevel | None = None
    # Keyset cursor — both nullable means "first page".
    after_published_at: datetime | None = None
    after_id: UUID | None = None
    limit: int = Field(default=20, ge=1, le=100)

    @model_validator(mode="after")
    def cursor_consistency(self) -> JdBrowseParams:
        """Both cursor fields must be supplied together or not at all."""
        has_ts = self.after_published_at is not None
        has_id = self.after_id is not None
        if has_ts != has_id:
            raise ValueError(
                "after_published_at and after_id must be supplied together"
            )
        return self


class JdAdminListParams(BaseModel):
    """Query parameters for GET /admin/jobs."""

    status: JdStatus | None = None
    after_id: UUID | None = None
    limit: int = Field(default=20, ge=1, le=100)


# ── Response / DTO schemas ─────────────────────────────────────────────────────


class JobDescriptionDTO(BaseModel):
    """Full Job Description response DTO."""

    id: UUID
    creator_account_id: UUID
    title: str
    company: str
    location: str | None
    work_model: WorkModel | None
    employment_type: EmploymentType | None
    experience_level: ExperienceLevel | None
    description: str | None
    external_url: str | None
    status: JdStatus
    application_channel: ApplicationChannel | None
    published_at: datetime | None
    closed_at: datetime | None
    required_skill_ids: list[UUID]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class JdBrowsePage(BaseModel):
    """Paginated list of Job Description DTOs."""

    items: list[JobDescriptionDTO]
    has_next: bool
    next_cursor: str | None


# ── Extraction schemas ─────────────────────────────────────────────────────────


class JdExtractUrlRequest(BaseModel):
    """Request body for POST /jobs/extract:url."""

    url: str = Field(..., max_length=500)


class JdExtractTextRequest(BaseModel):
    """Request body for POST /jobs/extract:text."""

    raw_text: str = Field(..., min_length=1, max_length=10_000)


class JdExtractionDraftDTO(BaseModel):
    """Polling response for an extraction draft."""

    id: UUID
    source: str
    # "pending" | "ready" — workers update extracted_fields when done.
    status: str
    extracted_fields: dict[str, object]
    skill_candidates: list[object]
    created_at: datetime
    expires_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Job collection schemas (R23) ───────────────────────────────────────────────


class JobSourceCreateRequest(BaseModel):
    """Request to create a new job source (POST /job-sources)."""

    name: str = Field(..., min_length=1, max_length=200)
    source_type: JobSourceType
    slug: str = Field(..., min_length=1, max_length=200)
    workday_tenant: str | None = Field(None, max_length=200)
    workday_site: str | None = Field(None, max_length=200)
    poll_interval_hours: int = Field(default=6, ge=1)

    @model_validator(mode="after")
    def workday_fields_required_for_workday(self) -> JobSourceCreateRequest:
        """When source_type is WORKDAY, both workday_tenant and workday_site are required."""
        if self.source_type == JobSourceType.WORKDAY:
            if not self.workday_tenant:
                raise ValueError("workday_tenant is required for WORKDAY source type")
            if not self.workday_site:
                raise ValueError("workday_site is required for WORKDAY source type")
        return self


class JobSourceUpdateRequest(BaseModel):
    """Request to update an existing job source (PATCH /job-sources/{id})."""

    name: str | None = Field(None, min_length=1, max_length=200)
    source_type: JobSourceType | None = None
    slug: str | None = Field(None, min_length=1, max_length=200)
    workday_tenant: str | None = Field(None, max_length=200)
    workday_site: str | None = Field(None, max_length=200)
    poll_interval_hours: int | None = Field(None, ge=1)
    enabled: bool | None = None

    @model_validator(mode="after")
    def workday_fields_required_when_updating_to_workday(
        self,
    ) -> JobSourceUpdateRequest:
        """When updating source_type to WORKDAY, workday_tenant and workday_site required."""
        if self.source_type == JobSourceType.WORKDAY:
            if not self.workday_tenant:
                raise ValueError("workday_tenant is required for WORKDAY source type")
            if not self.workday_site:
                raise ValueError("workday_site is required for WORKDAY source type")
        return self


class JobSourceDTO(BaseModel):
    """Response DTO for a job source."""

    id: UUID
    name: str
    source_type: JobSourceType
    slug: str
    workday_tenant: str | None
    workday_site: str | None
    poll_interval_hours: int
    enabled: bool
    last_polled_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CollectionRunDTO(BaseModel):
    """Response DTO for a job collection run."""

    id: UUID
    source_id: UUID
    started_at: datetime
    finished_at: datetime | None
    jobs_fetched: int
    jobs_created: int
    jobs_skipped: int
    jobs_flagged: int
    error_detail: str | None
    status: CollectionRunStatus

    model_config = ConfigDict(from_attributes=True)


class JobDescriptionFlagDTO(BaseModel):
    """Response DTO for a flagged job description."""

    id: UUID
    source_id: UUID
    run_id: UUID
    external_url: str
    raw_payload: dict[str, object]
    missing_fields: list[str]
    flagged_at: datetime
    resolved_at: datetime | None
    resolved_by: UUID | None

    model_config = ConfigDict(from_attributes=True)


class FlagResolveRequest(BaseModel):
    """Request to resolve a flagged job description."""

    action: Literal["dismiss", "create_jd"]
    jd_data: JdCreateRequest | None = None

    @model_validator(mode="after")
    def jd_data_required_for_create_jd(self) -> FlagResolveRequest:
        """When action is 'create_jd', jd_data must be provided."""
        if self.action == "create_jd" and self.jd_data is None:
            raise ValueError("jd_data is required when action is 'create_jd'")
        return self


class FlagResolveResponse(BaseModel):
    """Response for resolving a flagged job description."""

    flag_id: UUID
    status: Literal["resolved"]
    job_description_id: UUID | None


__all__ = [
    "CollectionRunDTO",
    "FlagResolveRequest",
    "FlagResolveResponse",
    "JdAdminListParams",
    "JdBrowseParams",
    "JdBrowsePage",
    "JdCreateRequest",
    "JdExtractionDraftDTO",
    "JdExtractTextRequest",
    "JdExtractUrlRequest",
    "JdUpdateRequest",
    "JobDescriptionDTO",
    "JobDescriptionFlagDTO",
    "JobSourceCreateRequest",
    "JobSourceDTO",
    "JobSourceUpdateRequest",
    "SetApplicationChannelRequest",
]
