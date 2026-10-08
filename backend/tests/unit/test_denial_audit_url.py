"""An authorization denial is audited over a connection with the real password.

``_schedule_denial_audit`` passed ``str(get_engine().url)`` to the failure-entry
writer. ``URL.__str__`` masks the password as ``***``, so the separate connection
failed authentication and, the write being best-effort, no ``auth.denied`` entry
was ever recorded (R3 AC9, R8 AC5): the Bug 6 defect on the denial path.

No I/O: the engine is never connected and the audit write is captured.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from app.platform.audit import chain as audit_chain
from app.platform.db import engine as db_engine
from app.platform.security.errors import AuthorizationDenied
from app.platform.security.guards import _schedule_denial_audit

pytestmark = pytest.mark.unit

_URL = "postgresql+asyncpg://hasoub:s3cret-pw@db.invalid:5432/hasoub"


async def test_denial_entry_connects_with_the_unmasked_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = create_async_engine(_URL)
    captured: list[dict[str, Any]] = []

    async def _capture(**kwargs: Any) -> None:  # noqa: ANN401
        captured.append(kwargs)

    monkeypatch.setattr(db_engine, "get_engine", lambda: engine)
    monkeypatch.setattr(audit_chain, "append_failure_entry", _capture)

    request = SimpleNamespace(
        state=SimpleNamespace(request_id="req-1"),
        url=SimpleNamespace(path="/api/v1/admin/accounts"),
        method="GET",
    )
    _schedule_denial_audit(request, AuthorizationDenied())  # type: ignore[arg-type]
    # The write is a task on the running loop; let it run.
    for _ in range(5):
        await asyncio.sleep(0)
    await engine.dispose()

    assert len(captured) == 1
    entry = captured[0]
    assert make_url(entry["engine_url"]).password == "s3cret-pw"
    assert entry["action"] == "auth.denied"
    assert entry["entity_id"] == "GET:/api/v1/admin/accounts"
    assert entry["request_id"] == "req-1"
