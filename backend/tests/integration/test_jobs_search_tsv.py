"""A Job_Description inserted through the ORM is found by full-text search (Bug 7).

Runs against a database built by ``alembic upgrade head``, so the real
``trg_jd_search_tsv`` trigger populates ``search_tsv``. Before the fix the INSERT
itself failed with ``column "search_tsv" is of type tsvector but expression is of
type character varying``, and the browse predicate called ``to_tsvector`` on a
value that was already a tsvector.

Everything happens in one transaction that is rolled back, so the shared
container is left as it was found.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from sqlalchemy import text

from app.modules.jobs import repository as repo
from app.modules.jobs.models import JobDescription
from app.platform.db.base import utc_now
from app.platform.db.enums import JdStatus

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

pytestmark = pytest.mark.integration


async def _browse(session: AsyncSession, search: str) -> list[JobDescription]:
    return await repo.list_open_jds(
        session,
        search=search,
        skills=[],
        location=None,
        work_model=None,
        employment_type=None,
        experience_level=None,
        after_published_at=None,
        after_id=None,
        limit=20,
    )


async def test_orm_insert_populates_search_vector_and_search_finds_it(
    pg_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    async with pg_sessionmaker() as session:
        creator_id = (
            await session.execute(
                text(
                    "INSERT INTO accounts (email, roles, password_hash) "
                    "VALUES ('bug7-senior@example.test', ARRAY['SENIOR']::role[], 'x') "
                    "RETURNING id"
                )
            )
        ).scalar_one()

        jd = JobDescription(
            creator_account_id=creator_id,
            title="Backend Engineer",
            company="Hasoub Labs",
            company_norm="hasoub labs",
            description="Python and PostgreSQL services",
            status=JdStatus.OPEN,
            published_at=utc_now(),
        )
        session.add(jd)
        await session.flush()  # raised DatatypeMismatchError before the fix

        stored = (
            await session.execute(
                text("SELECT search_tsv IS NOT NULL FROM job_descriptions WHERE id = :id"),
                {"id": jd.id},
            )
        ).scalar_one()
        assert stored is True

        assert [found.id for found in await _browse(session, "postgresql")] == [jd.id]
        assert await _browse(session, "kubernetes") == []

        # An UPDATE must not overwrite the trigger-owned column either.
        jd.description = "Kubernetes operators"
        await session.flush()
        assert [found.id for found in await _browse(session, "kubernetes")] == [jd.id]

        await session.rollback()
