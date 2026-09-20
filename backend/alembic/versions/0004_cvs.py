"""CVs module: cv_variants and cv_versions tables.

Revision ID: 0004_cvs
Revises: 0003_identity
Create Date: 2026-09-20

Creates the cv_variants and cv_versions tables plus a BEFORE UPDATE trigger
that rejects mutations to immutable CvVersion columns.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_cvs"
down_revision: str | None = "0003_identity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── cv_variants ──────────────────────────────────────────────────────────
    op.create_table(
        "cv_variants",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.String(300), nullable=True),
        sa.Column("is_primary", sa.Boolean(), nullable=False,
                  server_default=sa.text("false")),
        sa.Column("is_archived", sa.Boolean(), nullable=False,
                  server_default=sa.text("false")),
        sa.Column("created_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_cv_variants"),
        sa.ForeignKeyConstraint(
            ["account_id"], ["accounts.id"],
            name="fk_cv_variants_account_id_accounts",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "account_id", "name",
            name="uq_cv_variants_account_id_name",
        ),
    )
    op.create_index("idx_cv_variants_account_id", "cv_variants", ["account_id"])
    op.create_index(
        "idx_cv_variants_account_id_is_primary",
        "cv_variants",
        ["account_id", "is_primary"],
        postgresql_where=sa.text("is_primary = TRUE AND is_archived = FALSE"),
    )

    # ── cv_versions ──────────────────────────────────────────────────────────
    op.create_table(
        "cv_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("variant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("object_key", sa.String(512), nullable=False),
        sa.Column("object_version_id", sa.String(255), nullable=True),
        sa.Column("bucket", sa.String(100), nullable=False),
        sa.Column("sha256_digest", sa.LargeBinary(32), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("state", sa.String(30), nullable=False,
                  server_default="PendingScan"),
        sa.Column("scan_result", sa.Text(), nullable=True),
        sa.Column("scanned_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3), nullable=True),
        sa.Column("created_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_cv_versions"),
        sa.ForeignKeyConstraint(
            ["variant_id"], ["cv_variants.id"],
            name="fk_cv_versions_variant_id_cv_variants",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "variant_id", "version_number",
            name="uq_cv_versions_variant_id_version_number",
        ),
    )
    op.create_index("idx_cv_versions_variant_id", "cv_versions", ["variant_id"])

    # ── Immutability trigger ─────────────────────────────────────────────────
    op.execute(
        """
        CREATE OR REPLACE FUNCTION cv_versions_reject_immutable_update()
        RETURNS TRIGGER AS $$
        BEGIN
            IF (
                NEW.object_key        IS DISTINCT FROM OLD.object_key        OR
                NEW.sha256_digest     IS DISTINCT FROM OLD.sha256_digest     OR
                NEW.size_bytes        IS DISTINCT FROM OLD.size_bytes        OR
                NEW.version_number    IS DISTINCT FROM OLD.version_number    OR
                NEW.variant_id        IS DISTINCT FROM OLD.variant_id
            ) THEN
                RAISE EXCEPTION
                    'cv_versions: immutable columns (object_key, sha256_digest, '
                    'size_bytes, version_number, variant_id) cannot be modified';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_cv_versions_no_immutable_update
        BEFORE UPDATE ON cv_versions
        FOR EACH ROW EXECUTE FUNCTION cv_versions_reject_immutable_update();
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS trg_cv_versions_no_immutable_update ON cv_versions"
    )
    op.execute(
        "DROP FUNCTION IF EXISTS cv_versions_reject_immutable_update()"
    )
    op.drop_index("idx_cv_versions_variant_id", table_name="cv_versions")
    op.drop_table("cv_versions")
    op.drop_index("idx_cv_variants_account_id_is_primary", table_name="cv_variants")
    op.drop_index("idx_cv_variants_account_id", table_name="cv_variants")
    op.drop_table("cv_variants")
