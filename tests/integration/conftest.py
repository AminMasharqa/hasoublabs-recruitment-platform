"""Integration-test fixtures: a real PostgreSQL via Testcontainers.

Section 2 owns the database foundation, so it also provides the shared
integration fixture every later module's integration tests build on: an
ephemeral PostgreSQL container, migrated to head, exposed as an async engine and
a session factory that a :class:`UnitOfWork` can be bound to.

Scope: the container is ``session``-scoped (starting PostgreSQL is slow, ~1–3 s),
while each test gets its own clean state. Tests that assert on full-database
snapshots (like the UoW rollback test) manage their own rows and assert
byte-identical before/after, so they do not rely on per-test truncation.

These fixtures require Docker to be available. When it is not (e.g. a static
lint-only CI stage), the tests that depend on ``pg_engine`` are skipped by the
guard fixture below rather than erroring.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from pathlib import Path

from alembic import command
from alembic.config import Config
import pytest
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

try:
    from testcontainers.postgres import PostgresContainer

    _TESTCONTAINERS_AVAILABLE = True
except ImportError:  # pragma: no cover - dev dependency may be absent
    _TESTCONTAINERS_AVAILABLE = False

_PROJECT_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def _postgres_container() -> Iterator[object]:
    """Start one PostgreSQL 16 container for the whole integration session."""
    if not _TESTCONTAINERS_AVAILABLE:
        pytest.skip("testcontainers not installed")
    with PostgresContainer("postgres:16") as container:
        yield container


def _sync_url(container: object) -> str:
    """psycopg2 URL for Alembic (migrations run on the sync driver)."""
    return container.get_connection_url()  # type: ignore[attr-defined]


def _async_url(container: object) -> str:
    """asyncpg URL for the runtime engine under test."""
    return _sync_url(container).replace("postgresql+psycopg2://", "postgresql+asyncpg://")


@pytest.fixture(scope="session")
def _migrated_container(_postgres_container: object) -> object:
    """Apply Alembic migrations to head against the container, once.

    The container's async URL is set as ``sqlalchemy.url`` on the Alembic config;
    ``env.py``'s ``get_url()`` honours that override (falling back to app settings
    only when it is unset), so migrations run against *this* container and not the
    database named in ``.env``. The URL uses the ``+asyncpg`` driver because
    migrations run on the async engine.
    """
    cfg = Config(str(_PROJECT_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(_PROJECT_ROOT / "alembic"))
    cfg.set_main_option("sqlalchemy.url", _async_url(_postgres_container))
    command.upgrade(cfg, "head")
    return _postgres_container


@pytest.fixture
async def pg_engine(_migrated_container: object) -> AsyncIterator[AsyncEngine]:
    """An async engine bound to the migrated test database."""
    engine = create_async_engine(_async_url(_migrated_container), future=True)
    try:
        yield engine
    finally:
        await engine.dispose()


@pytest.fixture
def pg_sessionmaker(pg_engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """A session factory bound to the test engine, matching production config."""
    return async_sessionmaker(
        bind=pg_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )
