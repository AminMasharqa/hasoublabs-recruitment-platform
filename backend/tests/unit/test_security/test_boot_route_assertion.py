"""The boot-time route assertion: docs routes pass, lookalike paths do not.

``assert_all_routes_have_auth`` reported FastAPI's own documentation routes
(``/api/docs``, ``/api/redoc``, ``/api/openapi.json``, ``/docs/oauth2-redirect``)
as unguarded on every development start, so its "FAILED" log line was noise
that hid real findings. They exist only where the app enables them, which it
does not in production.

It also matched ``PUBLIC_ROUTE_PATHS`` by raw string prefix, so a new route such
as ``/api/v1/registrations/export`` would have been treated as public because it
starts with ``/api/v1/register``. A public path now covers itself and the paths
under it, segment by segment.
"""

from __future__ import annotations

import re
from types import SimpleNamespace

from fastapi import Depends, FastAPI
import pytest

from app.platform.db.enums import Role
from app.platform.security import guards
from app.platform.security.guards import assert_all_routes_have_auth, require

pytestmark = [pytest.mark.unit, pytest.mark.security]


@pytest.fixture(autouse=True)
def _production(monkeypatch: pytest.MonkeyPatch) -> None:
    # Production raises instead of logging, which makes the verdict observable.
    import app.config  # noqa: PLC0415

    monkeypatch.setattr(app.config, "get_settings", lambda: SimpleNamespace(is_production=True))


def _app(*unguarded_paths: str) -> FastAPI:
    application = FastAPI(
        docs_url="/api/docs", redoc_url="/api/redoc", openapi_url="/api/openapi.json"
    )

    guard = Depends(require(roles=frozenset({Role.ADMIN})))

    @application.get("/api/v1/admin/guarded", dependencies=[guard])
    async def _guarded() -> None:
        return None

    for path in unguarded_paths:
        application.add_api_route(path, lambda: None, methods=["GET"])
    return application


def test_the_apps_own_docs_routes_are_not_reported() -> None:
    assert_all_routes_have_auth(_app())


def test_paths_under_a_public_path_are_public() -> None:
    assert_all_routes_have_auth(_app("/api/v1/register/candidate", "/api/v1/verify/code"))


@pytest.mark.parametrize(
    "path",
    ["/api/v1/registrations/export", "/api/v1/verify-admin", "/healthz", "/api/v1/admin/open"],
)
def test_an_unguarded_route_that_only_resembles_a_public_path_fails_boot(path: str) -> None:
    with pytest.raises(RuntimeError, match=re.escape(path)):
        assert_all_routes_have_auth(_app(path))


def test_the_public_allowlist_is_unchanged() -> None:
    assert "/api/v1/register" in guards.PUBLIC_ROUTE_PATHS
