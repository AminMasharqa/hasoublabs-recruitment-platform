"""Repository layer for the jobs module — all SQLAlchemy I/O lives here (R6).

All functions are module-private; service.py is the only consumer inside this
module. No other module may import from repository.py.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.jobs.models import JdExtractionDraft, JdRequiredSkill, JobDescription
from app.platform.db.enums import (
    ApplicationChannel,
    EmploymentType,
    ExperienceLevel,
    JdStatus,
    WorkModel,
)
from app.platform.db.base import utc_now


# ── JobDescription queries ─────────────────────────────────────────────────────


async def get_jd(
    session: AsyncSession,
    jd_id: uuid.UUID,
    *,
    creator_id: uuid.UUID | None = None,
) -> JobDescription | None:
    """Fetch a single JobDescription.

    If ``creator_id`` is given the query also filters by ``creator_account_id``,
    scoping results to that Senior's own JDs.
    """
    stmt = select(JobDescription).where(JobDescription.id == jd_id)
    if creator_id is not None:
        stmt = stmt.where(JobDescription.creator_account_id == creator_id)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def list_open_jds(
    session: AsyncSession,
    *,
    search: str | None,
    skills: list[uuid.UUID],
    location: str | None,
    work_model: WorkModel | None,
    employment_type: EmploymentType | None,
    experience_level: ExperienceLevel | None,
    after_published_at: datetime | None,
    after_id: uuid.UUID | None,
    limit: int,
) -> list[JobDescription]:
    """Return a page of Open JDs with optional filters.

    Ordered by ``(published_at DESC, id DESC)`` for stable keyset pagination.
    The ``limit + 1`` trick lets the caller detect ``has_next`` without a
    separate COUNT query.
    """
    stmt = select(JobDescription).where(JobDescription.status == JdStatus.OPEN)

    # ── Filters ───────────────────────────────────────────────────────────────
    if search:
        # Full-text search against the tsvector column populated by trigger.
        stmt = stmt.where(
            func.to_tsvector("simple", JobDescription.search_tsv).op("@@")(
                func.plainto_tsquery("simple", search)
            )
        )
    if skills:
        # JD must include ALL requested skills.
        for skill_id in skills:
            stmt = stmt.where(
                JobDescription.id.in_(
                    select(JdRequiredSkill.jd_id).where(
                        JdRequiredSkill.skill_id == skill_id
                    )
                )
            )
    if location is not None:
        stmt = stmt.where(
            func.lower(JobDescription.location).contains(location.lower())
        )
    if work_model is not None:
        stmt = stmt.where(JobDescription.work_model == work_model)
    if employment_type is not None:
        stmt = stmt.where(JobDescription.employment_type == employment_type)
    if experience_level is not None:
        stmt = stmt.where(JobDescription.experience_level == experience_level)

    # ── Keyset cursor ─────────────────────────────────────────────────────────
    if after_published_at is not None and after_id is not None:
        stmt = stmt.where(
            (JobDescription.published_at < after_published_at)
            | (
                (JobDescription.published_at == after_published_at)
                & (JobDescription.id < after_id)
            )
        )

    stmt = (
        stmt.order_by(JobDescription.published_at.desc(), JobDescription.id.desc())
        .limit(limit + 1)
    )

    result = await session.execute(stmt)
    return list(result.scalars().all())


async def list_jds_for_admin(
    session: AsyncSession,
    *,
    status: JdStatus | None,
    after_id: uuid.UUID | None,
    limit: int,
) -> list[JobDescription]:
    """Return all JDs for Admin, optionally filtered by status."""
    stmt = select(JobDescription)
    if status is not None:
        stmt = stmt.where(JobDescription.status == status)
    if after_id is not None:
        stmt = stmt.where(JobDescription.id < after_id)
    stmt = stmt.order_by(JobDescription.created_at.desc(), JobDescription.id.desc()).limit(
        limit + 1
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def list_jds_for_senior(
    session: AsyncSession,
    creator_id: uuid.UUID,
    *,
    after_id: uuid.UUID | None,
    limit: int,
) -> list[JobDescription]:
    """Return all JDs owned by the given Senior account."""
    stmt = select(JobDescription).where(
        JobDescription.creator_account_id == creator_id
    )
    if after_id is not None:
        stmt = stmt.where(JobDescription.id < after_id)
    stmt = stmt.order_by(JobDescription.created_at.desc(), JobDescription.id.desc()).limit(
        limit + 1
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def create_jd(
    session: AsyncSession,
    *,
    creator_account_id: uuid.UUID,
    title: str,
    company: str,
    location: str | None,
    work_model: WorkModel | None,
    employment_type: EmploymentType | None,
    experience_level: ExperienceLevel | None,
    description: str | None,
    external_url: str | None,
    application_channel: ApplicationChannel | None,
) -> JobDescription:
    """Insert a new JobDescription row in DRAFT status."""
    jd = JobDescription(
        creator_account_id=creator_account_id,
        title=title,
        company=company,
        company_norm=company.lower().strip(),
        location=location,
        work_model=work_model,
        employment_type=employment_type,
        experience_level=experience_level,
        description=description,
        external_url=external_url,
        status=JdStatus.DRAFT,
        application_channel=application_channel,
    )
    session.add(jd)
    await session.flush()  # populate id
    return jd


async def update_jd_fields(
    session: AsyncSession,
    jd: JobDescription,
    **updates: Any,
) -> None:
    """Apply arbitrary field updates to a JobDescription.

    Keys must match column attribute names. ``company`` triggers an automatic
    refresh of ``company_norm``.
    """
    if "company" in updates:
        updates.setdefault("company_norm", updates["company"].lower().strip())
    for attr, value in updates.items():
        setattr(jd, attr, value)
    await session.flush()


async def set_jd_status(
    session: AsyncSession,
    jd: JobDescription,
    status: JdStatus,
    *,
    published_at: datetime | None = None,
    closed_at: datetime | None = None,
) -> None:
    """Transition a JobDescription to a new status, updating timestamps."""
    jd.status = status
    if published_at is not None:
        jd.published_at = published_at
    if closed_at is not None:
        jd.closed_at = closed_at
    await session.flush()


async def set_jd_application_channel(
    session: AsyncSession,
    jd: JobDescription,
    channel: ApplicationChannel | None,
) -> None:
    """Set or clear the application channel on a JobDescription."""
    jd.application_channel = channel
    await session.flush()


# ── Required-skills queries ────────────────────────────────────────────────────


async def get_jd_skill_ids(
    session: AsyncSession,
    jd_id: uuid.UUID,
) -> list[uuid.UUID]:
    """Return the skill UUIDs required by a JobDescription."""
    stmt = select(JdRequiredSkill.skill_id).where(JdRequiredSkill.jd_id == jd_id)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def set_jd_required_skills(
    session: AsyncSession,
    jd_id: uuid.UUID,
    skill_ids: list[uuid.UUID],
) -> None:
    """Atomically replace all required skills for a JD.

    Deletes existing rows then inserts the new set within the same flush.
    """
    await session.execute(
        delete(JdRequiredSkill).where(JdRequiredSkill.jd_id == jd_id)
    )
    for skill_id in skill_ids:
        session.add(JdRequiredSkill(jd_id=jd_id, skill_id=skill_id))
    await session.flush()


# ── Extraction draft queries ───────────────────────────────────────────────────


async def create_extraction_draft(
    session: AsyncSession,
    *,
    creator_account_id: uuid.UUID,
    source: str,
    source_url: str | None,
    raw_content: str | None,
    extracted_fields: dict,
    skill_candidates: list,
    expires_at: datetime,
) -> JdExtractionDraft:
    """Create a stub extraction draft that the worker will populate."""
    draft = JdExtractionDraft(
        creator_account_id=creator_account_id,
        source=source,
        source_url=source_url,
        raw_content=raw_content,
        extracted_fields=extracted_fields,
        skill_candidates=skill_candidates,
        expires_at=expires_at,
    )
    session.add(draft)
    await session.flush()
    return draft


async def get_extraction_draft(
    session: AsyncSession,
    draft_id: uuid.UUID,
    *,
    creator_id: uuid.UUID | None = None,
) -> JdExtractionDraft | None:
    """Fetch an extraction draft by id.

    If ``creator_id`` is provided the query also filters by ``creator_account_id``.
    """
    stmt = select(JdExtractionDraft).where(JdExtractionDraft.id == draft_id)
    if creator_id is not None:
        stmt = stmt.where(JdExtractionDraft.creator_account_id == creator_id)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def update_extraction_draft(
    session: AsyncSession,
    draft: JdExtractionDraft,
    *,
    extracted_fields: dict | None = None,
    skill_candidates: list | None = None,
) -> None:
    """Partially update a draft's worker-populated fields."""
    if extracted_fields is not None:
        draft.extracted_fields = extracted_fields
    if skill_candidates is not None:
        draft.skill_candidates = skill_candidates
    await session.flush()


async def delete_extraction_draft(
    session: AsyncSession,
    draft: JdExtractionDraft,
) -> None:
    """Delete a single extraction draft (used after confirm)."""
    await session.delete(draft)
    await session.flush()


async def delete_stale_drafts(
    session: AsyncSession,
    *,
    before: datetime,
) -> int:
    """Delete all drafts whose TTL has passed.

    Returns the count of deleted rows.
    """
    result = await session.execute(
        delete(JdExtractionDraft)
        .where(JdExtractionDraft.expires_at < before)
        .returning(JdExtractionDraft.id)
    )
    return len(result.fetchall())


__all__ = [
    "create_extraction_draft",
    "create_jd",
    "delete_extraction_draft",
    "delete_stale_drafts",
    "get_extraction_draft",
    "get_jd",
    "get_jd_skill_ids",
    "list_jds_for_admin",
    "list_jds_for_senior",
    "list_open_jds",
    "set_jd_application_channel",
    "set_jd_required_skills",
    "set_jd_status",
    "update_extraction_draft",
    "update_jd_fields",
]
