"""Development responses expose their resource timing to the cross-origin Web_Client.

The Web_Client streams a CV upload (frontend R11 AC10) only when it can see that
the Backend_Api connection is HTTP/2 or later, which it reads from the resource
timing of its earlier requests. A browser hides that protocol from another
origin unless the response carries ``Timing-Allow-Origin``. The header follows
the CORS policy: development admits any origin, and production admits no
cross-origin caller, so there the Web_Client is same-origin and needs no header.
"""

from __future__ import annotations

from httpx import ASGITransport, AsyncClient
import pytest

from app import main
from app.config import get_settings

pytestmark = pytest.mark.unit

_PROBE_PATH = "/__probe/timing"


async def _probe_headers(monkeypatch: pytest.MonkeyPatch, app_env: str) -> dict[str, str]:
    settings = get_settings().model_copy(update={"app_env": app_env})
    monkeypatch.setattr(main, "get_settings", lambda: settings)
    application = main.create_app()

    @application.get(_PROBE_PATH)
    async def _probe() -> dict[str, str]:
        return {}

    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(_PROBE_PATH, headers={"Origin": "http://localhost:5173"})
    return dict(response.headers)


async def test_development_responses_carry_timing_allow_origin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = await _probe_headers(monkeypatch, "development")
    assert headers.get("timing-allow-origin") == "*"


async def test_production_responses_do_not(monkeypatch: pytest.MonkeyPatch) -> None:
    headers = await _probe_headers(monkeypatch, "production")
    assert "timing-allow-origin" not in headers
