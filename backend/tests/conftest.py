"""Global pytest fixtures shared across unit, integration, and e2e test suites."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from httpx import ASGITransport, AsyncClient
import pytest

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Iterator


# ── Event loop ────────────────────────────────────────────────────────────────


@pytest.fixture(scope="session")
def event_loop_policy() -> asyncio.DefaultEventLoopPolicy:
    return asyncio.DefaultEventLoopPolicy()


# ── Application client ────────────────────────────────────────────────────────


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    """Async test client for the FastAPI app."""
    from app.main import app  # noqa: PLC0415

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as ac:
        yield ac


# ── Settings override ─────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def override_settings(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:  # noqa: ARG001
    """Point tests at ephemeral infrastructure spun up by testcontainers."""
    # Actual DB/Valkey URLs are injected by the integration-specific fixtures.
    # This fixture is a no-op at unit-test scope.
    yield
