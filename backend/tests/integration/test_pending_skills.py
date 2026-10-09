"""A skill not in the Skill_Taxonomy stays on the profile as pending (R4 AC2, AC3, AC6).

R4 AC3: an entered skill not in the taxonomy is stored linked to a normalized
term and flagged for Admin review. The service flagged it but then dropped it
from the profile, so the Candidate silently lost what they typed (Bug 10, which
was mitigated by seeding a starter taxonomy, option (a)). Decision (option b):
keep it on the profile as pending. Only a confirmed skill (an exact taxonomy or
alias match) counts toward completeness (AC6) until an Admin maps the term.

A fuzzy match is not a confirmation either: "kubernets" used to be saved as
Kubernetes without anyone deciding so.

Runs against ``alembic upgrade head`` with the real resolver and repository.
"""

from __future__ import annotations

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
from app.platform.taxonomy.repository import SkillRepository
from app.platform.taxonomy.resolver import SkillResolver

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

pytestmark = pytest.mark.integration


async def _candidate(sessionmaker: async_sessionmaker[AsyncSession]) -> tuple[uuid.UUID, str]:
    email = f"pending-{uuid.uuid4().hex[:10]}@example.com"
    async with sessionmaker() as session, session.begin():
        account_id = (
            await session.execute(
                text(
                    "INSERT INTO accounts (email, roles, status, password_hash) "
                    "VALUES (:e, ARRAY['CANDIDATE']::role[], 'Approved', 'x') RETURNING id"
                ),
                {"e": email},
            )
        ).scalar_one()
    return account_id, email


def _request(email: str, *terms: str) -> CandidateProfileUpdateRequest:
    return CandidateProfileUpdateRequest(
        full_name="Pending Skills",
        email=email,
        phone="+972502345670",
        city="Haifa",
        education=[
            EducationEntryRequest(
                institution="Technion", degree="B.Sc.", enrolment_status="Enrolled", start_year=2020
            )
        ],
        skills=[SkillEntryRequest(term=term, years_experience=2) for term in terms],
    )


@pytest.fixture
def service(pg_sessionmaker: async_sessionmaker[AsyncSession]) -> CandidateProfileService:
    return CandidateProfileService(
        lambda: UnitOfWork(pg_sessionmaker),
        skill_resolver=SkillResolver(SkillRepository(pg_sessionmaker)),
    )


async def _pending_rows(sessionmaker: async_sessionmaker[AsyncSession], normalized: str) -> int:
    async with sessionmaker() as session:
        return int(
            await session.scalar(
                text(
                    "SELECT count(*) FROM unmatched_skill_terms "
                    "WHERE normalized_term = :n AND pending_review"
                ),
                {"n": normalized},
            )
            or 0
        )


async def test_an_unknown_skill_is_kept_as_pending_beside_a_confirmed_one(
    pg_sessionmaker: async_sessionmaker[AsyncSession], service: CandidateProfileService
) -> None:
    account_id, email = await _candidate(pg_sessionmaker)
    unknown = f"Quantum Basket Weaving {uuid.uuid4().hex[:6]}"

    saved = await service.update(account_id, _request(email, "Python", unknown))

    skills = {entry.name.casefold(): entry for entry in saved.skills}
    assert skills["python"].pending is False
    assert skills["python"].skill_id is not None
    assert skills[unknown.casefold()].pending is True
    assert skills[unknown.casefold()].skill_id is None
    assert skills[unknown.casefold()].name == unknown  # what the Candidate typed
    # The confirmed skill alone satisfies AC6.
    assert saved.state == "Complete"

    # Saving the same profile again keeps one review-queue entry for the term.
    await service.update(account_id, _request(email, "Python", unknown))
    assert await _pending_rows(pg_sessionmaker, unknown.casefold()) == 1


async def test_only_pending_skills_leave_the_profile_draft(
    pg_sessionmaker: async_sessionmaker[AsyncSession], service: CandidateProfileService
) -> None:
    account_id, email = await _candidate(pg_sessionmaker)

    saved = await service.update(
        account_id, _request(email, f"Unknown Craft {uuid.uuid4().hex[:6]}")
    )

    assert [entry.pending for entry in saved.skills] == [True]
    assert saved.state == "Draft"


async def test_a_fuzzy_match_is_pending_not_confirmed(
    pg_sessionmaker: async_sessionmaker[AsyncSession], service: CandidateProfileService
) -> None:
    account_id, email = await _candidate(pg_sessionmaker)

    saved = await service.update(account_id, _request(email, "kubernets"))

    assert [(entry.name, entry.pending, entry.skill_id) for entry in saved.skills] == [
        ("kubernets", True, None)
    ]
    assert saved.state == "Draft"
