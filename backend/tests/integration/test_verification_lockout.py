"""Wrong verification codes are counted, and the fifth locks code entry (R2 AC8).

``verify_code`` incremented the attempt count and then raised
``InvalidVerificationCode`` inside the same UnitOfWork, which rolls back on any
exception, so the increment was never stored. Wrong attempts left no trace, the
lockout could never engage, and the six-digit code could be guessed without
limit.

Runs against ``alembic upgrade head`` through the real ``UnitOfWork``.
"""

from __future__ import annotations

from datetime import timedelta
from typing import TYPE_CHECKING
import uuid

import pytest
from sqlalchemy import text

from app.modules.identity import repository as repo
from app.modules.identity.errors import InvalidVerificationCode
from app.modules.identity.service import VerificationService, _hmac_code
from app.platform.db.base import utc_now
from app.platform.db.enums import Role
from app.platform.db.unit_of_work import UnitOfWork
from app.platform.errors.base import CodeEntryLocked

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

pytestmark = [pytest.mark.integration, pytest.mark.security]

_PEPPER = b"test-pepper"
_CODE = "123456"


async def _pending_account(sessionmaker: async_sessionmaker[AsyncSession]) -> uuid.UUID:
    async with UnitOfWork(sessionmaker) as uow:
        account = await repo.create_account(
            uow.session,
            email=f"verify-{uuid.uuid4().hex[:10]}@example.com",
            roles=[Role.CANDIDATE],
            password_hash="x",
        )
        await repo.create_email_verification(
            uow.session,
            account_id=account.id,
            code_hash=_hmac_code(_CODE, _PEPPER),
            expires_at=utc_now() + timedelta(hours=1),
        )
    return account.id


async def _attempts(sessionmaker: async_sessionmaker[AsyncSession], account_id: uuid.UUID) -> int:
    async with sessionmaker() as session:
        return int(
            await session.scalar(
                text("SELECT attempt_count FROM email_verifications WHERE account_id = :a"),
                {"a": account_id},
            )
        )


async def test_wrong_codes_are_counted_and_the_fifth_locks_entry(
    pg_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    service = VerificationService(lambda: UnitOfWork(pg_sessionmaker), pepper=_PEPPER)
    account_id = await _pending_account(pg_sessionmaker)

    for attempt in range(1, 6):
        with pytest.raises(InvalidVerificationCode):
            await service.verify_code(account_id, "000000")
        assert await _attempts(pg_sessionmaker, account_id) == attempt

    # Five wrong codes are recorded: even the right one is refused now.
    with pytest.raises(CodeEntryLocked):
        await service.verify_code(account_id, _CODE)


async def test_the_right_code_still_verifies_after_fewer_wrong_ones(
    pg_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    service = VerificationService(lambda: UnitOfWork(pg_sessionmaker), pepper=_PEPPER)
    account_id = await _pending_account(pg_sessionmaker)

    with pytest.raises(InvalidVerificationCode):
        await service.verify_code(account_id, "000000")
    verified = await service.verify_code(account_id, _CODE)

    assert verified.status == "PendingApproval"
