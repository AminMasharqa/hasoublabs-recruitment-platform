"""Reporting module: report_exports table.

Revision ID: 0009_reporting
Revises: 0008_reviews
Create Date: 2026-09-20

Creates:
- export_status enum type (pending, running, ready, failed)
- report_exports table for tracking async .xlsx export jobs (R29)
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_reporting"
down_revision: str | None = "0008_reviews"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_EXPORT_STATUS = postgresql.ENUM(
    "pending", "running", "ready", "failed",
    name="export_status",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    _EXPORT_STATUS.create(bind, checkfirst=True)

    op.create_table(
        "report_exports",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("entity_type", sa.String(50), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="pending"),
        sa.Column("filters_json", postgresql.JSONB, nullable=False,
                  server_default=sa.text("'{}'")),
        sa.Column("object_key", sa.String(512), nullable=True),
        sa.Column("download_url", sa.Text(), nullable=True),
        sa.Column("expires_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3), nullable=True),
        sa.Column("requested_by", sa.String(36), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_report_exports"),
    )
    op.create_index("idx_report_exports_requested_by", "report_exports", ["requested_by"])
    op.create_index("idx_report_exports_status", "report_exports", ["status"])


def downgrade() -> None:
    op.drop_index("idx_report_exports_status", table_name="report_exports")
    op.drop_index("idx_report_exports_requested_by", table_name="report_exports")
    op.drop_table("report_exports")
    bind = op.get_bind()
    _EXPORT_STATUS.drop(bind, checkfirst=True)
