"""Identity repository — all DB access for the identity module (Task 12.1).

Never imported by other modules; all cross-module access goes through api.py.
All functions are async and accept an AsyncSession as their first parameter so
they compose naturally inside a UnitOfWork transaction.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import func, select

from app.platform.db.base import utc_now
from app.platform.db.enums import (
    AccountStatus,
    EmailVerificationState,
    ResidencyProofType,
    Role,
)
from app.modules.identity.models import (
    Account,
    AccountStatusTransition,
    EmailVerification,
    RegistrationLink,
    ResidencyProof,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


# ── Account ────────────────────────────────────────────────────────────────


async def get_account_by_id(
    session: AsyncSession,
    account_id: UUID,
) -> Account | None:
    """Return the account with the given PK, or None."""
    result = await session.get(Account, account_id)
    return result


async def get_account_by_email(
    session: AsyncSession,
    email: str,
    role: Role,
) -> Account | None:
    """Return an active (unreleased) account matching email + role.

    Case-insensitive comparison; scoped to the role so the same email address
    may hold a Candidate account and a separate Senior account.
    """
    from sqlalchemy import cast  # noqa: PLC0415
    from sqlalchemy.dialects.postgresql import ARRAY as PG_ARRAY  # noqa: PLC0415

    from app.platform.db.enums import role_type  # noqa: PLC0415

    stmt = (
        select(Account)
        .where(
            func.lower(Account.email) == email.lower(),
            Account.email_released.is_(False),
            Account.roles.contains(cast([role], PG_ARRAY(role_type))),
        )
    )
    result = await session.scalars(stmt)
    return result.first()


async def create_account(
    session: AsyncSession,
    *,
    email: str,
    roles: list[Role],
    password_hash: str,
    language_preference: str = "ar",
) -> Account:
    """Create a new account in PendingVerification status and add to session."""
    account = Account(
        email=email,
        roles=roles,
        status=AccountStatus.PENDING_VERIFICATION,
        password_hash=password_hash,
        language_preference=language_preference,
    )
    session.add(account)
    await session.flush()  # populate .id
    return account


async def update_account_status(
    session: AsyncSession,
    account: Account,
    new_status: AccountStatus,
) -> None:
    """Set a new status on an account row (in-session mutation)."""
    account.status = new_status
    account.updated_at = utc_now()


async def update_account_password(
    session: AsyncSession,
    account: Account,
    new_hash: str,
) -> None:
    """Replace the password hash (used for rehash-on-login)."""
    account.password_hash = new_hash
    account.updated_at = utc_now()


async def update_account_mfa(
    session: AsyncSession,
    account: Account,
    secret_enc: bytes,
    wrapped_key: bytes,
    enrolled_at: datetime,
) -> None:
    """Store the encrypted MFA secret, its wrapped data key, and enrolment time."""
    account.mfa_secret_enc = secret_enc
    account.mfa_wrapped_key = wrapped_key
    account.mfa_enrolled_at = enrolled_at
    account.updated_at = utc_now()


async def release_account_email(
    session: AsyncSession,
    account: Account,
) -> None:
    """Mark the email slot as released so the address may be reused."""
    account.email_released = True
    account.updated_at = utc_now()


# ── Email verification ─────────────────────────────────────────────────────


async def get_email_verification(
    session: AsyncSession,
    account_id: UUID,
) -> EmailVerification | None:
    """Return the verification row for an account, or None."""
    stmt = select(EmailVerification).where(
        EmailVerification.account_id == account_id
    )
    result = await session.scalars(stmt)
    return result.first()


async def create_email_verification(
    session: AsyncSession,
    *,
    account_id: UUID,
    code_hash: bytes,
    expires_at: datetime,
) -> EmailVerification:
    """Create a new email verification row for an account."""
    verification = EmailVerification(
        account_id=account_id,
        state=EmailVerificationState.PENDING_CODE,
        code_hash=code_hash,
        code_digest=code_hash,  # same digest used for dedup
        attempt_count=0,
        expires_at=expires_at,
        issued_at=utc_now(),
    )
    session.add(verification)
    await session.flush()
    return verification


async def update_verification_state(
    session: AsyncSession,
    verification: EmailVerification,
    new_state: EmailVerificationState,
) -> None:
    """Transition the verification row to a new state."""
    verification.state = new_state
    if new_state == EmailVerificationState.VERIFIED:
        verification.verified_at = utc_now()


async def increment_verification_attempts(
    session: AsyncSession,
    verification: EmailVerification,
) -> int:
    """Increment attempt_count and return the new value."""
    verification.attempt_count += 1
    await session.flush()
    return verification.attempt_count


async def reset_verification_code(
    session: AsyncSession,
    verification: EmailVerification,
    *,
    new_code_hash: bytes,
    new_expires_at: datetime,
) -> None:
    """Replace the code hash, reset attempts, and extend the expiry window.

    Called by VerificationService.resend_code to issue a fresh 6-digit code.
    """
    verification.code_hash = new_code_hash
    verification.code_digest = new_code_hash
    verification.attempt_count = 0
    verification.expires_at = new_expires_at
    verification.issued_at = utc_now()
    verification.state = EmailVerificationState.PENDING_CODE


# ── Residency proof ────────────────────────────────────────────────────────


async def get_residency_proof(
    session: AsyncSession,
    account_id: UUID,
) -> ResidencyProof | None:
    """Return the residency proof row for an account, or None."""
    stmt = select(ResidencyProof).where(ResidencyProof.account_id == account_id)
    result = await session.scalars(stmt)
    return result.first()


async def upsert_residency_proof(
    session: AsyncSession,
    *,
    account_id: UUID,
    type: ResidencyProofType,
    value_enc: bytes,
    value_wrapped_key: bytes,
    value_digest: bytes,
    validator_version: str,
) -> ResidencyProof:
    """Create or replace the residency proof for an account.

    On conflict (account_id already has a row) the existing row is updated in
    place, because an account can only ever have one active residency proof.
    """
    existing = await get_residency_proof(session, account_id)
    if existing is not None:
        existing.type = type
        existing.value_enc = value_enc
        existing.value_wrapped_key = value_wrapped_key
        existing.value_digest = value_digest
        existing.validator_version = validator_version
        existing.updated_at = utc_now()
        await session.flush()
        return existing

    proof = ResidencyProof(
        account_id=account_id,
        type=type,
        value_enc=value_enc,
        value_wrapped_key=value_wrapped_key,
        value_digest=value_digest,
        validator_version=validator_version,
    )
    session.add(proof)
    await session.flush()
    return proof


# ── Account status transitions ─────────────────────────────────────────────


async def record_status_transition(
    session: AsyncSession,
    *,
    account_id: UUID,
    from_status: AccountStatus | None,
    to_status: AccountStatus,
    actor_account_id: UUID | None,
    reason: str | None,
) -> AccountStatusTransition:
    """Append one status-transition audit row."""
    transition = AccountStatusTransition(
        account_id=account_id,
        from_status=from_status,
        to_status=to_status,
        actor_account_id=actor_account_id,
        reason=reason,
        occurred_at=utc_now(),
    )
    session.add(transition)
    await session.flush()
    return transition


# ── Account listing ────────────────────────────────────────────────────────


async def list_accounts(
    session: AsyncSession,
    *,
    status: AccountStatus | None,
    role: Role | None,
    after_id: UUID | None,
    limit: int,
) -> list[Account]:
    """List accounts with optional filters and keyset pagination.

    Results are ordered by (created_at ASC, id ASC) for stable pagination.
    """
    from sqlalchemy import cast  # noqa: PLC0415
    from sqlalchemy.dialects.postgresql import ARRAY as PG_ARRAY  # noqa: PLC0415

    from app.platform.db.enums import role_type  # noqa: PLC0415

    stmt = select(Account).where(Account.email_released.is_(False))

    if status is not None:
        stmt = stmt.where(Account.status == status)

    if role is not None:
        # ``accounts.roles`` is ``role[]``; casting the operand to ``varchar[]``
        # leaves PostgreSQL with no ``role[] @> varchar[]`` operator.
        stmt = stmt.where(
            Account.roles.contains(cast([role.value], PG_ARRAY(role_type)))
        )

    if after_id is not None:
        # Keyset: created_at of the cursor row, then id as tiebreaker.
        subq = select(Account.created_at).where(Account.id == after_id).scalar_subquery()
        stmt = stmt.where(
            (Account.created_at > subq)
            | ((Account.created_at == subq) & (Account.id > after_id))
        )

    stmt = stmt.order_by(Account.created_at, Account.id).limit(limit)
    result = await session.scalars(stmt)
    return list(result.all())


async def get_all_admin_accounts(session: AsyncSession) -> list[Account]:
    """Return all active Admin accounts (used to build notification targets)."""
    from sqlalchemy import cast  # noqa: PLC0415
    from sqlalchemy.dialects.postgresql import ARRAY as PG_ARRAY  # noqa: PLC0415

    from app.platform.db.enums import Role, role_type  # noqa: PLC0415

    stmt = (
        select(Account)
        .where(
            Account.email_released.is_(False),
            Account.status == AccountStatus.APPROVED,
            # ``role[] @> varchar[]`` is not an operator PostgreSQL has; the
            # operand has to be cast to the same element type as the column.
            Account.roles.contains(cast([Role.ADMIN.value], PG_ARRAY(role_type))),
        )
        .order_by(Account.created_at)
    )
    result = await session.scalars(stmt)
    return list(result.all())


# ── Registration links ─────────────────────────────────────────────────────


async def get_registration_link(
    session: AsyncSession,
    token_hash: bytes,
) -> RegistrationLink | None:
    """Return the registration link with the given token hash, or None."""
    stmt = select(RegistrationLink).where(RegistrationLink.token_hash == token_hash)
    result = await session.scalars(stmt)
    return result.first()


async def create_registration_link(
    session: AsyncSession,
    *,
    token_hash: bytes,
    role: Role,
    issued_by_account_id: UUID,
    expires_at: datetime,
) -> RegistrationLink:
    """Create and persist a new registration link row."""
    link = RegistrationLink(
        token_hash=token_hash,
        role=role,
        issued_by_account_id=issued_by_account_id,
        expires_at=expires_at,
    )
    session.add(link)
    await session.flush()
    return link


async def increment_link_used_count(
    session: AsyncSession,
    link: RegistrationLink,
) -> None:
    """Record that the link was used for one more registration."""
    link.used_count += 1
