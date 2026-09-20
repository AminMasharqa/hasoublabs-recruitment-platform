"""Pydantic v2 schemas for the profiles module (R4, R4A, Task 15.4)."""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.platform.db.enums import ContactChannelPref, ContactScopePref, EnrolmentStatus, ProfileState

# ── Education ──────────────────────────────────────────────────────────────────


class EducationEntryRequest(BaseModel):
    """Request schema for one education entry."""

    institution: str = Field(..., min_length=1, max_length=200)
    degree: str = Field(..., min_length=1, max_length=100)
    field_of_study: str | None = Field(None, max_length=100)
    enrolment_status: EnrolmentStatus
    start_year: int = Field(..., ge=1900, le=2100)
    end_year: int | None = Field(None, ge=1900, le=2100)


class EducationEntryDTO(BaseModel):
    """Response DTO for one education entry."""

    id: UUID
    institution: str
    degree: str
    field_of_study: str | None
    enrolment_status: EnrolmentStatus
    start_year: int
    end_year: int | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Work Experience ────────────────────────────────────────────────────────────


class WorkExperienceRequest(BaseModel):
    """Request schema for one work experience entry."""

    company: str = Field(..., min_length=1, max_length=200)
    title: str = Field(..., min_length=1, max_length=100)
    start_date: date
    end_date: date | None = None
    description: str | None = Field(None, max_length=2000)


class WorkExperienceDTO(BaseModel):
    """Response DTO for one work experience entry."""

    id: UUID
    company: str
    title: str
    start_date: date
    end_date: date | None
    description: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Skills ─────────────────────────────────────────────────────────────────────


class SkillEntryRequest(BaseModel):
    """Request schema for one skill entry — resolved to a skill_id by the service."""

    term: str = Field(..., min_length=1, max_length=100)
    years_experience: int | None = Field(None, ge=0, le=50)


class SkillEntryDTO(BaseModel):
    """Response DTO for one resolved skill on a candidate profile."""

    skill_id: UUID
    name: str
    years_experience: int | None

    model_config = {"from_attributes": True}


# ── Languages ──────────────────────────────────────────────────────────────────

# Valid proficiency levels per the design.
VALID_PROFICIENCIES: frozenset[str] = frozenset(
    {"Native", "Fluent", "Professional", "Conversational", "Basic"}
)


class LanguageEntryRequest(BaseModel):
    """Request schema for one language entry."""

    language_code: str = Field(..., min_length=2, max_length=10)
    proficiency: str

    @field_validator("proficiency")
    @classmethod
    def validate_proficiency(cls, v: str) -> str:
        if v not in VALID_PROFICIENCIES:
            msg = f"proficiency must be one of: {', '.join(sorted(VALID_PROFICIENCIES))}"
            raise ValueError(msg)
        return v


class LanguageEntryDTO(BaseModel):
    """Response DTO for one language entry."""

    id: UUID
    language_code: str
    proficiency: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Candidate Profile ─────────────────────────────────────────────────────────


class CandidateProfileUpdateRequest(BaseModel):
    """Request body for PUT /me/profile."""

    full_name: str | None = Field(None, min_length=1, max_length=100)
    email: str | None = Field(None, max_length=255)
    phone: str | None = Field(None, max_length=30)
    city: str | None = Field(None, max_length=100)
    summary: str | None = Field(None, max_length=1000)
    linkedin_url: str | None = Field(None, max_length=200)
    education: list[EducationEntryRequest] | None = Field(None, max_length=20)
    work_experience: list[WorkExperienceRequest] | None = Field(None, max_length=20)
    skills: list[SkillEntryRequest] | None = Field(None, max_length=20)
    languages: list[LanguageEntryRequest] | None = Field(None, max_length=10)


class CandidateProfileDTO(BaseModel):
    """Full candidate profile response DTO."""

    id: UUID
    account_id: UUID
    full_name: str
    email: str | None
    phone: str | None
    city: str | None
    summary: str | None
    linkedin_url: str | None
    state: ProfileState
    education: list[EducationEntryDTO]
    work_experience: list[WorkExperienceDTO]
    skills: list[SkillEntryDTO]
    languages: list[LanguageEntryDTO]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Senior Profile ─────────────────────────────────────────────────────────────


class SeniorProfileUpdateRequest(BaseModel):
    """Request body for PUT /me/senior-profile."""

    full_name: str | None = Field(None, min_length=1, max_length=100)
    company_affiliation: str | None = Field(None, max_length=200)
    job_title: str | None = Field(None, max_length=100)
    contact_channel_pref: ContactChannelPref | None = None
    contact_scope_pref: ContactScopePref | None = None
    # Skill terms to resolve; 1-10 allowed when channel != 'None'.
    expertise_skills: list[str] | None = Field(None, max_length=10)


class SeniorProfileDTO(BaseModel):
    """Full senior profile response DTO."""

    id: UUID
    account_id: UUID
    full_name: str
    company_affiliation: str | None
    job_title: str | None
    contact_channel_pref: ContactChannelPref
    contact_scope_pref: ContactScopePref | None
    # Resolved canonical skill names for display.
    expertise_skills: list[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Restricted / Cross-module DTOs ────────────────────────────────────────────


class ApplicantCardDTO(BaseModel):
    """RESTRICTED: only these 3 fields may ever be shown to a Senior about a Candidate.

    This DTO is the public face of a Candidate as seen from the Senior's
    job-applicant list. Adding any field here requires an explicit RBAC review.
    """

    full_name: str
    applied_role_title: str
    application_status: str

    model_config = {"from_attributes": True}


class SeniorContactDTO(BaseModel):
    """Summary of a contactable Senior, returned for JD contactability lookups."""

    account_id: UUID
    full_name: str
    contact_channel_pref: str

    model_config = {"from_attributes": True}


class Completeness(BaseModel):
    """Cross-module DTO — completeness state of a candidate profile.

    Consumed by the applications module (R7 AC1) and the cvs module to gate
    application submission.
    """

    state: str  # ProfileState value string
    missing_fields: list[str]

    model_config = {"from_attributes": True}


class JdContactabilityInput(BaseModel):
    """Cross-module input for the contactable-seniors query (R4A).

    Passed by the jobs/applications module into ProfilesApi.contactable_seniors_for_jd.
    """

    jd_creator_id: UUID
    jd_company: str
    jd_skill_ids: list[UUID]
