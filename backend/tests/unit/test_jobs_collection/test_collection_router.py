"""Unit tests for the R23 collection Admin endpoints (Task 9).

Tests use FastAPI's TestClient with dependency_overrides to bypass the
``require()`` auth guard — the guard itself is tested separately in the
security suite.  This file focuses on HTTP status codes and that the
router delegates to ``JobCollectionService`` with the right arguments.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock
import uuid

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app.modules.jobs.router import router
from app.modules.jobs.schemas import (
    CollectionRunDTO,
    FlagResolveResponse,
    JobDescriptionFlagDTO,
    JobSourceDTO,
)
from app.platform.db.enums import CollectionRunStatus, JobSourceType
from app.platform.security import guards as _guards
from app.platform.security.principal import Principal
from app.platform.security.types import AccountStatus, Role

pytestmark = [pytest.mark.unit]

# ── Helpers ────────────────────────────────────────────────────────────────────

_ADMIN_ID = uuid.uuid4()

_ADMIN_PRINCIPAL = Principal(
    account_id=_ADMIN_ID,
    roles=frozenset({Role.ADMIN}),
    active_context=Role.ADMIN,
    status=AccountStatus.APPROVED,
    session_id="test-session",
)

def _make_app(collection_service: Any) -> FastAPI:
    """Wrap the jobs router in a minimal FastAPI app with the service on state.

    Bypasses JWT/session validation by overriding ``current_principal``,
    which is the shared dependency that every ``require()`` guard delegates to.
    """
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.state.collection_service = collection_service
    # Override the shared current_principal dependency so all require() guards
    # receive our admin principal without any token / session interaction.
    app.dependency_overrides[_guards.current_principal] = lambda: _ADMIN_PRINCIPAL
    return app


def _make_source_dto(**overrides: Any) -> JobSourceDTO:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    defaults: dict[str, Any] = {
        "id": uuid.uuid4(),
        "name": "Test Source",
        "source_type": JobSourceType.GREENHOUSE,
        "slug": "test-source",
        "workday_tenant": None,
        "workday_site": None,
        "poll_interval_hours": 6,
        "enabled": True,
        "last_polled_at": None,
        "created_at": now,
        "updated_at": now,
    }
    defaults.update(overrides)
    return JobSourceDTO(**defaults)


def _make_run_dto(**overrides: Any) -> CollectionRunDTO:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    defaults: dict[str, Any] = {
        "id": uuid.uuid4(),
        "source_id": uuid.uuid4(),
        "started_at": now,
        "finished_at": None,
        "jobs_fetched": 0,
        "jobs_created": 0,
        "jobs_skipped": 0,
        "jobs_flagged": 0,
        "error_detail": None,
        "status": CollectionRunStatus.RUNNING,
    }
    defaults.update(overrides)
    return CollectionRunDTO(**defaults)


# ── POST /jobs/sources → 201 ───────────────────────────────────────────────────


def test_create_source_returns_201() -> None:
    source_dto = _make_source_dto()
    svc = MagicMock()
    svc.create_source = AsyncMock(return_value=source_dto)

    client = TestClient(_make_app(svc))
    resp = client.post(
        "/api/v1/jobs/sources",
        json={
            "name": "Test Source",
            "source_type": "greenhouse",
            "slug": "test-source",
            "poll_interval_hours": 6,
        },
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["id"] == str(source_dto.id)
    assert data["name"] == "Test Source"
    svc.create_source.assert_awaited_once()


# ── GET /jobs/sources → 200 ────────────────────────────────────────────────────


def test_list_sources_returns_200() -> None:
    dtos = [_make_source_dto(), _make_source_dto()]
    svc = MagicMock()
    svc.list_sources = AsyncMock(return_value=dtos)

    client = TestClient(_make_app(svc))
    resp = client.get("/api/v1/jobs/sources")

    assert resp.status_code == 200
    assert len(resp.json()) == 2
    svc.list_sources.assert_awaited_once()


# ── GET /jobs/sources/{source_id} → 200 ───────────────────────────────────────


def test_get_source_returns_200() -> None:
    source_id = uuid.uuid4()
    dto = _make_source_dto(id=source_id)
    svc = MagicMock()
    svc.get_source = AsyncMock(return_value=dto)

    client = TestClient(_make_app(svc))
    resp = client.get(f"/api/v1/jobs/sources/{source_id}")

    assert resp.status_code == 200
    assert resp.json()["id"] == str(source_id)
    svc.get_source.assert_awaited_once_with(source_id)


# ── PATCH /jobs/sources/{source_id} → 200 ─────────────────────────────────────


def test_update_source_returns_200() -> None:
    source_id = uuid.uuid4()
    dto = _make_source_dto(id=source_id, name="Updated")
    svc = MagicMock()
    svc.update_source = AsyncMock(return_value=dto)

    client = TestClient(_make_app(svc))
    resp = client.patch(
        f"/api/v1/jobs/sources/{source_id}",
        json={"name": "Updated"},
    )

    assert resp.status_code == 200
    assert resp.json()["name"] == "Updated"
    svc.update_source.assert_awaited_once()


# ── DELETE /jobs/sources/{source_id} → 204 ────────────────────────────────────


def test_delete_source_returns_204() -> None:
    source_id = uuid.uuid4()
    svc = MagicMock()
    svc.delete_source = AsyncMock(return_value=None)

    client = TestClient(_make_app(svc))
    resp = client.delete(f"/api/v1/jobs/sources/{source_id}")

    assert resp.status_code == 204
    assert resp.content == b""
    svc.delete_source.assert_awaited_once_with(source_id)


# ── POST /jobs/sources/{source_id}/collect → 202 ──────────────────────────────


def test_trigger_collect_returns_202() -> None:
    source_id = uuid.uuid4()
    run_dto = _make_run_dto(source_id=source_id)
    svc = MagicMock()
    svc.trigger_collect = AsyncMock(return_value=run_dto)

    client = TestClient(_make_app(svc))
    resp = client.post(f"/api/v1/jobs/sources/{source_id}/collect")

    assert resp.status_code == 202
    data = resp.json()
    assert data["id"] == str(run_dto.id)
    assert data["source_id"] == str(source_id)
    svc.trigger_collect.assert_awaited_once_with(source_id)


# ── GET /jobs/sources/{source_id}/runs → 200 ──────────────────────────────────


def test_list_runs_returns_200() -> None:
    source_id = uuid.uuid4()
    runs = [_make_run_dto(source_id=source_id)]
    svc = MagicMock()
    svc.list_runs = AsyncMock(return_value=runs)

    client = TestClient(_make_app(svc))
    resp = client.get(f"/api/v1/jobs/sources/{source_id}/runs")

    assert resp.status_code == 200
    assert len(resp.json()) == 1
    svc.list_runs.assert_awaited_once()


# ── GET /jobs/flags → 200 ─────────────────────────────────────────────────────


def test_list_flags_returns_200() -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    flag = JobDescriptionFlagDTO(
        id=uuid.uuid4(),
        source_id=uuid.uuid4(),
        run_id=uuid.uuid4(),
        external_url="https://example.com/job/1",
        raw_payload={"title": "Engineer"},
        missing_fields=["company"],
        flagged_at=now,
        resolved_at=None,
        resolved_by=None,
    )
    svc = MagicMock()
    svc.list_flags = AsyncMock(return_value=[flag])

    client = TestClient(_make_app(svc))
    resp = client.get("/api/v1/jobs/flags")

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["external_url"] == "https://example.com/job/1"
    svc.list_flags.assert_awaited_once()


# ── POST /jobs/flags/{flag_id}/resolve → 200 ──────────────────────────────────


def test_resolve_flag_returns_200() -> None:
    flag_id = uuid.uuid4()
    resolve_response = FlagResolveResponse(
        flag_id=flag_id,
        status="resolved",
        job_description_id=None,
    )
    svc = MagicMock()
    svc.resolve_flag = AsyncMock(return_value=resolve_response)

    client = TestClient(_make_app(svc))
    resp = client.post(
        f"/api/v1/jobs/flags/{flag_id}/resolve",
        json={"action": "dismiss"},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["flag_id"] == str(flag_id)
    assert data["status"] == "resolved"
    svc.resolve_flag.assert_awaited_once()
    # Verify resolver_account_id was passed from the principal
    call_kwargs = svc.resolve_flag.call_args.kwargs
    assert call_kwargs["resolver_account_id"] == _ADMIN_ID
