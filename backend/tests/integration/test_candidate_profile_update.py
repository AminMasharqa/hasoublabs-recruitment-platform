"""Saving a complete candidate profile reports and persists ``Complete`` (R4 AC6).

``CandidateProfileService.update`` replaces the child collections (education,
skills, ...) with bulk DELETE/INSERT statements and then re-reads the profile to
evaluate completeness. The re-read ran in the same session, so SQLAlchemy handed
back the identity-mapped profile whose collections were already loaded — the
*pre-save* ones. Completeness was evaluated on stale, empty collections: the
save returned ``Draft`` with ``education: []`` and wrote ``state = Draft`` to the
database, even for a profile that met every AC6 condition.

Runs against ``alembic upgrade head`` through the real ``UnitOfWork``. One
canonical skill is seeded and a stub resolver maps the entered term to it, so the
test does not depend on the dev Skill_Taxonomy's contents.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING
import uuid

import pytest
from sqlalchemy import text

from app.modules.profiles.schemas import (
    CandidateProfileUpdateRequest,
    EducationEntryRequest,
    SkillEntryRequest,
)
from app.modules.profiles.service import CandidateProfileService
from app.platform.db.unit_of_work import UnitOfWork

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

pytestmark = pytest.mark.integration


@dataclass(frozen=True)
class _Resolution:
    skill_id: uuid.UUID
    is_resolved: bool = True
    unmatched_term_id: uuid.UUID | None = None


class _StubResolver:
    """Resolves every term to one pre-seeded canonical skill."""

    def __init__(self, skill_id: uuid.UUID) -> None:
        self._skill_id = skill_id

    async def resolve(self, term: str) -> _Resolution:  # noqa: ARG002 - fixed answer
        return _Resolution(skill_id=self._skill_id)


async def test_complete_profile_save_reports_and_persists_complete(
    pg_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    suffix = uuid.uuid4().hex[:10]
    async with pg_sessionmaker() as session, session.begin():
        account_id = (
            await session.execute(
                text(
                    "INSERT INTO accounts (email, roles, status, password_hash) "
                    "VALUES (:e, ARRAY['CANDIDATE']::role[], 'Approved', 'x') RETURNING id"
                ),
                {"e": f"profile-{suffix}@example.com"},
            )
        ).scalar_one()
        skill_id = (
            await session.execute(
                text(
                    "INSERT INTO skills (name, normalized_name) "
                    "VALUES (CAST(:name AS jsonb), :norm) RETURNING id"
                ),
                {"name": '{"en": "Python"}', "norm": f"python-{suffix}"},
            )
        ).scalar_one()

    service = CandidateProfileService(
        lambda: UnitOfWork(pg_sessionmaker),
        skill_resolver=_StubResolver(skill_id),  # type: ignore[arg-type]
    )
    saved = await service.update(
        account_id,
        CandidateProfileUpdateRequest(
            full_name="Complete Candidate",
            email=f"profile-{suffix}@example.com",
            phone="+972502345670",
            city="Haifa",
            education=[
                EducationEntryRequest(
                    institution="Technion",
                    degree="B.Sc.",
                    enrolment_status="Enrolled",
                    start_year=2020,
                )
            ],
            skills=[SkillEntryRequest(term="Python")],
        ),
    )

    # The response reflects what was just saved, not the pre-save collections.
    assert len(saved.education) == 1
    assert len(saved.skills) == 1
    assert saved.state == "Complete"

    # And the persisted state agrees, so the next read and every completeness
    # consumer (apply gate, reports) see Complete too.
    async with pg_sessionmaker() as session:
        stored = (
            await session.execute(
                text("SELECT state FROM candidate_profiles WHERE account_id = :a"),
                {"a": account_id},
            )
        ).scalar_one()
    assert stored == "Complete"
