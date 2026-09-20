"""ORM models for the identity module (R1, R2, Task 11.1).

Tables:
- accounts: core account row with roles array, status, hashed password, MFA
- email_verifications: one row per account, lifecycle from PendingCode→Verified|Expired
- residency_proofs: one row per account, encrypted proof value
- account_status_transitions: append-only log of status changes
- registration_links: admin-generated, role-scoped, signed tokens
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.platform.db.base import Base, TimestampMixin, UuidPkMixin, UtcTimestampMs, utc_now
from app.platform.db.enums import (
    AccountStatus,
    EmailVerificationState,
    ResidencyProofType,
    Role,
    account_status_type,
    email_verification_state_type,
    residency_proof_type_type,
    role_type,
)

if TYPE_CHECKING:
    pass


class Account(Base, UuidPkMixin, TimestampMixin):
    """Core account row. One row per registered user regardless of role."""

    __tablename__ = "accounts"

    email: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
        comment="Stored as-is; uniqueness enforced case-insensitively via partial index",
    )
    # Tracks whether the email slot has been released (after rejection/expiry)
    # so the same address may be reused in a new registration of the same role.
    email_released: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
    )

    # PostgreSQL ARRAY of the native role enum. Most accounts have exactly one
    # role; dual Candidate+Senior is the only valid two-role combination.
    roles: Mapped[list[Role]] = mapped_column(
        ARRAY(role_type),
        nullable=False,
    )

    status: Mapped[AccountStatus] = mapped_column(
        account_status_type,
        nullable=False,
        default=AccountStatus.PENDING_VERIFICATION,
        server_default=AccountStatus.PENDING_VERIFICATION.value,
    )

    # Argon2id hash; never NULL (every account must have a password).
    password_hash: Mapped[str] = mapped_column(String(1024), nullable=False)

    # MFA secret encrypted via AES-256-GCM envelope encryption.
    mfa_secret_enc: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, default=None)
    mfa_enrolled_at: Mapped[datetime | None] = mapped_column(
        UtcTimestampMs, nullable=True, default=None
    )

    language_preference: Mapped[str] = mapped_column(
        String(5), nullable=False, default="ar", server_default="ar"
    )

    # ── Relationships ──────────────────────────────────────────────────────
    email_verification: Mapped[EmailVerification | None] = relationship(
        "EmailVerification",
        back_populates="account",
        uselist=False,
        lazy="raise",
    )
    residency_proof: Mapped[ResidencyProof | None] = relationship(
        "ResidencyProof",
        back_populates="account",
        uselist=False,
        lazy="raise",
    )
    status_transitions: Mapped[list[AccountStatusTransition]] = relationship(
        "AccountStatusTransition",
        back_populates="account",
        lazy="raise",
        order_by="AccountStatusTransition.occurred_at",
    )

    # ── Table-level constraints ────────────────────────────────────────────
    __table_args__ = (
        # ADMIN role must not be combined with CANDIDATE or SENIOR.
        CheckConstraint(
            "NOT ('ADMIN' = ANY(roles)) OR cardinality(roles) = 1",
            name="ck_accounts_admin_exclusive",
        ),
        # Case-insensitive email uniqueness per *unreleased* slot.
        # Two accounts with identical (lowercased) email may coexist only when
        # one has been released (rejected / expired), allowing re-registration.
        Index(
            "uq_accounts_email_lower_unreleased",
            "email",
            unique=True,
            postgresql_where="email_released = false",
            postgresql_ops={"email": "text_pattern_ops"},
        ),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Account id={self.id} email={self.email} status={self.status}>"


class EmailVerification(Base, UuidPkMixin):
    """One verification row per account. Tracks the code lifecycle."""

    __tablename__ = "email_verifications"

    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    state: Mapped[EmailVerificationState] = mapped_column(
        email_verification_state_type,
        nullable=False,
        default=EmailVerificationState.PENDING_CODE,
        server_default=EmailVerificationState.PENDING_CODE.value,
    )

    # HMAC-SHA256 digest of the 6-digit code, computed with the pepper.
    code_hash: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, default=None)

    # Dedup digest (same as code_hash here; separate column reserved for future
    # use, e.g. rate-limiting identical resends).
    code_digest: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, default=None)

    attempt_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    expires_at: Mapped[datetime | None] = mapped_column(UtcTimestampMs, nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(UtcTimestampMs, nullable=True)
    issued_at: Mapped[datetime] = mapped_column(
        UtcTimestampMs, nullable=False, default=utc_now
    )

    # ── Relationship ───────────────────────────────────────────────────────
    account: Mapped[Account] = relationship(
        "Account",
        back_populates="email_verification",
        lazy="raise",
    )

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<EmailVerification account_id={self.account_id} state={self.state}>"
        )


class ResidencyProof(Base, UuidPkMixin, TimestampMixin):
    """One residency proof per account, stored encrypted."""

    __tablename__ = "residency_proofs"

    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    type: Mapped[ResidencyProofType] = mapped_column(
        residency_proof_type_type, nullable=False
    )

    # AES-256-GCM ciphertext: nonce (12 bytes) || ciphertext.
    value_enc: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)

    # OpenBao-wrapped per-record data key.
    value_wrapped_key: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)

    # HMAC-SHA256 blind index for duplicate detection without decryption.
    value_digest: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)

    # The dataset version that validated this proof (for re-validation on
    # reference-data upgrade).
    validator_version: Mapped[str] = mapped_column(String(50), nullable=False)

    # ── Relationship ───────────────────────────────────────────────────────
    account: Mapped[Account] = relationship(
        "Account",
        back_populates="residency_proof",
        lazy="raise",
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<ResidencyProof account_id={self.account_id} type={self.type}>"


class AccountStatusTransition(Base, UuidPkMixin):
    """Append-only log of every account status change."""

    __tablename__ = "account_status_transitions"

    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
    )

    from_status: Mapped[AccountStatus | None] = mapped_column(
        account_status_type, nullable=True
    )

    to_status: Mapped[AccountStatus] = mapped_column(account_status_type, nullable=False)

    # UUID of the admin who triggered the transition; NULL for system-triggered
    # transitions (e.g. automatic expiry).
    actor_account_id: Mapped[UUID | None] = mapped_column(
        # Intentionally NOT a FK – the actor may be deleted after the fact and
        # we never want to lose the audit trail.
        nullable=True,
    )

    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(
        UtcTimestampMs, nullable=False, default=utc_now
    )

    # ── Relationship ───────────────────────────────────────────────────────
    account: Mapped[Account] = relationship(
        "Account",
        back_populates="status_transitions",
        lazy="raise",
    )

    __table_args__ = (
        Index("idx_account_status_transitions_account_occurred", "account_id", "occurred_at"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<AccountStatusTransition account_id={self.account_id} "
            f"{self.from_status}→{self.to_status}>"
        )


class RegistrationLink(Base, UuidPkMixin):
    """Admin-generated, role-scoped, signed registration token."""

    __tablename__ = "registration_links"

    # SHA-256(token) stored; the raw token is only returned at creation time.
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, nullable=False, unique=True)

    role: Mapped[Role] = mapped_column(role_type, nullable=False)

    issued_by_account_id: Mapped[UUID] = mapped_column(
        ForeignKey("accounts.id", ondelete="SET NULL"),
        nullable=False,
    )

    expires_at: Mapped[datetime] = mapped_column(UtcTimestampMs, nullable=False)

    # How many times this link has been used. A link may be single-use or
    # multi-use depending on business requirements; the count is recorded either
    # way for audit.
    used_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    revoked_at: Mapped[datetime | None] = mapped_column(UtcTimestampMs, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        UtcTimestampMs, nullable=False, default=utc_now
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<RegistrationLink id={self.id} role={self.role}>"
