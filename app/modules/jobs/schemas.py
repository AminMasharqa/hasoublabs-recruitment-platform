"""Pydantic v2 schemas for the jobs module (R6, Section 17)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, HttpUrl, field_validator, model_validator

from app.platform.db.enums import (
    ApplicationChannel,
    EmploymentType,
    ExperienceLevel,
    JdStatus,
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

    model_config = {"from_attributes": True}


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
    extracted_fields: dict
    skill_candidates: list
    created_at: datetime
    expires_at: datetime

    model_config = {"from_attributes": True}


__all__ = [
    "JdAdminListParams",
    "JdBrowseParams",
    "JdBrowsePage",
    "JdCreateRequest",
    "JdExtractionDraftDTO",
    "JdExtractTextRequest",
    "JdExtractUrlRequest",
    "JdUpdateRequest",
    "JobDescriptionDTO",
    "SetApplicationChannelRequest",
]
