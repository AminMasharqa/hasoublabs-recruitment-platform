"""The app factory renders every error through the platform envelope.

``app/main.py`` used to register its own ``PlatformError`` /
``RequestValidationError`` / ``Exception`` handlers, which dropped
``PlatformError.fields`` and sent the raw message key; the platform envelope
(``platform/errors/handlers.py::register_error_handlers``) was never called. A
profile save refused for an invalid phone therefore answered
``{"error": "profile_validation_failed", "details": null}`` — no field named,
contrary to R4 AC11.

No I/O and no lifespan: the app is built but never started, so these requests
reach only the routing and exception layers.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from httpx import ASGITransport, AsyncClient
import pytest

from app.main import create_app
from app.modules.profiles.errors import ProfileValidationFailed
from app.platform.errors.base import FieldViolation, PlatformError
from app.platform.errors.handlers import _platform_error_handler
from app.platform.security.errors import AuthenticationRequired, AuthorizationDenied
from app.platform.security.guards import (
    authentication_required_handler,
    authorization_denied_handler,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from fastapi import FastAPI

pytestmark = pytest.mark.unit

_PROBE_PATH = "/__probe/profile-validation-failed"


@pytest.fixture
def app() -> FastAPI:
    application = create_app()

    @application.get(_PROBE_PATH)
    async def _probe() -> None:
        raise ProfileValidationFailed(
            fields=[
                FieldViolation(path="phone", code="invalid_e164_phone"),
                FieldViolation(path="email", code="invalid_email_format"),
            ]
        )

    return application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def test_platform_and_security_handlers_are_registered(app: FastAPI) -> None:
    assert app.exception_handlers[PlatformError] is _platform_error_handler
    # The more specific security handlers stay in place (fixed-latency denial).
    assert app.exception_handlers[AuthorizationDenied] is authorization_denied_handler
    assert app.exception_handlers[AuthenticationRequired] is authentication_required_handler


async def test_a_domain_error_names_every_invalid_field(client: AsyncClient) -> None:
    response = await client.get(_PROBE_PATH)

    assert response.status_code == 422
    body = response.json()
    assert body["error"] == "profile_validation_failed"
    assert [(f["path"], f["code"]) for f in body["fields"]] == [
        ("phone", "invalid_e164_phone"),
        ("email", "invalid_email_format"),
    ]
    assert body["request_id"] == response.headers["X-Request-ID"]


async def test_request_body_validation_uses_the_envelope(client: AsyncClient) -> None:
    response = await client.post("/api/v1/auth/login", json={}, headers={"Accept-Language": "en"})

    assert response.status_code == 422
    body = response.json()
    assert body["error"] == "validation_failed"
    paths = {f["path"] for f in body["fields"]}
    assert {"email", "password"} <= paths
    # A localized sentence, not the raw catalog key.
    assert body["message"]
    assert not body["message"].startswith("error.")


async def test_an_unknown_route_answers_with_the_envelope(client: AsyncClient) -> None:
    response = await client.get("/api/v1/no-such-route")

    assert response.status_code == 404
    body = response.json()
    assert body["error"] == "not_found"
    assert "detail" not in body
