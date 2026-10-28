"""Alembic environment – uses async SQLAlchemy engine from platform/db."""

from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

# Alembic Config object
config = context.config

# Set up loggers from alembic.ini
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Import the aggregated metadata. ``app.platform.db.metadata`` imports every ORM
# model module, so ``Base.metadata`` is fully populated before autogenerate diffs
# it. Importing ``Base.metadata`` directly would see an empty schema (no model
# modules imported) and generate a migration that drops every table.
try:
    from app.platform.db.metadata import target_metadata  # noqa: PLC0415
except ImportError:
    target_metadata = None  # type: ignore[assignment]


def get_url() -> str:
    """Return the async DB URL for migrations.

    Precedence:
    1. An explicit ``sqlalchemy.url`` set on the Alembic config (e.g. by an
       integration-test fixture pointing at a Testcontainers database). This lets
       tests migrate the exact database they then connect to, instead of whatever
       ``.env`` names.
    2. Otherwise, the application settings' ``database_url`` (normal dev/prod use).

    Migrations run on the same ``asyncpg`` driver as the runtime (see
    ``run_async_migrations``), so no separate sync driver (psycopg2) is required.
    A bare ``postgresql://`` URL is normalised to ``postgresql+asyncpg://`` so the
    async engine is selected regardless of how the URL was written.
    """
    override = config.get_main_option("sqlalchemy.url")
    if override:
        url = override
    else:
        from app.config import get_settings  # noqa: PLC0415

        url = str(get_settings().database_url)
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (no live DB connection needed).

    Offline mode renders SQL to stdout via ``literal_binds`` and never opens a
    connection, so the driver is irrelevant — Alembic only needs the dialect. The
    ``+asyncpg`` suffix is stripped to the plain ``postgresql://`` form so dialect
    resolution does not attempt to load the async driver during pure SQL
    rendering.
    """
    url = get_url().replace("postgresql+asyncpg://", "postgresql://", 1)
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Run migrations against a live async engine."""
    configuration = config.get_section(config.config_ini_section) or {}
    configuration["sqlalchemy.url"] = get_url()
    connectable = async_engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
