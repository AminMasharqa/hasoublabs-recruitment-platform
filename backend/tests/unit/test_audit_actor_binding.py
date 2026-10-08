"""``bind_principal_actor`` attributes the request to its principal (R8 AC2, Bug 23).

Auditing must never fail the request it describes, so a missing or failing
resolver leaves the ``system`` actor rather than raising.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import TYPE_CHECKING
import uuid

import pytest

from app.modules.audit import service as audit_service
from app.modules.audit.service import AuditActorResolver
from app.platform.audit.actor import bind_principal_actor, configure_actor_identity_resolver
from app.platform.audit.context import audit_actor_id_var
from app.platform.audit.models import SYSTEM_ACTOR_UUID
from app.platform.middleware.context import current_actor
from app.platform.security.principal import Principal
from app.platform.security.types import AccountStatus, Role

if TYPE_CHECKING:
    from collections.abc import Iterator

pytestmark = pytest.mark.unit

_ACCOUNT = uuid.uuid4()
_IDENTITY = uuid.uuid4()
_PRINCIPAL = Principal(
    account_id=_ACCOUNT,
    roles=frozenset({Role.CANDIDATE, Role.SENIOR}),
    active_context=Role.SENIOR,
    status=AccountStatus.APPROVED,
    session_id="s",
)


@pytest.fixture(autouse=True)
def _no_resolver() -> Iterator[None]:
    yield
    configure_actor_identity_resolver(None)


class _Resolver:
    def __init__(self, result: uuid.UUID | Exception) -> None:
        self.result = result
        self.calls: list[tuple[uuid.UUID, str]] = []

    async def resolve(self, account_id: uuid.UUID, role: str) -> uuid.UUID:
        self.calls.append((account_id, role))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


async def test_binds_the_actor_and_its_identity_for_the_active_context() -> None:
    resolver = _Resolver(_IDENTITY)
    configure_actor_identity_resolver(resolver)

    await bind_principal_actor(_PRINCIPAL)

    assert resolver.calls == [(_ACCOUNT, "SENIOR")]
    assert audit_actor_id_var.get() == _IDENTITY
    actor = current_actor()
    assert actor.account_id == _ACCOUNT
    assert actor.active_context == "SENIOR"
    assert actor.roles == frozenset({"CANDIDATE", "SENIOR"})


async def test_without_a_resolver_entries_stay_system() -> None:
    await bind_principal_actor(_PRINCIPAL)

    assert audit_actor_id_var.get() == SYSTEM_ACTOR_UUID
    assert current_actor().account_id == _ACCOUNT


async def test_a_failing_resolver_never_fails_the_request() -> None:
    configure_actor_identity_resolver(_Resolver(RuntimeError("db down")))

    await bind_principal_actor(_PRINCIPAL)

    assert audit_actor_id_var.get() == SYSTEM_ACTOR_UUID


class _Uow:
    session = object()

    async def __aenter__(self) -> _Uow:
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None


async def test_resolver_labels_the_identity_and_caches_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    upserts: list[dict[str, object]] = []

    async def _upsert(_session: object, **kwargs: object) -> uuid.UUID:
        upserts.append(kwargs)
        return _IDENTITY

    class _IdentityApi:
        async def get_account(self, account_id: uuid.UUID) -> SimpleNamespace:
            return SimpleNamespace(id=account_id, email="senior@example.test")

    monkeypatch.setattr(audit_service, "upsert_actor_identity", _upsert)
    resolver = AuditActorResolver(_Uow, identity_api=_IdentityApi())  # type: ignore[arg-type]

    assert await resolver.resolve(_ACCOUNT, "SENIOR") == _IDENTITY
    assert await resolver.resolve(_ACCOUNT, "SENIOR") == _IDENTITY

    assert upserts == [
        {
            "account_id": _ACCOUNT,
            "role": "SENIOR",
            "display_name": "senior@example.test (Senior)",
            "email": "senior@example.test",
        }
    ]
