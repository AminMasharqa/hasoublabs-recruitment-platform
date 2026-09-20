"""ORM models for the jobs module (R6, Section 17).

Tables:
- job_descriptions: core JD row
- jd_required_skills: M2M association (JD ↔ skills)
- jd_extraction_drafts: transient extraction results (never a Job_Description)
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.platform.db.base import Base, TimestampMixin, UuidPkMixin, UtcTimestampMs, utc_now
from app.platform.db.enums import (
    ApplicationChannel,
    EmploymentType,
    ExperienceLevel,
    JdStatus,
    WorkModel,
    application_channel_type,
    employment_type_type,
    experience_level_type,
    jd_status_type,
    work_model_type,
)


class JobDescription(UuidPkMixin, TimestampMixin, Base):
    """A job description posted by a Senior or Admin (R6)."""

    __tablename__ = "job_descriptions"

    # ── Ownership ─────────────────────────────────────────────────────────────
    creator_account_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # ── Core fields ───────────────────────────────────────────────────────────
    title: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    company: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    company_norm: Mapped[str] = mapped_column(
        sa.String(200),
        nullable=False,
        comment="lower(strip(company)) — set by service, used for contactability lookup",
    )
    location: Mapped[str | None] = mapped_column(sa.String(200), nullable=True)
    work_model: Mapped[WorkModel | None] = mapped_column(work_model_type, nullable=True)
    employment_type: Mapped[EmploymentType | None] = mapped_column(employment_type_type, nullable=True)
    experience_level: Mapped[ExperienceLevel | None] = mapped_column(experience_level_type, nullable=True)

    description: Mapped[str | None] = mapped_column(
        sa.Text,
        nullable=True,
        # The migration adds CHECK (char_length(description) <= 10000).
        # We document it here but do not duplicate as an ORM constraint so the
        # table stays in sync with the migration-only DDL.
    )

    external_url: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)

    # ── Lifecycle ─────────────────────────────────────────────────────────────
    status: Mapped[JdStatus] = mapped_column(
        jd_status_type,
        nullable=False,
        default=JdStatus.DRAFT,
        server_default=sa.text("'Draft'"),
    )
    application_channel: Mapped[ApplicationChannel | None] = mapped_column(
        application_channel_type, nullable=True
    )
    published_at: Mapped[datetime | None] = mapped_column(UtcTimestampMs, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(UtcTimestampMs, nullable=True)

    # ── Full-text search vector ────────────────────────────────────────────────
    # Not mapped with Mapped[] so SQLAlchemy never tries to write it directly.
    # The migration creates this as a generated column (or trigger-populated
    # tsvector) from title || ' ' || company || ' ' || coalesce(description,'').
    search_tsv = sa.Column(
        "search_tsv",
        sa.Text,
        nullable=True,
        comment="tsvector populated by migration trigger; do not set in ORM",
    )

    # ── Relationships ─────────────────────────────────────────────────────────
    required_skills: Mapped[list[JdRequiredSkill]] = relationship(
        "JdRequiredSkill",
        back_populates="job_description",
        cascade="all, delete-orphan",
        lazy="select",
    )

    __table_args__ = (
        # Keyset browse index: (status, published_at DESC, id DESC)
        sa.Index(
            "idx_job_descriptions_status_published_at_id",
            "status",
            sa.text("published_at DESC"),
            sa.text("id DESC"),
        ),
        # Lookup by creator (Senior's own JDs)
        sa.Index(
            "idx_job_descriptions_creator_account_id",
            "creator_account_id",
        ),
        # Description length guard enforced in migration DDL:
        # CHECK (description IS NULL OR char_length(description) <= 10000)
        sa.CheckConstraint(
            "description IS NULL OR char_length(description) <= 10000",
            name="ck_job_descriptions_description_max_length",
        ),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<JobDescription id={self.id!s} title={self.title!r} status={self.status}>"
        )


class JdRequiredSkill(UuidPkMixin, Base):
    """M2M association between a JobDescription and a canonical Skill (R6 AC1e)."""

    __tablename__ = "jd_required_skills"

    jd_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("job_descriptions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    skill_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("skills.id", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        UtcTimestampMs,
        nullable=False,
        default=utc_now,
        server_default=sa.func.now(),
    )

    # ── Relationships ─────────────────────────────────────────────────────────
    job_description: Mapped[JobDescription] = relationship(
        "JobDescription",
        back_populates="required_skills",
    )

    __table_args__ = (
        sa.UniqueConstraint("jd_id", "skill_id", name="uq_jd_required_skills_jd_id_skill_id"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<JdRequiredSkill jd_id={self.jd_id!s} skill_id={self.skill_id!s}>"


class JdExtractionDraft(UuidPkMixin, Base):
    """Transient extraction result with a 24-hour TTL (R6 AC1a–1h).

    Created immediately when an extraction job is enqueued and polled by the
    client until the worker populates extracted_fields and skill_candidates.
    Deleted once the Candidate confirms the draft into a real JobDescription.
    """

    __tablename__ = "jd_extraction_drafts"

    creator_account_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(as_uuid=True),
        nullable=False,
        index=True,
    )
    source: Mapped[str] = mapped_column(
        sa.String(10),
        nullable=False,
        comment="'url' or 'text'",
    )
    source_url: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)
    raw_content: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    # Partially extracted fields as a free-form dict; populated by the worker.
    extracted_fields: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=True,
        default=dict,
    )
    # List of {term: str, skill_id: str|null, confidence: float} dicts.
    skill_candidates: Mapped[list[Any]] = mapped_column(
        JSONB,
        nullable=True,
        default=list,
    )

    created_at: Mapped[datetime] = mapped_column(
        UtcTimestampMs,
        nullable=False,
        default=utc_now,
        server_default=sa.func.now(),
    )
    expires_at: Mapped[datetime] = mapped_column(UtcTimestampMs, nullable=False)

    __table_args__ = (
        sa.Index("idx_jd_extraction_drafts_expires_at", "expires_at"),
        sa.Index("idx_jd_extraction_drafts_creator_account_id", "creator_account_id"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<JdExtractionDraft id={self.id!s} source={self.source!r} "
            f"expires_at={self.expires_at!s}>"
        )


__all__ = ["JdExtractionDraft", "JdRequiredSkill", "JobDescription"]
