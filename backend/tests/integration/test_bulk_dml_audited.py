"""Repository writes go through the ORM, so the audit hook records them (R8 AC1, AC6).

The audit trail is written by a ``before_flush`` hook that diffs the session's
new, dirty and deleted objects. Bulk ``update()`` / ``delete()`` statements never
enter those sets: SQLAlchemy runs them directly and synchronizes in-session
objects as already committed, so even assigning the same values afterwards
records nothing. Twelve repository statements were bulk DML:

* CVs: primary-variant designation, scan result, promotion and quarantine (R8
  AC1 names quarantine and active-version designation).
* Profiles: the five child collections replaced on every save. The new rows
  were audited and the removed ones not, so replaying an entity's diffs could
  not rebuild it (R8 AC6).
* Jobs: a JD's required skills, and the purge of expired extraction drafts.

Runs against ``alembic upgrade head`` through the real ``UnitOfWork``.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import hashlib
from typing import TYPE_CHECKING
import uuid

import pytest
from sqlalchemy import text

from app.modules.cvs import repository as cv_repo
from app.modules.cvs.models import CvVariant, CvVersion
from app.modules.jobs import repository as jobs_repo
from app.modules.jobs.models import JdExtractionDraft, JobDescription
from app.modules.profiles import repository as profile_repo
from app.platform.db.enums import CvVersionState, JdStatus
from app.platform.db.unit_of_work import UnitOfWork

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

pytestmark = pytest.mark.integration


async def _entries(
    sessionmaker: async_sessionmaker[AsyncSession], entity_id: object
) -> list[tuple[str, dict[str, object] | None, dict[str, object] | None]]:
    async with sessionmaker() as session:
        rows = (
            await session.execute(
                text(
                    "SELECT action, before, after FROM audit_log "
                    "WHERE entity_id = :id ORDER BY id"
                ),
                {"id": str(entity_id)},
            )
        ).all()
    return [(row.action, row.before, row.after) for row in rows]


async def _account(sessionmaker: async_sessionmaker[AsyncSession], role: str) -> uuid.UUID:
    async with sessionmaker() as session, session.begin():
        return (
            await session.execute(
                text(
                    "INSERT INTO accounts (email, roles, status, password_hash) "
                    "VALUES (:e, ARRAY[CAST(:r AS role)], 'Approved', 'x') RETURNING id"
                ),
                {"e": f"bulk-{uuid.uuid4().hex[:10]}@example.com", "r": role},
            )
        ).scalar_one()


async def _skill(sessionmaker: async_sessionmaker[AsyncSession]) -> uuid.UUID:
    async with sessionmaker() as session, session.begin():
        return (
            await session.execute(
                text(
                    "INSERT INTO skills (name, normalized_name) "
                    "VALUES (CAST(:n AS jsonb), :norm) RETURNING id"
                ),
                {"n": '{"en": "Bulk"}', "norm": f"bulk-{uuid.uuid4().hex[:10]}"},
            )
        ).scalar_one()


# ── CVs ───────────────────────────────────────────────────────────────────────


def _version(variant_id: uuid.UUID, number: int) -> CvVersion:
    return CvVersion(
        variant_id=variant_id,
        version_number=number,
        object_key=f"cv/{variant_id}/v{number}/cv.pdf",
        bucket="cvs-quarantine",
        object_version_id="quarantine-v",
        sha256_digest=hashlib.sha256(str(number).encode()).digest(),
        size_bytes=10,
        mime_type="application/pdf",
        original_filename="cv.pdf",
        state=CvVersionState.PENDING_SCAN,
    )


async def test_cv_designation_scan_promotion_and_quarantine_are_audited(
    pg_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    account_id = await _account(pg_sessionmaker, "CANDIDATE")
    async with UnitOfWork(pg_sessionmaker) as uow:
        first = CvVariant(account_id=account_id, name="First", is_primary=True)
        second = CvVariant(account_id=account_id, name="Second", is_primary=False)
        uow.session.add_all([first, second])
        await uow.session.flush()
        clean, infected = _version(first.id, 1), _version(first.id, 2)
        uow.session.add_all([clean, infected])

    async with UnitOfWork(pg_sessionmaker) as uow:
        await cv_repo.set_primary_variant(uow.session, account_id, second.id)
    async with UnitOfWork(pg_sessionmaker) as uow:
        version = await cv_repo.get_version(uow.session, clean.id)
        assert version is not None
        await cv_repo.update_version_scan(
            uow.session,
            version,
            state=CvVersionState.AVAILABLE,
            scan_result="OK",
            scanned_at=datetime.now(UTC),
        )
        await cv_repo.promote_version(
            uow.session,
            version,
            object_key=version.object_key,
            bucket="cvs",
            object_version_id="available-v",
        )
    async with UnitOfWork(pg_sessionmaker) as uow:
        version = await cv_repo.get_version(uow.session, infected.id)
        assert version is not None
        await cv_repo.quarantine_version(uow.session, version, scan_result="Eicar FOUND")

    # Active-version designation moves the flag, and both sides of it are recorded.
    assert ("CvVariant.updated", {"is_primary": True}, {"is_primary": False}) in [
        (a, {k: v for k, v in (b or {}).items() if k == "is_primary"},
         {k: v for k, v in (af or {}).items() if k == "is_primary"})
        for a, b, af in await _entries(pg_sessionmaker, first.id)
    ]
    assert any(
        action == "CvVariant.updated" and (after or {}).get("is_primary") is True
        for action, _, after in await _entries(pg_sessionmaker, second.id)
    )
    clean_after = [after for action, _, after in await _entries(pg_sessionmaker, clean.id)
                   if action == "CvVersion.updated"]
    merged = {k: v for after in clean_after for k, v in (after or {}).items()}
    assert merged.get("state") == "Available"
    assert merged.get("bucket") == "cvs"
    assert merged.get("object_version_id") == "available-v"
    assert any(
        action == "CvVersion.updated" and (after or {}).get("state") == "Quarantined"
        for action, _, after in await _entries(pg_sessionmaker, infected.id)
    )


# ── Profiles ──────────────────────────────────────────────────────────────────


async def test_replacing_a_profile_collection_audits_the_removed_rows(
    pg_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    account_id = await _account(pg_sessionmaker, "CANDIDATE")
    first_skill, second_skill = await _skill(pg_sessionmaker), await _skill(pg_sessionmaker)
    async with UnitOfWork(pg_sessionmaker) as uow:
        profile = await profile_repo.create_candidate_profile(
            uow.session, account_id, full_name="Bulk Candidate"
        )
        await uow.session.flush()
        old_rows = await profile_repo.replace_skills(
            uow.session, profile.id, account_id, [(first_skill, 2)]
        )
    old_id = old_rows[0].id

    async with UnitOfWork(pg_sessionmaker) as uow:
        await profile_repo.replace_skills(uow.session, profile.id, account_id, [(second_skill, 3)])

    assert [action for action, _, _ in await _entries(pg_sessionmaker, old_id)] == [
        "CandidateSkill.created",
        "CandidateSkill.deleted",
    ]


async def test_replacing_a_senior_expertise_audits_the_removed_rows(
    pg_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    account_id = await _account(pg_sessionmaker, "SENIOR")
    first_skill, second_skill = await _skill(pg_sessionmaker), await _skill(pg_sessionmaker)
    async with UnitOfWork(pg_sessionmaker) as uow:
        await profile_repo.create_senior_profile(uow.session, account_id, full_name="Bulk Senior")
        old_rows = await profile_repo.replace_senior_expertise_skills(
            uow.session, account_id, [first_skill]
        )
    old_id = old_rows[0].id

    async with UnitOfWork(pg_sessionmaker) as uow:
        await profile_repo.replace_senior_expertise_skills(uow.session, account_id, [second_skill])

    assert [action for action, _, _ in await _entries(pg_sessionmaker, old_id)] == [
        "SeniorExpertiseSkill.created",
        "SeniorExpertiseSkill.deleted",
    ]


# ── Jobs ──────────────────────────────────────────────────────────────────────


async def test_replacing_jd_skills_and_purging_drafts_are_audited(
    pg_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    creator = await _account(pg_sessionmaker, "SENIOR")
    first_skill, second_skill = await _skill(pg_sessionmaker), await _skill(pg_sessionmaker)
    async with UnitOfWork(pg_sessionmaker) as uow:
        jd = JobDescription(
            creator_account_id=creator,
            title="Bulk",
            company="Bulk Co",
            company_norm="bulk co",
            status=JdStatus.DRAFT,
        )
        uow.session.add(jd)
        await uow.session.flush()
        await jobs_repo.set_jd_required_skills(uow.session, jd.id, [first_skill])
    async with UnitOfWork(pg_sessionmaker) as uow:
        old_id = (
            await uow.session.execute(
                text("SELECT id FROM jd_required_skills WHERE jd_id = :j"), {"j": jd.id}
            )
        ).scalar_one()
        await jobs_repo.set_jd_required_skills(uow.session, jd.id, [second_skill])

    assert [action for action, _, _ in await _entries(pg_sessionmaker, old_id)] == [
        "JdRequiredSkill.created",
        "JdRequiredSkill.deleted",
    ]

    async with UnitOfWork(pg_sessionmaker) as uow:
        draft = JdExtractionDraft(
            creator_account_id=creator,
            source="text",
            extracted_fields={},
            skill_candidates=[],
            expires_at=datetime.now(UTC) - timedelta(hours=1),
        )
        uow.session.add(draft)
    async with UnitOfWork(pg_sessionmaker) as uow:
        purged = await jobs_repo.delete_stale_drafts(uow.session, before=datetime.now(UTC))
    assert purged >= 1
    assert [action for action, _, _ in await _entries(pg_sessionmaker, draft.id)] == [
        "JdExtractionDraft.created",
        "JdExtractionDraft.deleted",
    ]
