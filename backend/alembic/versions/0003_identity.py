"""Identity module: accounts, email_verifications, residency_proofs,
account_status_transitions, registration_links.

Revision ID: 0003_identity
Revises: 0002_audit_foundation
Create Date: 2026-09-20

Creates all 15 shared domain enum types from ``platform/db/enums.py``
(they are all needed here for the first time), then the five identity tables.

Adds a FK from ``outbox_emails.recipient_account_id → accounts.id`` using
``ALTER TABLE … ADD CONSTRAINT … NOT VALID; VALIDATE CONSTRAINT`` so existing
NULL rows in the dev stack are not blocked.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_identity"
down_revision: str | None = "0002_audit_foundation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# ---------------------------------------------------------------------------
# Shared domain enum helpers
# ---------------------------------------------------------------------------

def _create_enum(name: str, *values: str) -> postgresql.ENUM:
    return postgresql.ENUM(*values, name=name, create_type=False)


_ROLE = _create_enum(
    "role", "ADMIN", "CANDIDATE", "SENIOR"
)
_ACCOUNT_STATUS = _create_enum(
    "account_status",
    "PendingVerification",
    "PendingApproval",
    "ApprovedPendingMeeting",
    "Approved",
    "Rejected",
    "Suspended",
    "Deactivated",
)
_EMAIL_VER_STATE = _create_enum(
    "email_verification_state", "PendingCode", "Verified", "Expired"
)
_RESIDENCY_PROOF_TYPE = _create_enum(
    "residency_proof_type", "MobilePhone", "NationalId", "Address"
)
_ENROLMENT_STATUS = _create_enum(
    "enrolment_status", "Enrolled", "Graduated"
)
_PROFILE_STATE = _create_enum(
    "profile_state", "Draft", "Complete"
)
_CONTACT_CHANNEL_PREF = _create_enum(
    "contact_channel_pref", "Chat", "Email", "Both", "None"
)
_CONTACT_SCOPE_PREF = _create_enum(
    "contact_scope_pref", "OwnPostingsOnly", "SameCompany", "FieldOfExpertise"
)
_CV_VERSION_STATE = _create_enum(
    "cv_version_state", "PendingScan", "Available", "Quarantined"
)
_JD_STATUS = _create_enum("jd_status", "Draft", "Open", "Closed")
_WORK_MODEL = _create_enum("work_model", "Onsite", "Hybrid", "Remote")
_EMPLOYMENT_TYPE = _create_enum(
    "employment_type",
    "Full-time",
    "Part-time",
    "Contract",
    "Freelance",
    "Internship",
)
_EXPERIENCE_LEVEL = _create_enum(
    "experience_level", "Junior-level", "Mid-level", "Senior-level", "Lead"
)
_APPLICATION_CHANNEL = _create_enum(
    "application_channel",
    "Senior_Dashboard",
    "Admin_Dashboard",
    "External_Careers_URL",
)
_APPLICATION_STATUS = _create_enum(
    "application_status",
    "Submitted",
    "Under Review",
    "Forwarded to Recruiter",
    "Closed",
)

_ALL_ENUMS = [
    _ROLE,
    _ACCOUNT_STATUS,
    _EMAIL_VER_STATE,
    _RESIDENCY_PROOF_TYPE,
    _ENROLMENT_STATUS,
    _PROFILE_STATE,
    _CONTACT_CHANNEL_PREF,
    _CONTACT_SCOPE_PREF,
    _CV_VERSION_STATE,
    _JD_STATUS,
    _WORK_MODEL,
    _EMPLOYMENT_TYPE,
    _EXPERIENCE_LEVEL,
    _APPLICATION_CHANNEL,
    _APPLICATION_STATUS,
]


def upgrade() -> None:
    bind = op.get_bind()

    # ── Create all 15 shared domain enum types ──────────────────────────────
    for enum in _ALL_ENUMS:
        enum.create(bind, checkfirst=True)

    # ── accounts ────────────────────────────────────────────────────────────
    op.create_table(
        "accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("email_released", sa.Boolean(), nullable=False,
                  server_default=sa.text("false")),
        sa.Column("roles", postgresql.ARRAY(_ROLE), nullable=False),
        sa.Column("status", sa.String(50), nullable=False,
                  server_default="PendingVerification"),
        sa.Column("password_hash", sa.String(1024), nullable=False),
        sa.Column("mfa_secret_enc", sa.LargeBinary(), nullable=True),
        sa.Column("mfa_enrolled_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3), nullable=True),
        sa.Column("language_preference", sa.String(5), nullable=False,
                  server_default="ar"),
        sa.Column("created_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_accounts"),
        sa.CheckConstraint(
            "NOT ('ADMIN' = ANY(roles)) OR cardinality(roles) = 1",
            name="ck_accounts_admin_exclusive",
        ),
    )

    # Case-insensitive partial unique index on email WHERE not released
    op.create_index(
        "uq_accounts_email_lower_unreleased",
        "accounts",
        [sa.text("lower(email)")],
        unique=True,
        postgresql_where=sa.text("email_released = false"),
    )
    op.create_index(
        "idx_accounts_email",
        "accounts",
        ["email"],
    )

    # ── email_verifications ──────────────────────────────────────────────────
    op.create_table(
        "email_verifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("state", sa.String(30), nullable=False,
                  server_default="PendingCode"),
        sa.Column("code_hash", sa.LargeBinary(), nullable=True),
        sa.Column("code_digest", sa.LargeBinary(), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False,
                  server_default=sa.text("0")),
        sa.Column("expires_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3), nullable=True),
        sa.Column("verified_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3), nullable=True),
        sa.Column("issued_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3), nullable=False,
                  server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_email_verifications"),
        sa.ForeignKeyConstraint(
            ["account_id"], ["accounts.id"],
            name="fk_email_verifications_account_id_accounts",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("account_id", name="uq_email_verifications_account_id"),
    )

    # ── residency_proofs ────────────────────────────────────────────────────
    op.create_table(
        "residency_proofs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("type", sa.String(30), nullable=False),
        sa.Column("value_enc", sa.LargeBinary(), nullable=False),
        sa.Column("value_wrapped_key", sa.LargeBinary(), nullable=False),
        sa.Column("value_digest", sa.LargeBinary(), nullable=False),
        sa.Column("validator_version", sa.String(50), nullable=False),
        sa.Column("created_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_residency_proofs"),
        sa.ForeignKeyConstraint(
            ["account_id"], ["accounts.id"],
            name="fk_residency_proofs_account_id_accounts",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("account_id", name="uq_residency_proofs_account_id"),
    )

    # ── account_status_transitions ──────────────────────────────────────────
    op.create_table(
        "account_status_transitions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("from_status", sa.String(50), nullable=True),
        sa.Column("to_status", sa.String(50), nullable=False),
        sa.Column("actor_account_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("occurred_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_account_status_transitions"),
        sa.ForeignKeyConstraint(
            ["account_id"], ["accounts.id"],
            name="fk_account_status_transitions_account_id_accounts",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "idx_account_status_transitions_account_occurred",
        "account_status_transitions",
        ["account_id", "occurred_at"],
    )

    # ── registration_links ──────────────────────────────────────────────────
    op.create_table(
        "registration_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("token_hash", sa.LargeBinary(), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("issued_by_account_id", postgresql.UUID(as_uuid=True),
                  nullable=False),
        sa.Column("expires_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3), nullable=False),
        sa.Column("used_count", sa.Integer(), nullable=False,
                  server_default=sa.text("0")),
        sa.Column("revoked_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3), nullable=True),
        sa.Column("created_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_registration_links"),
        sa.ForeignKeyConstraint(
            ["issued_by_account_id"], ["accounts.id"],
            name="fk_registration_links_issued_by_account_id_accounts",
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint("token_hash", name="uq_registration_links_token_hash"),
    )


def downgrade() -> None:
    op.drop_table("registration_links")
    op.drop_table("account_status_transitions")
    op.drop_table("residency_proofs")
    op.drop_table("email_verifications")
    op.drop_index("uq_accounts_email_lower_unreleased", table_name="accounts")
    op.drop_index("idx_accounts_email", table_name="accounts")
    op.drop_table("accounts")

    bind = op.get_bind()
    for enum in reversed(_ALL_ENUMS):
        enum.drop(bind, checkfirst=True)
