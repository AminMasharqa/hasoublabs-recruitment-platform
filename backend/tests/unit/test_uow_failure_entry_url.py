"""The rolled-back UnitOfWork writes its failure entry with the real password.

``UnitOfWork._write_failure_entry`` passed ``str(engine.url)`` to
``append_failure_entry``. SQLAlchemy's ``URL.__str__`` masks the password as
``***``, so the separate connection failed authentication and — the write being
deliberately best-effort — no failure entry was ever recorded (R8 AC5, Bug 6).

No I/O: an async engine is created but never connected (a rollback of a session
that never ran a statement opens no connection), and the audit write is captured.
"""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.platform.audit import chain as audit_chain
from app.platform.db import unit_of_work
from app.platform.db.unit_of_work import UnitOfWork

pytestmark = pytest.mark.unit

_URL = "postgresql+asyncpg://hasoub:s3cret-pw@db.invalid:5432/hasoub"


async def test_failure_entry_connects_with_the_unmasked_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = create_async_engine(_URL)
    captured: list[dict[str, Any]] = []

    async def _capture(**kwargs: Any) -> None:
        captured.append(kwargs)

    monkeypatch.setattr(unit_of_work, "get_engine", lambda: engine)
    monkeypatch.setattr(audit_chain, "append_failure_entry", _capture)

    uow = UnitOfWork(async_sessionmaker(engine, class_=AsyncSession))
    with pytest.raises(ValueError, match="boom"):
        async with uow:
            raise ValueError("boom")
    await engine.dispose()

    assert len(captured) == 1
    entry = captured[0]
    assert "***" not in entry["engine_url"]
    assert make_url(entry["engine_url"]).password == "s3cret-pw"
    assert entry["action"] == "operation.failed"
    assert entry["error_type"] == "ValueError"
