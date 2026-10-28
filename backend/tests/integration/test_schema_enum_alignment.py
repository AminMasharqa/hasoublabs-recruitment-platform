"""The migrated schema must agree with the ORM about every enum column.

This is the guard for the defect fixed by ``0010_enum_column_alignment``: the
migrations created each native enum type but declared the columns holding those
values as ``VARCHAR``, while the models mapped them to the enum. Nothing failed at
startup. It failed at query time, and only for queries that *compared* such a
column to a bound parameter — asyncpg sends ``$1::account_status`` and PostgreSQL
has no ``character varying = account_status`` operator — so ``POST /verify/code``
returned 500 while most endpoints looked healthy.

The check runs against a database built by ``alembic upgrade head`` (the
``pg_engine`` fixture), never by ``Base.metadata.create_all``. That distinction is
the whole point: ``create_all`` derives the schema *from the models*, so the two
representations always agree and this class of drift is invisible.

Deliberately narrow. A full ``compare_metadata`` diff of this schema also reports
audit-log child partitions, server defaults the models do not declare, column
comments and expression indexes Alembic cannot compare — dozens of benign entries
that would make a total-drift assertion useless as a signal. Enum columns are
checked exactly, and only enum columns.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, NamedTuple

import pytest
from sqlalchemy import Enum as SaEnum
from sqlalchemy import text

from app.platform.db.metadata import target_metadata

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncEngine

pytestmark = pytest.mark.integration


class EnumColumn(NamedTuple):
    """One ORM column mapped to a native PostgreSQL enum."""

    table: str
    column: str
    type_name: str
    labels: tuple[str, ...]

    def __str__(self) -> str:  # pragma: no cover - test ids only
        return f"{self.table}.{self.column}"


def _orm_enum_columns() -> list[EnumColumn]:
    """Every column the ORM maps to a *named* native enum type."""
    found = [
        EnumColumn(
            table=table.name,
            column=column.name,
            type_name=column.type.name,
            labels=tuple(column.type.enums),
        )
        for table in target_metadata.tables.values()
        for column in table.columns
        if isinstance(column.type, SaEnum) and column.type.name is not None
    ]
    return sorted(found)


#: Collected once at import time so a missing model registration in
#: ``app.platform.db.metadata`` shows up as a collection error rather than as a
#: silently empty test.
ENUM_COLUMNS = _orm_enum_columns()


def test_orm_declares_enum_columns() -> None:
    """Sanity check: the metadata is populated.

    ``Base.metadata`` only knows a table once its module is imported. If
    ``app.platform.db.metadata`` stops importing a model module, every
    per-column check below would pass by vacuously skipping it.
    """
    assert len(ENUM_COLUMNS) >= 20, (
        f"only {len(ENUM_COLUMNS)} enum columns found — is a model module"
        " missing from app.platform.db.metadata?"
    )


async def test_every_orm_enum_column_is_that_enum_in_the_database(
    pg_engine: AsyncEngine,
) -> None:
    """No ORM enum column may be stored as ``varchar`` (or any other type)."""
    async with pg_engine.connect() as conn:
        rows = (
            await conn.execute(
                text(
                    "SELECT table_name, column_name, udt_name"
                    " FROM information_schema.columns"
                    " WHERE table_schema = current_schema()"
                )
            )
        ).all()
    actual = {(r.table_name, r.column_name): r.udt_name for r in rows}

    mismatched = [
        f"{col}: expected {col.type_name}, schema has"
        f" {actual.get((col.table, col.column), '<column missing>')}"
        for col in ENUM_COLUMNS
        if actual.get((col.table, col.column)) != col.type_name
    ]

    assert not mismatched, (
        "Columns the ORM maps to a native enum but the migrations did not:\n  "
        + "\n  ".join(mismatched)
        + "\nA bound enum parameter cannot be compared against these columns;"
        " every query that filters on one raises UndefinedFunctionError."
    )


async def test_enum_types_carry_exactly_the_labels_the_orm_declares(
    pg_engine: AsyncEngine,
) -> None:
    """A type whose labels drifted is the same defect one layer down.

    Order matters as well as membership: PostgreSQL orders enum labels by
    ``enumsortorder``, and any comparison or ``ORDER BY`` on the column uses that
    order, not the Python declaration order.
    """
    async with pg_engine.connect() as conn:
        rows = (
            await conn.execute(
                text(
                    "SELECT t.typname, e.enumlabel"
                    " FROM pg_type t"
                    " JOIN pg_enum e ON e.enumtypid = t.oid"
                    " JOIN pg_namespace n ON n.oid = t.typnamespace"
                    " WHERE n.nspname = current_schema()"
                    " ORDER BY t.typname, e.enumsortorder"
                )
            )
        ).all()

    db_labels: dict[str, list[str]] = {}
    for type_name, label in rows:
        db_labels.setdefault(type_name, []).append(label)

    problems = [
        f"{col.type_name} (used by {col}): ORM declares {list(col.labels)},"
        f" schema has {db_labels.get(col.type_name, '<type missing>')}"
        for col in ENUM_COLUMNS
        if db_labels.get(col.type_name) != list(col.labels)
    ]

    assert not problems, "Enum types whose labels differ from the ORM:\n  " + "\n  ".join(
        problems
    )
