"""Registration and a verified code name the registrant as the audit actor (R8 AC2).

These routes are public, so no principal binds an actor and every entry said
``system``. Decision: name the account where it is known to be acting.

* **Registration:** every entry written after the account row exists. The
  ``Account.created`` entry itself is flushed before there is an identity to
  name, so it stays ``system``.
* **Verification:** from the moment the code checks out. A wrong code proves
  nothing about who submitted it, so the counted attempt stays ``system``.

Runs against ``alembic upgrade head`` with the real UnitOfWork and resolver.
"""

from __future__ import annotations

from datetime import timedelta
import hashlib
from types import SimpleNamespace
from typing import TYPE_CHECKING
import uuid

import pytest
from sqlalchemy import text

from app.modules.audit.service import AuditActorResolver
from app.modules.identity.errors import InvalidVerificationCode
from app.modules.identity.schemas import RegistrationRequest
from app.modules.identity.service import RegistrationService, VerificationService
from app.platform.audit.actor import configure_actor_identity_resolver
from app.platform.audit.context import audit_actor_id_var
from app.platform.db.base import utc_now
from app.platform.db.unit_of_work import UnitOfWork

if TYPE_CHECKING:
    from collections.abc import Iterator

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

pytestmark = pytest.mark.integration

_PEPPER = b"test-pepper"


class _ValidResidency:
    async def validate(self, _proof_type: object, _value: str) -> SimpleNamespace:
        return SimpleNamespace(is_valid=True, reason=None, validator_version="test")


class _Envelope:
    async def encrypt(self, _plaintext: bytes) -> tuple[bytes, bytes]:
        return b"ciphertext", b"wrapped-key"


@pytest.fixture(autouse=True)
def _resolver(pg_sessionmaker: async_sessionmaker[AsyncSession]) -> Iterator[None]:
    configure_actor_identity_resolver(
        AuditActorResolver(lambda: UnitOfWork(pg_sessionmaker), identity_api=None)  # type: ignore[arg-type]
    )
    token = audit_actor_id_var.set(audit_actor_id_var.get())
    yield
    audit_actor_id_var.reset(token)
    configure_actor_identity_resolver(None)


async def _link(sessionmaker: async_sessionmaker[AsyncSession], token: str) -> None:
    async with sessionmaker() as session, session.begin():
        admin = (
            await session.execute(
                text(
                    "INSERT INTO accounts (email, roles, status, password_hash) "
                    "VALUES (:e, ARRAY['ADMIN']::role[], 'Approved', 'x') RETURNING id"
                ),
                {"e": f"issuer-{uuid.uuid4().hex[:8]}@example.com"},
            )
        ).scalar_one()
        await session.execute(
            text(
                "INSERT INTO registration_links "
                "(token_hash, role, issued_by_account_id, expires_at) "
                "VALUES (:h, 'CANDIDATE', :a, :x)"
            ),
            {
                "h": hashlib.sha256(token.encode()).digest(),
                "a": admin,
                "x": utc_now() + timedelta(days=1),
            },
        )


async def _actors_since(
    sessionmaker: async_sessionmaker[AsyncSession], after_id: int
) -> list[tuple[str, uuid.UUID | None]]:
    """(action, the account the entry's actor identity names) for each new entry."""
    async with sessionmaker() as session:
        rows = (
            await session.execute(
                text(
                    "SELECT l.action, i.account_id FROM audit_log l "
                    "JOIN audit_actor_identities i ON i.id = l.actor_identity_id "
                    "WHERE l.id > :after ORDER BY l.id"
                ),
                {"after": after_id},
            )
        ).all()
    return [(row.action, row.account_id) for row in rows]


async def _max_id(sessionmaker: async_sessionmaker[AsyncSession]) -> int:
    async with sessionmaker() as session:
        return int(await session.scalar(text("SELECT COALESCE(MAX(id), 0) FROM audit_log")))


async def _code(sessionmaker: async_sessionmaker[AsyncSession], email: str) -> str:
    async with sessionmaker() as session:
        payload = await session.scalar(
            text(
                "SELECT payload FROM outbox_emails WHERE to_address = :e "
                "ORDER BY created_at DESC LIMIT 1"
            ),
            {"e": email},
        )
    return str(payload["code"])


async def test_registration_and_a_verified_code_name_the_registrant(
    pg_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    token = f"link-{uuid.uuid4().hex}"
    email = f"registrant-{uuid.uuid4().hex[:8]}@example.com"
    await _link(pg_sessionmaker, token)
    registration = RegistrationService(
        lambda: UnitOfWork(pg_sessionmaker),
        residency_validator=_ValidResidency(),  # type: ignore[arg-type]
        envelope_enc=_Envelope(),  # type: ignore[arg-type]
        blind_index_pepper=_PEPPER,
    )
    verification = VerificationService(lambda: UnitOfWork(pg_sessionmaker), pepper=_PEPPER)

    before = await _max_id(pg_sessionmaker)
    account = await registration.register(
        RegistrationRequest(
            role="CANDIDATE",
            email=email,
            password="Correct-Horse-Battery-Staple-9",
            full_name="Registrant",
            residency_proof_type="MobilePhone",
            residency_proof_value="0502345678",
            link_token=token,
        ),
        token,
    )
    registered = await _actors_since(pg_sessionmaker, before)
    assert registered[0] == ("Account.created", None)  # written before the identity exists
    assert registered[1:], "registration wrote no entries after the account"
    assert {actor for _, actor in registered[1:]} == {account.id}

    before = await _max_id(pg_sessionmaker)
    with pytest.raises(InvalidVerificationCode):
        await verification.verify_code(account.id, "000000")
    wrong = await _actors_since(pg_sessionmaker, before)
    assert wrong
    assert {actor for _, actor in wrong} == {None}  # anyone could have sent it

    before = await _max_id(pg_sessionmaker)
    await verification.verify_code(account.id, await _code(pg_sessionmaker, email))
    verified = await _actors_since(pg_sessionmaker, before)
    # The attempt is counted before the code is checked, so it stays `system`;
    # everything the correct code then changes names the account.
    assert verified[0] == ("EmailVerification.updated", None)
    assert any(action == "Account.updated" for action, _ in verified[1:])
    assert {actor for _, actor in verified[1:]} == {account.id}
