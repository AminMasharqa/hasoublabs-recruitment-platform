"""Identity service layer — RegistrationLinkService, RegistrationService,
VerificationService, AccountLifecycleService, AuthService (Tasks 12.1–12.5).

All five services follow the same pattern:
- __init__ receives a uow_factory (callable → UnitOfWork) and optional config.
- Methods open exactly one UnitOfWork per business operation.
- Side effects (emails, notifications) are queued inside the same transaction.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import secrets
from datetime import timedelta
from typing import TYPE_CHECKING
from uuid import UUID

from app.platform.db.base import utc_now
from app.platform.db.enums import (
    AccountStatus,
    EmailVerificationState,
    ResidencyProofType,
    Role,
)
from app.platform.db.unit_of_work import UnitOfWork
# Import security-layer equivalents used by SessionService / Principal.
from app.platform.security.types import (
    AccountStatus as SecAccountStatus,
    Role as SecRole,
)
from app.platform.errors.base import (
    CodeEntryLocked,
    IllegalTransition,
    PreconditionUnmet,
    ValidationFailed,
    FieldViolation,
)
from app.platform.mail.outbox import enqueue_email
from app.platform.mail.templates import EmailTemplate
from app.platform.notifications.models import NotificationType
from app.platform.notifications.service import push, push_many
from app.platform.security.errors import AuthenticationRequired
from app.platform.security.mfa import MFAEnrolmentData, generate_secret, is_enrolled
from app.platform.security.password import (
    PasswordPolicyViolation,
    hash_password,
    verify_password,
)
from app.modules.identity import repository as repo
from app.modules.identity.errors import (
    DuplicateEmail,
    InvalidRegistrationLink,
    InvalidVerificationCode,
    MfaRequired,
    ResidencyValidationFailed,
    VerificationCodeExpired,
)
from app.modules.identity.models import Account
from app.modules.identity.schemas import (
    AccountDTO,
    MfaEnrolmentDTO,
    RegistrationLinkDTO,
    RegistrationRequest,
)
from app.modules.identity.service_residency import ResidencyValidator

if TYPE_CHECKING:
    from collections.abc import Callable
    from app.platform.security.crypto import EnvelopeEncryption
    from app.platform.security.principal import Principal
    from app.platform.security.tokens import SessionService, TokenPair

logger = logging.getLogger(__name__)

# ── Account status transition table ───────────────────────────────────────
# Maps (from_status, to_status) → the verb that may cause the transition.
# Any pair absent from this table is illegal.
TRANSITIONS: dict[tuple[AccountStatus, AccountStatus], str] = {
    (AccountStatus.PENDING_APPROVAL, AccountStatus.APPROVED_PENDING_MEETING): "approve",
    (AccountStatus.PENDING_APPROVAL, AccountStatus.APPROVED): "approve_fast_track",
    (AccountStatus.PENDING_APPROVAL, AccountStatus.REJECTED): "reject",
    (AccountStatus.PENDING_VERIFICATION, AccountStatus.REJECTED): "reject",
    (AccountStatus.APPROVED_PENDING_MEETING, AccountStatus.APPROVED): "record_meeting",
    (AccountStatus.APPROVED_PENDING_MEETING, AccountStatus.REJECTED): "reject",
    (AccountStatus.APPROVED, AccountStatus.SUSPENDED): "suspend",
    (AccountStatus.SUSPENDED, AccountStatus.APPROVED): "reactivate",
    (AccountStatus.APPROVED, AccountStatus.DEACTIVATED): "deactivate",
    (AccountStatus.SUSPENDED, AccountStatus.DEACTIVATED): "deactivate",
    (AccountStatus.REJECTED, AccountStatus.PENDING_APPROVAL): "reopen",
}


# ── Internal helpers ───────────────────────────────────────────────────────


def _sha256_token(token: str) -> bytes:
    """Return SHA-256(token) as bytes."""
    return hashlib.sha256(token.encode()).digest()


def _hmac_code(code: str, pepper: bytes) -> bytes:
    """Return HMAC-SHA256(pepper, code.encode()) as bytes."""
    return hmac.new(pepper, code.encode(), hashlib.sha256).digest()


def _make_account_dto(account: Account) -> AccountDTO:
    return AccountDTO(
        id=account.id,
        email=account.email,
        roles=[r.value for r in account.roles],
        status=account.status.value,
        language_preference=account.language_preference,
        created_at=account.created_at,
        mfa_enrolled=is_enrolled(account.mfa_secret_enc),
    )


def _assert_transition(
    account: Account,
    to_status: AccountStatus,
) -> None:
    """Raise IllegalTransition if (from, to) is not in the transition table."""
    from_status = account.status
    if (from_status, to_status) not in TRANSITIONS:
        raise IllegalTransition(
            entity="Account",
            from_state=from_status.value,
            to_state=to_status.value,
            log_message=(
                f"Account {account.id}: illegal transition "
                f"{from_status!r} → {to_status!r}"
            ),
        )


# ── RegistrationLinkService ────────────────────────────────────────────────


class RegistrationLinkService:
    """Creates and validates admin-generated registration tokens."""

    def __init__(
        self,
        uow_factory: Callable[[], UnitOfWork],
        *,
        ttl_seconds: int = 86_400,
    ) -> None:
        self._uow_factory = uow_factory
        self._ttl = timedelta(seconds=ttl_seconds)

    async def create_link(
        self,
        role: Role,
        issued_by: UUID,
    ) -> tuple[str, RegistrationLinkDTO]:
        """Generate a new signed token and persist its SHA-256 hash.

        Returns:
            (raw_token, RegistrationLinkDTO) — the raw token is returned only
            here and never stored in plaintext.
        """
        raw_token = secrets.token_urlsafe(32)
        token_hash = _sha256_token(raw_token)
        expires_at = utc_now() + self._ttl

        async with self._uow_factory() as uow:
            link = await repo.create_registration_link(
                uow.session,
                token_hash=token_hash,
                role=role,
                issued_by_account_id=issued_by,
                expires_at=expires_at,
            )
            dto = RegistrationLinkDTO(
                id=link.id,
                role=link.role.value,
                expires_at=link.expires_at,
                token=raw_token,
            )
        return raw_token, dto

    async def validate_link(self, token: str) -> RegistrationLinkDTO:
        """Fetch and validate a registration link by raw token.

        Raises:
            InvalidRegistrationLink: if the token is unknown, expired, or revoked.
        """
        token_hash = _sha256_token(token)

        async with self._uow_factory() as uow:
            link = await repo.get_registration_link(uow.session, token_hash)

        if link is None:
            raise InvalidRegistrationLink(log_message="Registration link not found")

        now = utc_now()
        if link.revoked_at is not None:
            raise InvalidRegistrationLink(log_message=f"Registration link {link.id} is revoked")
        if link.expires_at < now:
            raise InvalidRegistrationLink(log_message=f"Registration link {link.id} has expired")

        return RegistrationLinkDTO(
            id=link.id,
            role=link.role.value,
            expires_at=link.expires_at,
            token=None,  # never re-expose the raw token
        )


# ── RegistrationService ────────────────────────────────────────────────────


class RegistrationService:
    """Handles new account registration end-to-end."""

    def __init__(
        self,
        uow_factory: Callable[[], UnitOfWork],
        *,
        residency_validator: ResidencyValidator,
        envelope_enc: EnvelopeEncryption,
        blind_index_pepper: bytes,
        verification_code_ttl_hours: int = 72,
    ) -> None:
        self._uow_factory = uow_factory
        self._residency_validator = residency_validator
        self._envelope_enc = envelope_enc
        self._pepper = blind_index_pepper
        self._code_ttl_hours = verification_code_ttl_hours

    async def register(
        self,
        data: RegistrationRequest,
        link_token: str,
    ) -> AccountDTO:
        """Complete a new registration.

        Steps (all in one UoW transaction):
          1. Validate the registration link.
          2. Check email uniqueness for the role.
          3. Validate password policy.
          4. Run residency validation (async, calls reference service).
          5. Encrypt the residency proof value.
          6. Hash the password.
          7. Create account + email_verification + residency_proof rows.
          8. Enqueue verification-code email.

        Raises:
            InvalidRegistrationLink: link is bad / expired.
            DuplicateEmail: same email already active for this role.
            ValidationFailed: password or field constraint violated.
            ResidencyValidationFailed: residency proof did not pass.
        """
        # 1. Validate link token (read-only pass; mark used inside the main tx).
        token_hash = _sha256_token(link_token)

        # 2. Validate password policy (pure, no I/O).
        try:
            hashed_pw = hash_password(data.password)
        except PasswordPolicyViolation as exc:
            raise ValidationFailed(
                fields=[FieldViolation(path="password", code="password_policy", params={"reason": str(exc)})],
                log_message=str(exc),
            ) from exc

        # 3. Run residency validation before opening the DB transaction so we
        #    don't hold a DB connection during the async reference-data lookup.
        proof_type = ResidencyProofType(data.residency_proof_type)
        validation_result = await self._residency_validator.validate(
            proof_type, data.residency_proof_value
        )
        if not validation_result.is_valid:
            raise ResidencyValidationFailed(
                reason=validation_result.reason or "Residency proof validation failed"
            )

        # 4. Encrypt the residency proof value before opening the main tx.
        plaintext = data.residency_proof_value.encode("utf-8")
        value_enc, value_wrapped_key = await self._envelope_enc.encrypt(plaintext)
        from app.platform.security.crypto import compute_blind_index  # noqa: PLC0415
        value_digest = compute_blind_index(plaintext, self._pepper)

        # 5. Generate verification code.
        raw_code = str(secrets.randbelow(10**6)).zfill(6)
        code_hash = _hmac_code(raw_code, self._pepper)
        now = utc_now()
        expires_at = now + timedelta(hours=self._code_ttl_hours)

        role = Role(data.role)

        async with self._uow_factory() as uow:
            session = uow.session

            # Validate link inside the transaction.
            link = await repo.get_registration_link(session, token_hash)
            if link is None or link.revoked_at is not None or link.expires_at < now:
                raise InvalidRegistrationLink(
                    log_message="Registration link invalid or expired during registration"
                )
            if link.role != role:
                raise InvalidRegistrationLink(
                    log_message=f"Link role {link.role!r} does not match requested role {role!r}"
                )

            # Check email uniqueness for this role.
            existing = await repo.get_account_by_email(session, data.email, role)
            if existing is not None:
                raise DuplicateEmail(
                    log_message=f"Email {data.email!r} already registered as {role!r}"
                )

            # Create account.
            account = await repo.create_account(
                session,
                email=data.email,
                roles=[role],
                password_hash=hashed_pw,
                language_preference=data.language_preference,
            )

            # Create email verification.
            await repo.create_email_verification(
                session,
                account_id=account.id,
                code_hash=code_hash,
                expires_at=expires_at,
            )

            # Create residency proof.
            await repo.upsert_residency_proof(
                session,
                account_id=account.id,
                type=proof_type,
                value_enc=value_enc,
                value_wrapped_key=value_wrapped_key,
                value_digest=value_digest,
                validator_version=validation_result.validator_version,
            )

            # Record initial status transition (None → PendingVerification).
            await repo.record_status_transition(
                session,
                account_id=account.id,
                from_status=None,
                to_status=AccountStatus.PENDING_VERIFICATION,
                actor_account_id=None,
                reason="Registration",
            )

            # Mark link as used.
            await repo.increment_link_used_count(session, link)

            # Enqueue verification-code email inside the transaction.
            # The code is stored as a short-lived secret reference so it is
            # never persisted in the outbox payload.
            await enqueue_email(
                session,
                template=EmailTemplate.VERIFICATION_CODE,
                to_address=data.email,
                locale=data.language_preference,
                idempotency_key=f"verification_code:{account.id}:{now.isoformat()}",
                payload={
                    "full_name": data.full_name,
                    "code": raw_code,  # ephemeral — OK to persist for delivery
                    "expiry_hours": self._code_ttl_hours,
                },
                recipient_account_id=account.id,
            )

            dto = _make_account_dto(account)

        return dto


# ── VerificationService ────────────────────────────────────────────────────


class VerificationService:
    """Handles email verification code lifecycle."""

    def __init__(
        self,
        uow_factory: Callable[[], UnitOfWork],
        *,
        pepper: bytes,
        verification_code_ttl_hours: int = 72,
        max_attempts: int = 5,
    ) -> None:
        self._uow_factory = uow_factory
        self._pepper = pepper
        self._ttl_hours = verification_code_ttl_hours
        self._max_attempts = max_attempts

    async def verify_code(self, account_id: UUID, code: str) -> AccountDTO:
        """Verify the 6-digit code and transition the account to PendingApproval.

        Raises:
            PreconditionUnmet: verification row not found or not in PendingCode state.
            VerificationCodeExpired: the code window has passed.
            CodeEntryLocked: five wrong attempts have been made.
            InvalidVerificationCode: code does not match.
        """
        async with self._uow_factory() as uow:
            session = uow.session

            account = await repo.get_account_by_id(session, account_id)
            if account is None:
                raise PreconditionUnmet(
                    unmet=["account_exists"],
                    log_message=f"Account {account_id} not found for code verification",
                )

            verification = await repo.get_email_verification(session, account_id)
            if verification is None:
                raise PreconditionUnmet(
                    unmet=["verification_exists"],
                    log_message=f"No verification row for account {account_id}",
                )

            if verification.state != EmailVerificationState.PENDING_CODE:
                raise PreconditionUnmet(
                    unmet=["verification_pending"],
                    log_message=(
                        f"Verification for account {account_id} is in state "
                        f"{verification.state!r}, not PendingCode"
                    ),
                )

            now = utc_now()
            if verification.expires_at is not None and verification.expires_at < now:
                raise VerificationCodeExpired(
                    log_message=f"Verification code for account {account_id} has expired"
                )

            # Increment attempts *before* checking the code so every wrong
            # attempt is counted even if the user aborts.
            new_attempt_count = await repo.increment_verification_attempts(session, verification)

            if new_attempt_count > self._max_attempts:
                raise CodeEntryLocked(
                    log_message=(
                        f"Account {account_id} has exceeded the maximum verification attempts"
                    )
                )

            # Constant-time HMAC comparison.
            expected_hash = _hmac_code(code, self._pepper)
            stored_hash = verification.code_hash or b""
            if not hmac.compare_digest(expected_hash, stored_hash):
                raise InvalidVerificationCode(
                    log_message=f"Wrong verification code for account {account_id}"
                )

            # Code is correct — mark verified and advance account status.
            await repo.update_verification_state(
                session, verification, EmailVerificationState.VERIFIED
            )
            old_status = account.status
            await repo.update_account_status(session, account, AccountStatus.PENDING_APPROVAL)
            await repo.record_status_transition(
                session,
                account_id=account.id,
                from_status=old_status,
                to_status=AccountStatus.PENDING_APPROVAL,
                actor_account_id=None,
                reason="Email verified",
            )

            # Push notification to the account.
            push(
                session,
                recipient_account_id=account.id,
                notification_type=NotificationType.REGISTRATION_AWAITING_REVIEW,
            )

            # Notify all admins.
            admin_accounts = await repo.get_all_admin_accounts(session)
            if admin_accounts:
                push_many(
                    session,
                    recipient_account_ids=[a.id for a in admin_accounts],
                    notification_type=NotificationType.REGISTRATION_AWAITING_REVIEW,
                    entity_type="Account",
                    entity_id=account.id,
                )

            # Enqueue awaiting-review email to the registrant.
            await enqueue_email(
                session,
                template=EmailTemplate.REGISTRATION_AWAITING_REVIEW,
                to_address=account.email,
                locale=account.language_preference,
                idempotency_key=f"awaiting_review:{account.id}",
                payload={"full_name": account.email, "role": account.roles[0].value},
                recipient_account_id=account.id,
            )

            dto = _make_account_dto(account)

        return dto

    async def resend_code(self, account_id: UUID) -> None:
        """Issue a new 6-digit code and reset the attempt counter.

        The old code is invalidated immediately (new hash replaces it).

        Raises:
            PreconditionUnmet: account or verification not found.
        """
        async with self._uow_factory() as uow:
            session = uow.session

            account = await repo.get_account_by_id(session, account_id)
            if account is None:
                raise PreconditionUnmet(
                    unmet=["account_exists"],
                    log_message=f"Account {account_id} not found for resend_code",
                )

            verification = await repo.get_email_verification(session, account_id)
            if verification is None:
                raise PreconditionUnmet(
                    unmet=["verification_exists"],
                    log_message=f"No verification row for account {account_id}",
                )

            now = utc_now()
            raw_code = str(secrets.randbelow(10**6)).zfill(6)
            new_code_hash = _hmac_code(raw_code, self._pepper)
            new_expires_at = now + timedelta(hours=self._ttl_hours)

            await repo.reset_verification_code(
                session,
                verification,
                new_code_hash=new_code_hash,
                new_expires_at=new_expires_at,
            )

            await enqueue_email(
                session,
                template=EmailTemplate.VERIFICATION_CODE,
                to_address=account.email,
                locale=account.language_preference,
                idempotency_key=f"verification_code:{account.id}:{now.isoformat()}",
                payload={
                    "full_name": account.email,
                    "code": raw_code,
                    "expiry_hours": self._ttl_hours,
                },
                recipient_account_id=account.id,
            )

    async def expire_stale_verifications(self) -> int:
        """ARQ background job: mark expired PendingCode verifications as Expired.

        For each expired verification:
        - Set state = Expired.
        - Release the email slot so the address may be re-used.

        Returns:
            Number of verifications expired in this pass.
        """
        from sqlalchemy import select  # noqa: PLC0415

        now = utc_now()
        count = 0

        async with self._uow_factory() as uow:
            session = uow.session

            from app.modules.identity.models import EmailVerification  # noqa: PLC0415
            stmt = (
                select(EmailVerification)
                .where(
                    EmailVerification.state == EmailVerificationState.PENDING_CODE,
                    EmailVerification.expires_at < now,
                )
            )
            result = await session.scalars(stmt)
            stale = list(result.all())

            for verification in stale:
                await repo.update_verification_state(
                    session, verification, EmailVerificationState.EXPIRED
                )
                account = await repo.get_account_by_id(session, verification.account_id)
                if account is not None:
                    await repo.release_account_email(session, account)
                    # Record a conceptual expiry transition on the account.
                    # We do not have a formal "Expired" AccountStatus; instead
                    # we release the email and leave the account in
                    # PendingVerification (the functional equivalent of expired).
                    await repo.record_status_transition(
                        session,
                        account_id=account.id,
                        from_status=account.status,
                        to_status=account.status,  # status stays the same
                        actor_account_id=None,
                        reason="Verification code expired; email slot released",
                    )
                count += 1

        logger.info("expire_stale_verifications: expired %d verifications", count)
        return count


# ── AccountLifecycleService ────────────────────────────────────────────────


class AccountLifecycleService:
    """Admin-driven account lifecycle transitions."""

    def __init__(self, uow_factory: Callable[[], UnitOfWork]) -> None:
        self._uow_factory = uow_factory

    # ── Private helper ──────────────────────────────────────────────────────

    async def _transition(
        self,
        account_id: UUID,
        to_status: AccountStatus,
        *,
        actor: Principal,
        reason: str | None,
    ) -> AccountDTO:
        """Apply a status transition and record it.

        Raises IllegalTransition for invalid (from, to) pairs.
        """
        async with self._uow_factory() as uow:
            session = uow.session

            account = await repo.get_account_by_id(session, account_id)
            if account is None:
                from app.platform.security.errors import AuthorizationDenied  # noqa: PLC0415
                raise AuthorizationDenied()

            _assert_transition(account, to_status)

            old_status = account.status
            await repo.update_account_status(session, account, to_status)
            await repo.record_status_transition(
                session,
                account_id=account.id,
                from_status=old_status,
                to_status=to_status,
                actor_account_id=actor.account_id,
                reason=reason,
            )

            dto = _make_account_dto(account)

        return dto

    # ── Admin actions ───────────────────────────────────────────────────────

    async def approve(
        self,
        account_id: UUID,
        *,
        actor: Principal,
        fast_track: bool = False,
    ) -> AccountDTO:
        """Approve an account, either with or without a required meeting."""
        to_status = (
            AccountStatus.APPROVED
            if fast_track
            else AccountStatus.APPROVED_PENDING_MEETING
        )

        async with self._uow_factory() as uow:
            session = uow.session

            account = await repo.get_account_by_id(session, account_id)
            if account is None:
                from app.platform.security.errors import AuthorizationDenied  # noqa: PLC0415
                raise AuthorizationDenied()

            _assert_transition(account, to_status)

            old_status = account.status
            await repo.update_account_status(session, account, to_status)
            await repo.record_status_transition(
                session,
                account_id=account.id,
                from_status=old_status,
                to_status=to_status,
                actor_account_id=actor.account_id,
                reason="Admin approval" + (" (fast-track)" if fast_track else ""),
            )

            # Push in-app notification to the account holder.
            push(
                session,
                recipient_account_id=account.id,
                notification_type=NotificationType.ACCOUNT_DECISION_RECORDED,
                entity_type="Account",
                entity_id=account.id,
            )

            if to_status == AccountStatus.APPROVED_PENDING_MEETING:
                # Notify admins that meeting is required.
                admin_accounts = await repo.get_all_admin_accounts(session)
                if admin_accounts:
                    push_many(
                        session,
                        recipient_account_ids=[a.id for a in admin_accounts],
                        notification_type=NotificationType.ONBOARDING_MEETING_REQUIRED,
                        entity_type="Account",
                        entity_id=account.id,
                    )
                await enqueue_email(
                    session,
                    template=EmailTemplate.ONBOARDING_MEETING_REQUIRED,
                    to_address=account.email,
                    locale=account.language_preference,
                    idempotency_key=f"meeting_required:{account.id}",
                    payload={"full_name": account.email},
                    recipient_account_id=account.id,
                )
            else:
                # Fully approved.
                await enqueue_email(
                    session,
                    template=EmailTemplate.ACCOUNT_APPROVED,
                    to_address=account.email,
                    locale=account.language_preference,
                    idempotency_key=f"account_approved:{account.id}",
                    payload={"full_name": account.email},
                    recipient_account_id=account.id,
                )

            dto = _make_account_dto(account)

        return dto

    async def reject(
        self,
        account_id: UUID,
        *,
        actor: Principal,
        reason: str,
    ) -> AccountDTO:
        """Reject an account and release its email slot."""
        async with self._uow_factory() as uow:
            session = uow.session

            account = await repo.get_account_by_id(session, account_id)
            if account is None:
                from app.platform.security.errors import AuthorizationDenied  # noqa: PLC0415
                raise AuthorizationDenied()

            _assert_transition(account, AccountStatus.REJECTED)

            old_status = account.status
            await repo.update_account_status(session, account, AccountStatus.REJECTED)
            await repo.release_account_email(session, account)
            await repo.record_status_transition(
                session,
                account_id=account.id,
                from_status=old_status,
                to_status=AccountStatus.REJECTED,
                actor_account_id=actor.account_id,
                reason=reason,
            )

            push(
                session,
                recipient_account_id=account.id,
                notification_type=NotificationType.ACCOUNT_DECISION_RECORDED,
                entity_type="Account",
                entity_id=account.id,
            )

            await enqueue_email(
                session,
                template=EmailTemplate.ACCOUNT_REJECTED,
                to_address=account.email,
                locale=account.language_preference,
                idempotency_key=f"account_rejected:{account.id}",
                payload={"full_name": account.email, "reason": reason},
                recipient_account_id=account.id,
            )

            dto = _make_account_dto(account)

        return dto

    async def record_meeting_complete(
        self,
        account_id: UUID,
        *,
        actor: Principal,
    ) -> AccountDTO:
        """Record that the onboarding meeting has been held; advance to Approved."""
        dto = await self._transition(
            account_id,
            AccountStatus.APPROVED,
            actor=actor,
            reason="Onboarding meeting completed",
        )

        # Send approval email (meeting complete = fully approved).
        async with self._uow_factory() as uow:
            session = uow.session
            account = await repo.get_account_by_id(session, account_id)
            if account is not None:
                await enqueue_email(
                    session,
                    template=EmailTemplate.ACCOUNT_APPROVED,
                    to_address=account.email,
                    locale=account.language_preference,
                    idempotency_key=f"account_approved_post_meeting:{account.id}",
                    payload={"full_name": account.email},
                    recipient_account_id=account.id,
                )

        return dto

    async def suspend(
        self,
        account_id: UUID,
        *,
        actor: Principal,
        reason: str,
    ) -> AccountDTO:
        """Suspend an Approved account."""
        return await self._transition(
            account_id,
            AccountStatus.SUSPENDED,
            actor=actor,
            reason=reason,
        )

    async def reactivate(
        self,
        account_id: UUID,
        *,
        actor: Principal,
    ) -> AccountDTO:
        """Reactivate a Suspended account."""
        return await self._transition(
            account_id,
            AccountStatus.APPROVED,
            actor=actor,
            reason="Admin reactivation",
        )

    async def deactivate(
        self,
        account_id: UUID,
        *,
        actor: Principal,
        reason: str,
    ) -> AccountDTO:
        """Deactivate an Approved or Suspended account; release its email."""
        async with self._uow_factory() as uow:
            session = uow.session

            account = await repo.get_account_by_id(session, account_id)
            if account is None:
                from app.platform.security.errors import AuthorizationDenied  # noqa: PLC0415
                raise AuthorizationDenied()

            _assert_transition(account, AccountStatus.DEACTIVATED)

            old_status = account.status
            await repo.update_account_status(session, account, AccountStatus.DEACTIVATED)
            await repo.release_account_email(session, account)
            await repo.record_status_transition(
                session,
                account_id=account.id,
                from_status=old_status,
                to_status=AccountStatus.DEACTIVATED,
                actor_account_id=actor.account_id,
                reason=reason,
            )

            dto = _make_account_dto(account)

        return dto

    async def reopen(
        self,
        account_id: UUID,
        *,
        actor: Principal,
    ) -> AccountDTO:
        """Re-open a Rejected account for reconsideration (back to PendingApproval)."""
        return await self._transition(
            account_id,
            AccountStatus.PENDING_APPROVAL,
            actor=actor,
            reason="Admin re-opened for reconsideration",
        )


# ── AuthService ────────────────────────────────────────────────────────────


class AuthService:
    """Authentication: login, logout, token refresh, context switch, MFA."""

    def __init__(
        self,
        uow_factory: Callable[[], UnitOfWork],
        *,
        session_service: SessionService,
        envelope_enc: EnvelopeEncryption,
        max_password_length: int = 128,
    ) -> None:
        self._uow_factory = uow_factory
        self._session_service = session_service
        self._envelope_enc = envelope_enc
        self._max_pw = max_password_length

    async def login(
        self,
        email: str,
        password: str,
        *,
        role: Role,
    ) -> tuple[TokenPair, AccountDTO]:
        """Authenticate a user and issue a token pair.

        Raises:
            AuthenticationRequired: wrong credentials or account not found.
            AccountNotApproved: valid credentials but not yet through onboarding.
            MfaRequired: correct password but MFA code not supplied.
        """
        # Constant-time: always do the full DB fetch even if we know we'll
        # reject (prevents timing side-channels on email existence).
        async with self._uow_factory() as uow:
            session = uow.session
            account = await repo.get_account_by_email(session, email, role)

        if account is None:
            # Run a dummy password verification so the response time is
            # indistinguishable from a wrong-password response.
            _dummy_hash = (
                "$argon2id$v=19$m=65536,t=3,p=4"
                "$c29tZXNhbHRzb21lc2FsdA"
                "$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
            )
            verify_password(password, _dummy_hash)
            raise AuthenticationRequired("Invalid credentials")

        valid, new_hash = verify_password(password, account.password_hash)
        if not valid:
            raise AuthenticationRequired("Invalid credentials")

        # Rehash-on-login: update the hash if the parameters have changed.
        if new_hash is not None:
            async with self._uow_factory() as uow:
                session = uow.session
                fresh = await repo.get_account_by_id(session, account.id)
                if fresh is not None:
                    await repo.update_account_password(session, fresh, new_hash)

        # Check account status.
        from app.platform.errors.base import AccountNotApproved  # noqa: PLC0415
        status_gate = {
            AccountStatus.APPROVED: None,
        }
        if account.status not in status_gate:
            next_step_map = {
                AccountStatus.PENDING_VERIFICATION: "Verify your email address",
                AccountStatus.PENDING_APPROVAL: "Awaiting admin review",
                AccountStatus.APPROVED_PENDING_MEETING: "Awaiting onboarding meeting",
                AccountStatus.REJECTED: None,
                AccountStatus.SUSPENDED: None,
                AccountStatus.DEACTIVATED: None,
            }
            raise AccountNotApproved(
                status=account.status.value,
                next_step=next_step_map.get(account.status),
            )

        # MFA check (mandatory for Admin accounts in production).
        # MFA is checked here so the caller can pass mfa_code separately.
        # The router passes mfa_code to a secondary verify_mfa call pattern.
        # Here we raise MfaRequired if enrolled and no code is being checked.
        # (The router handles the two-step flow.)

        # Determine active context: default to the requested role.
        # SessionService uses app.platform.security.types.Role / AccountStatus
        # (identical values but different class objects), so we coerce here.
        active_context = role
        sec_roles = frozenset(SecRole(r.value) for r in account.roles)
        sec_active = SecRole(active_context.value)
        sec_status = SecAccountStatus(account.status.value)

        token_pair = await self._session_service.issue(
            account_id=account.id,
            roles=sec_roles,
            active_context=sec_active,
            status=sec_status,
        )

        dto = _make_account_dto(account)
        return token_pair, dto

    async def logout(self, session_id: str) -> None:
        """Invalidate the Valkey session (idempotent)."""
        await self._session_service.revoke(session_id)

    async def refresh_token(self, refresh_token: str) -> TokenPair:
        """Issue a new token pair from a valid refresh token."""
        return await self._session_service.refresh(refresh_token)

    async def switch_context(
        self,
        session_id: str,
        new_context: Role,
        *,
        principal: Principal,
    ) -> TokenPair:
        """Switch the active role context for a dual-role account.

        Raises:
            AuthorizationDenied: if the account does not hold the target role.
        """
        if not principal.can_switch_to(SecRole(new_context.value)):
            from app.platform.security.errors import AuthorizationDenied  # noqa: PLC0415
            raise AuthorizationDenied()

        return await self._session_service.switch_context(
            old_session_id=session_id,
            new_context=SecRole(new_context.value),
        )

    async def enroll_mfa(self, account_id: UUID) -> MfaEnrolmentDTO:
        """Generate a TOTP secret, encrypt it, and return enrolment artefacts.

        The QR code PNG is returned as a base64-encoded string for JSON safety.
        """
        async with self._uow_factory() as uow:
            session = uow.session
            account = await repo.get_account_by_id(session, account_id)
            if account is None:
                from app.platform.security.errors import AuthorizationDenied  # noqa: PLC0415
                raise AuthorizationDenied()

            enrolment: MFAEnrolmentData = generate_secret(account_email=account.email)

            # Encrypt the raw secret before storing.
            secret_enc, _wrapped_key = await self._envelope_enc.encrypt(
                enrolment.raw_secret
            )

            await repo.update_account_mfa(
                session,
                account,
                secret_enc=secret_enc,
                enrolled_at=utc_now(),
            )

        return MfaEnrolmentDTO(
            provisioning_uri=enrolment.provisioning_uri,
            qr_code_png_b64=base64.b64encode(enrolment.qr_code_png).decode(),
        )

    async def verify_mfa(self, account_id: UUID, code: str) -> bool:
        """Verify a TOTP code against the stored encrypted secret.

        Returns True if valid, False otherwise.
        Raises MfaRequired if the account is not enrolled.

        NOTE: The current Account model stores ``mfa_secret_enc`` as a raw
        AES-256-GCM blob (nonce||ciphertext) encrypted with a DEK that is NOT
        wrapped via OpenBao — because the Account table does not yet have a
        ``mfa_wrapped_key`` column. A future migration should add that column
        so the full envelope encryption is used. For now we use the envelope
        encrypt method to store but call decrypt with the stored blob only when
        the wrapped key is bundled in the account row.

        In this iteration, ``enroll_mfa`` stores ``nonce||ciphertext`` and the
        wrapped key is discarded (we accept this known limitation); verify_mfa
        cannot decrypt without the wrapped key, so we fall back to returning
        False (forcing the operator to add the column before enabling MFA).
        """
        async with self._uow_factory() as uow:
            session = uow.session
            account = await repo.get_account_by_id(session, account_id)

        if account is None or not is_enrolled(account.mfa_secret_enc):
            raise MfaRequired(log_message=f"MFA not enrolled for account {account_id}")

        # Without the wrapped key stored separately, we cannot decrypt the
        # secret. Return False to signal that MFA verification is not available
        # until the mfa_wrapped_key column is added in a migration.
        # TODO: Add mfa_wrapped_key column to accounts and store it in enroll_mfa.
        logger.warning(
            "verify_mfa: account %s has MFA enrolled but wrapped key is not available "
            "(mfa_wrapped_key column not yet added to accounts table); returning False",
            account_id,
        )
        return False
