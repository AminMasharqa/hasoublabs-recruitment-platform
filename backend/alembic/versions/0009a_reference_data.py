"""Platform reference data: israeli_localities, israeli_mobile_prefixes.

Revision ID: 0009a_reference_data
Revises: 0009_reporting
Create Date: 2026-09-21

Creates the two bundled, versioned residency-validation reference tables that
app/platform/reference/models.py declares (IsraeliLocality, IsraeliMobilePrefix)
but which had no CREATE-table migration (the models' docstring deferred this to
Section 2's not-yet-merged migration harness). Hand-authored to mirror those ORM
models exactly, including the indexes and unique constraints declared in their
__table_args__, following the style of 0004a_skill_taxonomy.py.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009a_reference_data"
down_revision: str | None = "0009_reporting"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── israeli_localities ───────────────────────────────────────────────────
    op.create_table(
        "israeli_localities",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("locality_key", sa.String(100), nullable=False),
        sa.Column("locale", sa.String(8), nullable=False),
        sa.Column("name", postgresql.JSONB(), nullable=False),
        sa.Column("normalized_name", sa.String(200), nullable=False),
        sa.Column("dataset_version", sa.String(32), nullable=False),
        sa.Column("created_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_israeli_localities"),
        sa.UniqueConstraint(
            "dataset_version", "locale", "normalized_name",
            name="uq_israeli_localities_version_locale_normalized_name",
        ),
    )
    op.create_index(
        "idx_israeli_localities_version_normalized_name",
        "israeli_localities",
        ["dataset_version", "normalized_name"],
    )
    op.create_index(
        "idx_israeli_localities_version_locality_key",
        "israeli_localities",
        ["dataset_version", "locality_key"],
    )

    # ── israeli_mobile_prefixes ──────────────────────────────────────────────
    op.create_table(
        "israeli_mobile_prefixes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("prefix", sa.String(8), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False,
                  server_default=sa.text("true")),
        sa.Column("dataset_version", sa.String(32), nullable=False),
        sa.Column("created_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_israeli_mobile_prefixes"),
        sa.UniqueConstraint(
            "dataset_version", "prefix",
            name="uq_israeli_mobile_prefixes_version_prefix",
        ),
    )
    op.create_index(
        "idx_israeli_mobile_prefixes_version_active",
        "israeli_mobile_prefixes",
        ["dataset_version", "active"],
    )


def downgrade() -> None:
    op.drop_index("idx_israeli_mobile_prefixes_version_active",
                  table_name="israeli_mobile_prefixes")
    op.drop_table("israeli_mobile_prefixes")

    op.drop_index("idx_israeli_localities_version_locality_key",
                  table_name="israeli_localities")
    op.drop_index("idx_israeli_localities_version_normalized_name",
                  table_name="israeli_localities")
    op.drop_table("israeli_localities")
