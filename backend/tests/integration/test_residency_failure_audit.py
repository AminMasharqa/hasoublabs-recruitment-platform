"""A residency-validation failure at registration is audited (R8 AC1).

R8 AC1 lists "Residency_Validation failures at registration" among the actions
that must leave an Audit_Log entry. ``RegistrationService.register`` validates
the proof before it opens a transaction, so the failure raised with no
UnitOfWork running and nothing was recorded.

The entry names the proof type, never the submitted value or the validator's
reason text: both can carry parts of the proof (a mobile prefix, a city), which
is encrypted at rest and must not be copied into the append-only log.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import TYPE_CHECKING
import uuid

import pytest
from sqlalchemy import text

from app.modules.identity.errors import ResidencyValidationFailed
from app.modules.identity.schemas import RegistrationRequest
from app.modules.identity.service import RegistrationService
from app.platform.db.unit_of_work import UnitOfWork

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

pytestmark = pytest.mark.integration

_PROOF_VALUE = "0539876543"


class _RejectingValidator:
    async def validate(self, _proof_type: object, _value: str) -> SimpleNamespace:
        return SimpleNamespace(
            is_valid=False, reason="Mobile prefix '053' is not a recognised Israeli mobile prefix"
        )


async def test_a_residency_failure_at_registration_leaves_one_failure_entry(
    pg_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    service = RegistrationService(
        lambda: UnitOfWork(pg_sessionmaker),
        residency_validator=_RejectingValidator(),  # type: ignore[arg-type]
        envelope_enc=None,  # type: ignore[arg-type]  # never reached
        blind_index_pepper=b"pepper",
    )
    request = RegistrationRequest(
        role="CANDIDATE",
        email=f"residency-{uuid.uuid4().hex[:8]}@example.com",
        password="Correct-Horse-Battery-Staple-9",
        full_name="Residency Probe",
        residency_proof_type="MobilePhone",
        residency_proof_value=_PROOF_VALUE,
        link_token="unused",
    )

    async with pg_sessionmaker() as session:
        before = await session.scalar(text("SELECT COALESCE(MAX(id), 0) FROM audit_log"))

    with pytest.raises(ResidencyValidationFailed):
        await service.register(request, "unused")

    async with pg_sessionmaker() as session:
        rows = (
            await session.execute(
                text(
                    "SELECT action, entity_type, entity_id, outcome, error_type, reason, "
                    "before, after FROM audit_log WHERE id > :before"
                ),
                {"before": before},
            )
        ).all()

    assert [(r.action, r.entity_type, r.entity_id, r.outcome, r.error_type) for r in rows] == [
        (
            "registration.residency_failed",
            "ResidencyProof",
            "MobilePhone",
            "failure",
            "ResidencyValidationFailed",
        )
    ]
    # Nothing from the proof reaches the append-only log.
    assert rows[0].reason is None
    assert _PROOF_VALUE not in str(tuple(rows[0]))
    assert "053" not in str(tuple(rows[0]))
