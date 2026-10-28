"""Every reporting query runs on asyncpg, with and without its filters (TASK-28 Bug 3).

The reporting repository is raw ``text()`` SQL, and it carried two defects that
only a real asyncpg connection reveals:

* ``(:date_from IS NULL OR created_at >= :date_from)``: asyncpg types every
  parameter when it prepares the statement, and a bare ``$1 IS NULL`` gives it
  nothing to infer from, so it raises ``AmbiguousParameterError`` whatever value
  is bound. No input made the activity report work.
* ``:jd_id::uuid``: ``text()`` does not treat ``:name`` as a bind when ``::``
  follows it, so the literal ``:jd_id`` reached PostgreSQL as a syntax error. The
  same shape sat in the candidate-progress page query, so that endpoint failed on
  every call, first page included.

Runs against ``alembic upgrade head``. One transaction, rolled back at the end.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING
import uuid

import pytest
from sqlalchemy import text

from app.modules.reporting import repository as repo

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

pytestmark = pytest.mark.integration

_WINDOWS = [
    pytest.param(None, None, id="unfiltered"),
    pytest.param(
        datetime(2000, 1, 1, tzinfo=UTC),
        datetime.now(UTC) + timedelta(days=1),
        id="date-window",
    ),
]


async def _seed_candidates(session: AsyncSession, count: int) -> list[uuid.UUID]:
    ids = []
    for n in range(count):
        ids.append(
            (
                await session.execute(
                    text(
                        "INSERT INTO accounts (email, roles, password_hash) "
                        "VALUES (:e, ARRAY['CANDIDATE']::role[], 'x') RETURNING id"
                    ),
                    {"e": f"bug3-{n}-{uuid.uuid4().hex[:8]}@example.test"},
                )
            ).scalar_one()
        )
    return ids


@pytest.mark.parametrize(("date_from", "date_to"), _WINDOWS)
@pytest.mark.parametrize("jd_id", [None, uuid.uuid4()], ids=["any-jd", "one-jd"])
async def test_activity_report_queries_run(
    pg_sessionmaker: async_sessionmaker[AsyncSession],
    date_from: datetime | None,
    date_to: datetime | None,
    jd_id: uuid.UUID | None,
) -> None:
    async with pg_sessionmaker() as session:
        await _seed_candidates(session, 2)
        window = {"date_from": date_from, "date_to": date_to}

        assert await repo.count_candidates_registered(session, **window) >= 2
        assert await repo.count_candidates_by_status(session, "Approved", **window) >= 0
        assert await repo.count_cv_versions_uploaded(session, **window) >= 0
        by_status = await repo.count_applications_by_status(session, jd_id=jd_id, **window)
        assert isinstance(by_status, dict)
        rows = await repo.fetch_applications_for_export(session, jd_id=jd_id, **window)
        assert isinstance(rows, list)

        await session.rollback()


async def test_candidate_progress_pages_by_keyset(
    pg_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    async with pg_sessionmaker() as session:
        seeded = set(await _seed_candidates(session, 3))

        # Walk every page exactly the way ReportService does: the repository
        # over-fetches by one row, and that extra row is the only has_next signal.
        # (It used to trim the extra row itself, so has_next was always false and
        # nothing past the first page was reachable.)
        limit = 2
        seen: list[uuid.UUID] = []
        after_id: uuid.UUID | None = None
        while True:
            fetched = await repo.list_candidate_progress(session, after_id=after_id, limit=limit)
            assert len(fetched) <= limit + 1
            has_next = len(fetched) > limit
            page = fetched[:limit]
            seen.extend(row["account_id"] for row in page)
            if not has_next:
                break
            after_id = page[-1]["account_id"]

        assert seeded <= set(seen)
        assert len(seen) == len(set(seen))

        await session.rollback()
