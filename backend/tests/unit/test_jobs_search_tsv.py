"""Unit guards for ``job_descriptions.search_tsv`` (TASK-28 Bug 7).

The column is owned by the ``trg_jd_search_tsv`` trigger. It used to be declared
as a plain ``sa.Text`` column, so the ORM sent an explicit ``NULL::VARCHAR`` for
it on every INSERT and PostgreSQL rejected the statement (``POST /jobs`` → 500).
The browse query also wrapped the column in ``to_tsvector``, which has no
``to_tsvector(regconfig, tsvector)`` signature.

No I/O: the model contract is read from the mapper, and the browse statement is
captured from a fake session and compiled for the PostgreSQL dialect. The real
INSERT-and-search round trip is ``tests/integration/test_jobs_search_tsv.py``.
"""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import FetchedValue, inspect
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import TSVECTOR

from app.modules.jobs import repository as repo
from app.modules.jobs.models import JobDescription

pytestmark = pytest.mark.unit


def test_search_tsv_is_a_database_generated_tsvector() -> None:
    column = JobDescription.__table__.c.search_tsv

    assert isinstance(column.type, TSVECTOR)
    # A FetchedValue server default is what keeps the ORM from writing the column.
    assert isinstance(column.server_default, FetchedValue)
    assert isinstance(column.server_onupdate, FetchedValue)


def test_search_tsv_is_deferred() -> None:
    prop = inspect(JobDescription).attrs.search_tsv
    assert prop.deferred is True


class _Result:
    def scalars(self) -> _Result:
        return self

    def all(self) -> list[Any]:
        return []


class _CapturingSession:
    """Records the statement instead of executing it."""

    def __init__(self) -> None:
        self.statement: Any = None

    async def execute(self, statement: Any) -> _Result:
        self.statement = statement
        return _Result()


async def _compiled_browse_sql(search: str | None) -> str:
    session = _CapturingSession()
    await repo.list_open_jds(
        session,  # type: ignore[arg-type]
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
    return str(session.statement.compile(dialect=postgresql.dialect()))


async def test_search_matches_the_stored_tsvector_directly() -> None:
    sql = await _compiled_browse_sql("python")

    assert "job_descriptions.search_tsv @@ plainto_tsquery(" in sql
    assert "to_tsvector" not in sql


async def test_browse_does_not_select_the_vector() -> None:
    sql = await _compiled_browse_sql(None)

    select_list = sql.split(" FROM ", 1)[0]
    assert "search_tsv" not in select_list
