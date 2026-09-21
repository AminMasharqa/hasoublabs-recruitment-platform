"""Add accounts.mfa_wrapped_key for MFA envelope-encryption key custody.

Revision ID: 0009b_mfa_wrapped_key
Revises: 0009a_reference_data
Create Date: 2026-09-21

``AuthService.enroll_mfa`` encrypts the TOTP secret via envelope encryption
(nonce||ciphertext in ``mfa_secret_enc``) but had nowhere to persist the
OpenBao-wrapped per-record data key that decryption needs, so
``AuthService.verify_mfa`` could never actually check a code. This mirrors
``residency_proofs.value_wrapped_key`` onto ``accounts`` so MFA verification
can decrypt the stored secret.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009b_mfa_wrapped_key"
down_revision: str | None = "0009a_reference_data"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "accounts",
        sa.Column("mfa_wrapped_key", sa.LargeBinary(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("accounts", "mfa_wrapped_key")
