"""Async engine and session factory (Task 2.1).

One engine per process, created lazily from application settings, plus an
``async_sessionmaker`` configured the way the rest of the platform expects:

* ``expire_on_commit=False`` — after the ``UnitOfWork`` commits, service code and
  response serializers keep reading attributes off the returned ORM objects
  without triggering a fresh (now sessionless) lazy load.
* ``asyncpg`` driver — the runtime path is fully async; Alembic uses a sync
  driver separately (see ``alembic/env.py``), so this engine is the async one.

The engine and sessionmaker are module-level singletons behind ``lru_cache`` so
they are built once and shared, but never at import time — importing this module
must not require a live database or a populated environment (Alembic, unit tests,
and ``--help`` all import the package).
"""

from __future__ import annotations

from functools import lru_cache

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import get_settings


def _build_engine() -> AsyncEngine:
    settings = get_settings()
    # Settings validates ``database_url`` as a PostgresDsn; normalise the scheme
    # to the async driver so a plain ``postgresql://`` URL still works.
    url = str(settings.database_url)
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return create_async_engine(
        url,
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
        pool_pre_ping=True,  # recycle connections dropped by the server/proxy
        future=True,
    )


@lru_cache
def get_engine() -> AsyncEngine:
    """Return the process-wide async engine, building it on first use."""
    return _build_engine()


@lru_cache
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    """Return the process-wide session factory, building it on first use."""
    return async_sessionmaker(
        bind=get_engine(),
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )


async def dispose_engine() -> None:
    """Dispose the engine and clear the cached singletons.

    Called on application shutdown and between test modules that need a fresh
    engine bound to a different database URL.
    """
    if get_engine.cache_info().currsize:
        await get_engine().dispose()
    get_engine.cache_clear()
    get_sessionmaker.cache_clear()


__all__ = ["dispose_engine", "get_engine", "get_sessionmaker"]
