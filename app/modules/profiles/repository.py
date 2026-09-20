"""Profiles repository — all DB access for the profiles module (module-private).

All functions accept an ``AsyncSession`` and return plain ORM objects or lists
thereof. They never commit or rollback; that is the UnitOfWork's responsibility.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete, exists, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.modules.profiles.models import (
    CandidateEducation,
    CandidateLanguage,
    CandidateProfile,
    CandidateSkill,
    CandidateWorkExperience,
    SeniorExpertiseSkill,
    SeniorProfile,
)
from app.platform.db.base import utc_now

__all__ = [
    "contactable_seniors_for_jd",
    "count_candidate_education",
    "count_candidate_skills",
    "count_candidate_work_experience",
    "create_candidate_profile",
    "create_senior_profile",
    "get_candidate_profile",
    "get_candidate_profile_with_relations",
    "get_senior_profile",
    "replace_education",
    "replace_languages",
    "replace_senior_expertise_skills",
    "replace_skills",
    "replace_work_experience",
    "update_candidate_profile",
    "update_senior_profile",
]


# ── Candidate Profile ─────────────────────────────────────────────────────────


async def get_candidate_profile(
    session: AsyncSession, account_id: UUID
) -> CandidateProfile | None:
    """Fetch the candidate profile row (no relations loaded).

    Args:
        session: The active async session.
        account_id: The account UUID to look up.

    Returns:
        The profile row, or ``None`` if no profile exists for this account.
    """
    result = await session.execute(
        select(CandidateProfile).where(CandidateProfile.account_id == account_id)
    )
    return result.scalar_one_or_none()


async def get_candidate_profile_with_relations(
    session: AsyncSession, account_id: UUID
) -> CandidateProfile | None:
    """Fetch the candidate profile with all child relations eagerly loaded.

    Loads education, work_experience, skills (joined with skill names via JOIN
    on the skills table), and languages in a single round-trip using
    ``selectinload``.

    Args:
        session: The active async session.
        account_id: The account UUID to look up.

    Returns:
        The fully hydrated profile, or ``None`` if no profile exists.
    """
    result = await session.execute(
        select(CandidateProfile)
        .where(CandidateProfile.account_id == account_id)
        .options(
            selectinload(CandidateProfile.education),
            selectinload(CandidateProfile.work_experience),
            selectinload(CandidateProfile.skills),
            selectinload(CandidateProfile.languages),
        )
    )
    return result.scalar_one_or_none()


async def create_candidate_profile(
    session: AsyncSession,
    account_id: UUID,
    *,
    full_name: str,
) -> CandidateProfile:
    """Insert a new candidate profile row with sensible defaults.

    Args:
        session: The active async session.
        account_id: The owning account's UUID.
        full_name: The initial full name (from the account's registration data).

    Returns:
        The newly created (unflushed) profile ORM object.
    """
    profile = CandidateProfile(
        account_id=account_id,
        full_name=full_name,
    )
    session.add(profile)
    return profile


async def update_candidate_profile(
    session: AsyncSession,
    profile: CandidateProfile,
    **updates: object,
) -> None:
    """Apply scalar column updates to an existing profile.

    The caller is responsible for re-evaluating completeness after calling this.
    No flush is performed here.

    Args:
        session: The active async session (unused directly but kept for symmetry
            and to make injection-based testing straightforward).
        profile: The ORM object to mutate.
        **updates: Column-name / value pairs.
    """
    _ = session  # kept for API symmetry
    for key, value in updates.items():
        setattr(profile, key, value)
    profile.updated_at = utc_now()


# ── Education ─────────────────────────────────────────────────────────────────


async def replace_education(
    session: AsyncSession,
    profile_id: UUID,
    account_id: UUID,
    entries: list[dict],  # type: ignore[type-arg]
) -> list[CandidateEducation]:
    """Replace all education entries atomically: delete then insert.

    Args:
        session: The active async session.
        profile_id: The owning profile UUID.
        account_id: Denormalized account UUID stored on each row.
        entries: List of dicts with keys matching ``CandidateEducation`` columns
            (institution, degree, field_of_study, enrolment_status, start_year, end_year).

    Returns:
        The list of newly created ``CandidateEducation`` ORM objects.
    """
    await session.execute(
        delete(CandidateEducation).where(CandidateEducation.profile_id == profile_id)
    )
    rows = [
        CandidateEducation(profile_id=profile_id, account_id=account_id, **entry)
        for entry in entries
    ]
    session.add_all(rows)
    return rows


# ── Work Experience ───────────────────────────────────────────────────────────


async def replace_work_experience(
    session: AsyncSession,
    profile_id: UUID,
    account_id: UUID,
    entries: list[dict],  # type: ignore[type-arg]
) -> list[CandidateWorkExperience]:
    """Replace all work-experience entries atomically: delete then insert.

    Args:
        session: The active async session.
        profile_id: The owning profile UUID.
        account_id: Denormalized account UUID stored on each row.
        entries: List of dicts with keys matching ``CandidateWorkExperience`` columns
            (company, title, start_date, end_date, description).

    Returns:
        The list of newly created ``CandidateWorkExperience`` ORM objects.
    """
    await session.execute(
        delete(CandidateWorkExperience).where(
            CandidateWorkExperience.profile_id == profile_id
        )
    )
    rows = [
        CandidateWorkExperience(profile_id=profile_id, account_id=account_id, **entry)
        for entry in entries
    ]
    session.add_all(rows)
    return rows


# ── Skills ────────────────────────────────────────────────────────────────────


async def replace_skills(
    session: AsyncSession,
    profile_id: UUID,
    account_id: UUID,
    skill_ids_years: list[tuple[UUID, int | None]],
) -> list[CandidateSkill]:
    """Replace all skill entries atomically: delete then insert.

    Args:
        session: The active async session.
        profile_id: The owning profile UUID.
        account_id: Denormalized account UUID stored on each row.
        skill_ids_years: List of ``(skill_id, years_experience)`` tuples.

    Returns:
        The list of newly created ``CandidateSkill`` ORM objects.
    """
    await session.execute(
        delete(CandidateSkill).where(CandidateSkill.profile_id == profile_id)
    )
    rows = [
        CandidateSkill(
            profile_id=profile_id,
            account_id=account_id,
            skill_id=skill_id,
            years_experience=years,
        )
        for skill_id, years in skill_ids_years
    ]
    session.add_all(rows)
    return rows


# ── Languages ─────────────────────────────────────────────────────────────────


async def replace_languages(
    session: AsyncSession,
    profile_id: UUID,
    account_id: UUID,
    entries: list[dict],  # type: ignore[type-arg]
) -> list[CandidateLanguage]:
    """Replace all language entries atomically: delete then insert.

    Args:
        session: The active async session.
        profile_id: The owning profile UUID.
        account_id: Account UUID stored on each row.
        entries: List of dicts with keys matching ``CandidateLanguage`` columns
            (language_code, proficiency).

    Returns:
        The list of newly created ``CandidateLanguage`` ORM objects.
    """
    await session.execute(
        delete(CandidateLanguage).where(CandidateLanguage.profile_id == profile_id)
    )
    rows = [
        CandidateLanguage(profile_id=profile_id, account_id=account_id, **entry)
        for entry in entries
    ]
    session.add_all(rows)
    return rows


# ── Count helpers ─────────────────────────────────────────────────────────────


async def count_candidate_skills(session: AsyncSession, profile_id: UUID) -> int:
    """Return the number of skill rows for the given profile."""
    result = await session.execute(
        select(func.count()).where(CandidateSkill.profile_id == profile_id)
    )
    return result.scalar_one()


async def count_candidate_education(session: AsyncSession, profile_id: UUID) -> int:
    """Return the number of education rows for the given profile."""
    result = await session.execute(
        select(func.count()).where(CandidateEducation.profile_id == profile_id)
    )
    return result.scalar_one()


async def count_candidate_work_experience(
    session: AsyncSession, profile_id: UUID
) -> int:
    """Return the number of work-experience rows for the given profile."""
    result = await session.execute(
        select(func.count()).where(CandidateWorkExperience.profile_id == profile_id)
    )
    return result.scalar_one()


# ── Senior Profile ────────────────────────────────────────────────────────────


async def get_senior_profile(
    session: AsyncSession, account_id: UUID
) -> SeniorProfile | None:
    """Fetch the senior profile row.

    Args:
        session: The active async session.
        account_id: The account UUID to look up.

    Returns:
        The profile row, or ``None`` if no senior profile exists.
    """
    result = await session.execute(
        select(SeniorProfile)
        .where(SeniorProfile.account_id == account_id)
        .options(selectinload(SeniorProfile.expertise_skills))
    )
    return result.scalar_one_or_none()


async def create_senior_profile(
    session: AsyncSession,
    account_id: UUID,
    *,
    full_name: str,
) -> SeniorProfile:
    """Insert a new senior profile row.

    Args:
        session: The active async session.
        account_id: The owning account's UUID.
        full_name: The initial full name.

    Returns:
        The newly created (unflushed) senior profile ORM object.
    """
    profile = SeniorProfile(
        account_id=account_id,
        full_name=full_name,
    )
    session.add(profile)
    return profile


async def update_senior_profile(
    session: AsyncSession,
    profile: SeniorProfile,
    **updates: object,
) -> None:
    """Apply scalar column updates to an existing senior profile.

    Args:
        session: The active async session (kept for API symmetry).
        profile: The ORM object to mutate.
        **updates: Column-name / value pairs.
    """
    _ = session  # kept for API symmetry
    for key, value in updates.items():
        setattr(profile, key, value)
    profile.updated_at = utc_now()


async def replace_senior_expertise_skills(
    session: AsyncSession,
    account_id: UUID,
    skill_ids: list[UUID],
) -> list[SeniorExpertiseSkill]:
    """Replace all expertise-skill rows for a senior atomically.

    Args:
        session: The active async session.
        account_id: The senior account UUID.
        skill_ids: Resolved skill UUIDs to store (1-10 per design).

    Returns:
        The list of newly created ``SeniorExpertiseSkill`` ORM objects.
    """
    await session.execute(
        delete(SeniorExpertiseSkill).where(SeniorExpertiseSkill.account_id == account_id)
    )
    rows = [
        SeniorExpertiseSkill(account_id=account_id, skill_id=skill_id)
        for skill_id in skill_ids
    ]
    session.add_all(rows)
    return rows


# ── Contactability query ──────────────────────────────────────────────────────


async def contactable_seniors_for_jd(
    session: AsyncSession,
    *,
    jd_creator_id: UUID,
    jd_company_norm: str,
    jd_skill_ids: list[UUID],
) -> list[tuple[SeniorProfile, str]]:
    """Return (senior_profile, account_email) pairs contactable for a given JD.

    Implements the contactability predicate from the design exactly:

    .. code-block:: sql

        WHERE a.status = 'Approved'
          AND s.contact_channel_pref <> 'None'
          AND (
            (s.contact_scope_pref = 'OwnPostingsOnly' AND s.account_id = :jd_creator_id)
            OR (s.contact_scope_pref = 'SameCompany'
                AND lower(s.company_affiliation) = lower(:jd_company))
            OR (s.contact_scope_pref = 'FieldOfExpertise'
                AND EXISTS (
                    SELECT 1 FROM senior_expertise_skills e
                    WHERE e.account_id = s.account_id
                      AND e.skill_id = ANY(:jd_skill_ids)))
          )

    Note: The ``accounts`` table belongs to the identity module. We must NOT
    import identity's ORM models. We use a raw parameterised SQL query instead.

    Args:
        session: The active async session.
        jd_creator_id: The account_id of the Senior who created the JD.
        jd_company_norm: The normalised company name from the JD.
        jd_skill_ids: List of canonical skill UUIDs associated with the JD.

    Returns:
        A list of ``(SeniorProfile, account_email)`` tuples; never cached.
    """
    # Build skill_ids as a PostgreSQL array parameter.
    skill_ids_str = ", ".join(f"'{sid}'" for sid in jd_skill_ids) if jd_skill_ids else ""

    # We use a raw text query to join with accounts without importing identity.
    # Parameterized via :name syntax to prevent injection.
    stmt = text(
        """
        SELECT s.id           AS senior_id,
               a.email        AS account_email
        FROM   senior_profiles s
        JOIN   accounts a ON a.id = s.account_id
        WHERE  a.status = 'Approved'
          AND  s.contact_channel_pref <> 'None'
          AND  (
                   (    s.contact_scope_pref = 'OwnPostingsOnly'
                    AND s.account_id = :jd_creator_id)
                OR (    s.contact_scope_pref = 'SameCompany'
                    AND lower(s.company_affiliation) = lower(:jd_company))
                OR (    s.contact_scope_pref = 'FieldOfExpertise'
                    AND EXISTS (
                            SELECT 1
                            FROM   senior_expertise_skills e
                            WHERE  e.account_id = s.account_id
                              AND  e.skill_id = ANY(:jd_skill_ids)
                        ))
               )
        """
    )

    from sqlalchemy.dialects.postgresql import array as pg_array  # noqa: PLC0415

    result = await session.execute(
        stmt,
        {
            "jd_creator_id": str(jd_creator_id),
            "jd_company": jd_company_norm,
            "jd_skill_ids": [str(sid) for sid in jd_skill_ids],
        },
    )
    rows = result.fetchall()

    if not rows:
        return []

    # Load SeniorProfile objects for the matching IDs.
    senior_ids = [row.senior_id for row in rows]
    email_by_senior_id = {row.senior_id: row.account_email for row in rows}

    profiles_result = await session.execute(
        select(SeniorProfile)
        .where(SeniorProfile.id.in_(senior_ids))
        .options(selectinload(SeniorProfile.expertise_skills))
    )
    profiles = profiles_result.scalars().all()

    return [(p, email_by_senior_id[p.id]) for p in profiles]
