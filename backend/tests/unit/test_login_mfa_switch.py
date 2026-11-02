"""The ``MFA_REQUIRED`` switch on admin sign-in.

OTP stays on by default and can only be turned off in development, so the
shortcut that makes local work and tests easier cannot reach a deployed
environment. With it on, the login route behaves exactly as it did before.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import TYPE_CHECKING, Any, Literal
from unittest.mock import AsyncMock

from pydantic import ValidationError
import pytest

from app.config import Settings
from app.modules.identity import router as identity_router
from app.modules.identity.errors import InvalidMfaCode, MfaRequired
from app.modules.identity.schemas import LoginRequest

if TYPE_CHECKING:
    from types import TracebackType

pytestmark = [pytest.mark.unit, pytest.mark.security]

TOKEN_RESPONSE = object()


class _FakeUow:
    session = object()

    async def __aenter__(self) -> _FakeUow:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        return None


def _request(auth_service: SimpleNamespace) -> Any:  # noqa: ANN401
    state = SimpleNamespace(auth_service=auth_service, uow_factory=_FakeUow)
    return SimpleNamespace(app=SimpleNamespace(state=state))


@pytest.fixture
def auth_service() -> SimpleNamespace:
    return SimpleNamespace(
        login=AsyncMock(return_value=(object(), object())),
        logout=AsyncMock(),
        verify_mfa=AsyncMock(return_value=True),
    )


def _enrolled_admin(monkeypatch: pytest.MonkeyPatch, *, mfa_required: bool) -> None:
    """Sign-in reaches the MFA check for an enrolled Admin, with the switch set."""
    account = SimpleNamespace(id="account-1", mfa_secret_enc=b"encrypted-secret")
    monkeypatch.setattr(
        "app.modules.identity.repository.get_account_by_email",
        AsyncMock(return_value=account),
    )
    monkeypatch.setattr(
        "app.config.get_settings",
        lambda: SimpleNamespace(mfa_required=mfa_required),
    )
    monkeypatch.setattr(identity_router, "_token_response", lambda _pair: TOKEN_RESPONSE)


def _body(mfa_code: str | None = None) -> LoginRequest:
    return LoginRequest(
        email="admin@example.com",
        password="a-password",  # noqa: S106
        role="ADMIN",
        mfa_code=mfa_code,
    )


async def test_off_signs_an_enrolled_admin_in_without_a_code(
    monkeypatch: pytest.MonkeyPatch, auth_service: SimpleNamespace
) -> None:
    _enrolled_admin(monkeypatch, mfa_required=False)

    assert await identity_router.login(_body(), _request(auth_service)) is TOKEN_RESPONSE

    # Nothing is decrypted, so a lost OpenBao transit key cannot break sign-in.
    auth_service.verify_mfa.assert_not_awaited()


async def test_off_ignores_a_submitted_code(
    monkeypatch: pytest.MonkeyPatch, auth_service: SimpleNamespace
) -> None:
    _enrolled_admin(monkeypatch, mfa_required=False)

    assert await identity_router.login(_body("000000"), _request(auth_service)) is TOKEN_RESPONSE

    auth_service.verify_mfa.assert_not_awaited()


async def test_on_asks_an_enrolled_admin_for_a_code(
    monkeypatch: pytest.MonkeyPatch, auth_service: SimpleNamespace
) -> None:
    _enrolled_admin(monkeypatch, mfa_required=True)

    with pytest.raises(MfaRequired):
        await identity_router.login(_body(), _request(auth_service))


async def test_on_refuses_a_wrong_code(
    monkeypatch: pytest.MonkeyPatch, auth_service: SimpleNamespace
) -> None:
    _enrolled_admin(monkeypatch, mfa_required=True)
    auth_service.verify_mfa.return_value = False

    with pytest.raises(InvalidMfaCode):
        await identity_router.login(_body("000000"), _request(auth_service))


async def test_on_accepts_a_correct_code(
    monkeypatch: pytest.MonkeyPatch, auth_service: SimpleNamespace
) -> None:
    _enrolled_admin(monkeypatch, mfa_required=True)

    assert await identity_router.login(_body("123456"), _request(auth_service)) is TOKEN_RESPONSE

    auth_service.verify_mfa.assert_awaited_once_with("account-1", "123456")


def _settings(**overrides: Any) -> Settings:  # noqa: ANN401
    # `_env_file=None`: a developer's own `.env` must not decide these tests.
    return Settings(  # type: ignore[call-arg]
        _env_file=None,
        app_secret_key="x" * 32,
        database_url="postgresql://u:p@localhost/db",
        valkey_url="redis://localhost:6379/0",
        minio_endpoint="minio:9000",
        minio_access_key="ak",
        minio_secret_key="sk",
        openbao_token="tok",
        **overrides,
    )


def test_required_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MFA_REQUIRED", raising=False)

    assert _settings().mfa_required is True


def test_can_be_turned_off_in_development() -> None:
    assert _settings(app_env="development", mfa_required=False).mfa_required is False


@pytest.mark.parametrize("app_env", ["staging", "production"])
def test_refuses_to_start_with_it_off_outside_development(
    app_env: Literal["staging", "production"],
) -> None:
    with pytest.raises(ValidationError, match="MFA_REQUIRED"):
        _settings(app_env=app_env, mfa_required=False)
