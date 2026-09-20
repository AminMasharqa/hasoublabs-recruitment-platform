"""ORM models for the profiles module (R4, R4A, Task 15.1).

Tables:
- candidate_profiles: 1:1 with accounts (Candidate role)
- candidate_education: 0-20 education entries per profile
- candidate_work_experience: 0-20 experience entries per profile
- candidate_skills: 1-20 skills per profile
- candidate_languages: up to 10 languages per profile
- senior_profiles: 1:1 with accounts (Senior role)
- senior_expertise_skills: 1-10 field-of-expertise skills per senior
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.platform.db.base import Base, TimestampMixin, UuidPkMixin, UtcTimestampMs, utc_now
from app.platform.db.enums import (
    ContactChannelPref,
    ContactScopePref,
    EnrolmentStatus,
    ProfileState,
    contact_channel_pref_type,
    contact_scope_pref_type,
    enrolment_status_type,
    profile_state_type,
)


class CandidateProfile(Base, UuidPkMixin, TimestampMixin):
    """Candidate profile — 1:1 with an account holding the Candidate role.

    ``state`` is recomputed by CompletenessEvaluator after every PUT and stored
    here so list queries can filter without loading all relations (R4 AC6).
    """

    __tablename__ = "candidate_profiles"

    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    full_name: Mapped[str] = mapped_column(String(100), nullable=False)

    # Contact email — may differ from the login email stored on the account row.
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # E.164 format; validated in the service layer before persistence.
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # Locality from reference data.
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)

    summary: Mapped[str | None] = mapped_column(Text, nullable=True)

    linkedin_url: Mapped[str | None] = mapped_column(String(200), nullable=True)

    state: Mapped[ProfileState] = mapped_column(
        profile_state_type,
        nullable=False,
        default=ProfileState.DRAFT,
        server_default=ProfileState.DRAFT.value,
    )

    # ── Relationships ──────────────────────────────────────────────────────
    education: Mapped[list[CandidateEducation]] = relationship(
        "CandidateEducation",
        back_populates="profile",
        lazy="select",
        cascade="all, delete-orphan",
    )
    work_experience: Mapped[list[CandidateWorkExperience]] = relationship(
        "CandidateWorkExperience",
        back_populates="profile",
        lazy="select",
        cascade="all, delete-orphan",
    )
    skills: Mapped[list[CandidateSkill]] = relationship(
        "CandidateSkill",
        back_populates="profile",
        lazy="select",
        cascade="all, delete-orphan",
    )
    languages: Mapped[list[CandidateLanguage]] = relationship(
        "CandidateLanguage",
        back_populates="profile",
        lazy="select",
        cascade="all, delete-orphan",
    )

    # ── Table-level constraints ────────────────────────────────────────────
    __table_args__ = (
        CheckConstraint(
            "summary IS NULL OR length(summary) <= 1000",
            name="ck_candidate_profiles_summary_len",
        ),
        CheckConstraint(
            "linkedin_url IS NULL OR length(linkedin_url) <= 200",
            name="ck_candidate_profiles_linkedin_url_len",
        ),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<CandidateProfile account_id={self.account_id} state={self.state}>"


class CandidateEducation(Base, UuidPkMixin):
    """One education entry for a candidate profile (0-20 entries per profile)."""

    __tablename__ = "candidate_education"

    # Denormalized for efficient scoping queries without joining through profile.
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    profile_id: Mapped[UUID] = mapped_column(
        ForeignKey("candidate_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    institution: Mapped[str] = mapped_column(String(200), nullable=False)
    degree: Mapped[str] = mapped_column(String(100), nullable=False)
    field_of_study: Mapped[str | None] = mapped_column(String(100), nullable=True)

    enrolment_status: Mapped[EnrolmentStatus] = mapped_column(
        enrolment_status_type,
        nullable=False,
    )

    start_year: Mapped[int] = mapped_column(Integer, nullable=False)

    # NULL means still enrolled.
    end_year: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        UtcTimestampMs, nullable=False, default=utc_now
    )

    # ── Relationship ───────────────────────────────────────────────────────
    profile: Mapped[CandidateProfile] = relationship(
        "CandidateProfile",
        back_populates="education",
        lazy="raise",
    )

    # ── Table-level constraints ────────────────────────────────────────────
    __table_args__ = (
        CheckConstraint(
            "end_year IS NULL OR end_year >= start_year",
            name="ck_candidate_education_year_order",
        ),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<CandidateEducation profile_id={self.profile_id} institution={self.institution}>"


class CandidateWorkExperience(Base, UuidPkMixin):
    """One work experience entry for a candidate profile (0-20 per profile)."""

    __tablename__ = "candidate_work_experience"

    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    profile_id: Mapped[UUID] = mapped_column(
        ForeignKey("candidate_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    company: Mapped[str] = mapped_column(String(200), nullable=False)
    title: Mapped[str] = mapped_column(String(100), nullable=False)

    start_date: Mapped[date] = mapped_column(Date, nullable=False)

    # NULL means current position.
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        UtcTimestampMs, nullable=False, default=utc_now
    )

    # ── Relationship ───────────────────────────────────────────────────────
    profile: Mapped[CandidateProfile] = relationship(
        "CandidateProfile",
        back_populates="work_experience",
        lazy="raise",
    )

    # ── Table-level constraints ────────────────────────────────────────────
    __table_args__ = (
        CheckConstraint(
            "end_date IS NULL OR end_date >= start_date",
            name="ck_candidate_work_experience_date_order",
        ),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<CandidateWorkExperience profile_id={self.profile_id} title={self.title}>"


class CandidateSkill(Base, UuidPkMixin):
    """One resolved skill on a candidate profile (1-20 per profile)."""

    __tablename__ = "candidate_skills"

    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    profile_id: Mapped[UUID] = mapped_column(
        ForeignKey("candidate_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # FK into the taxonomy skills table.
    skill_id: Mapped[UUID] = mapped_column(
        ForeignKey("skills.id", ondelete="RESTRICT"),
        nullable=False,
    )

    # 0-50 years, nullable (candidate may not know exact duration).
    years_experience: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        UtcTimestampMs, nullable=False, default=utc_now
    )

    # ── Relationship ───────────────────────────────────────────────────────
    profile: Mapped[CandidateProfile] = relationship(
        "CandidateProfile",
        back_populates="skills",
        lazy="raise",
    )

    # ── Table-level constraints ────────────────────────────────────────────
    __table_args__ = (
        CheckConstraint(
            "years_experience IS NULL OR (years_experience >= 0 AND years_experience <= 50)",
            name="ck_candidate_skills_years_experience_range",
        ),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<CandidateSkill profile_id={self.profile_id} skill_id={self.skill_id}>"


class CandidateLanguage(Base, UuidPkMixin):
    """One language proficiency entry per candidate profile (up to 10)."""

    __tablename__ = "candidate_languages"

    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    profile_id: Mapped[UUID] = mapped_column(
        ForeignKey("candidate_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # BCP 47 language tag, e.g. 'ar', 'he', 'en'.
    language_code: Mapped[str] = mapped_column(String(10), nullable=False)

    # One of: Native, Fluent, Professional, Conversational, Basic.
    proficiency: Mapped[str] = mapped_column(String(20), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        UtcTimestampMs, nullable=False, default=utc_now
    )

    # ── Relationship ───────────────────────────────────────────────────────
    profile: Mapped[CandidateProfile] = relationship(
        "CandidateProfile",
        back_populates="languages",
        lazy="raise",
    )

    # ── Table-level constraints ────────────────────────────────────────────
    __table_args__ = (
        UniqueConstraint("profile_id", "language_code", name="uq_candidate_languages_profile_id_language_code"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<CandidateLanguage profile_id={self.profile_id} language={self.language_code}>"


class SeniorProfile(Base, UuidPkMixin, TimestampMixin):
    """Senior profile — 1:1 with an account holding the Senior role (R4A)."""

    __tablename__ = "senior_profiles"

    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    full_name: Mapped[str] = mapped_column(String(100), nullable=False)

    company_affiliation: Mapped[str | None] = mapped_column(String(200), nullable=True)

    job_title: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # How, if at all, the Senior may be contacted about jobs.
    contact_channel_pref: Mapped[ContactChannelPref] = mapped_column(
        contact_channel_pref_type,
        nullable=False,
        default=ContactChannelPref.NONE,
        server_default=ContactChannelPref.NONE.value,
    )

    # Which JDs the Senior is contactable for; required unless channel is 'None'.
    contact_scope_pref: Mapped[ContactScopePref | None] = mapped_column(
        contact_scope_pref_type,
        nullable=True,
    )

    # ── Relationships ──────────────────────────────────────────────────────
    expertise_skills: Mapped[list[SeniorExpertiseSkill]] = relationship(
        "SeniorExpertiseSkill",
        back_populates="senior_profile",
        lazy="select",
        cascade="all, delete-orphan",
        foreign_keys="SeniorExpertiseSkill.account_id",
        primaryjoin="SeniorProfile.account_id == SeniorExpertiseSkill.account_id",
    )

    # ── Table-level constraints ────────────────────────────────────────────
    __table_args__ = (
        CheckConstraint(
            "contact_channel_pref = 'None' OR contact_scope_pref IS NOT NULL",
            name="ck_senior_profiles_scope_required_when_contactable",
        ),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<SeniorProfile account_id={self.account_id} full_name={self.full_name}>"


class SeniorExpertiseSkill(Base, UuidPkMixin):
    """Field-of-expertise skill for a Senior (1-10 per senior account)."""

    __tablename__ = "senior_expertise_skills"

    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    skill_id: Mapped[UUID] = mapped_column(
        ForeignKey("skills.id", ondelete="RESTRICT"),
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        UtcTimestampMs, nullable=False, default=utc_now
    )

    # ── Relationship ───────────────────────────────────────────────────────
    senior_profile: Mapped[SeniorProfile] = relationship(
        "SeniorProfile",
        back_populates="expertise_skills",
        lazy="raise",
        foreign_keys=[account_id],
        primaryjoin="SeniorExpertiseSkill.account_id == SeniorProfile.account_id",
    )

    # ── Table-level constraints ────────────────────────────────────────────
    __table_args__ = (
        UniqueConstraint("account_id", "skill_id", name="uq_senior_expertise_skills_account_id_skill_id"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<SeniorExpertiseSkill account_id={self.account_id} skill_id={self.skill_id}>"
