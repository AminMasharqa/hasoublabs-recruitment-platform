"""Applications module: applications, application_status_transitions.

Revision ID: 0007_applications
Revises: 0006_jobs
Create Date: 2026-09-20

Creates:
- applications table with partial unique index (R7 AC7)
- cv_version_id immutability trigger (R7 AC5)
- application_status_transitions table
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007_applications"
down_revision: str | None = "0006_jobs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── applications ─────────────────────────────────────────────────────────
    op.create_table(
        "applications",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("candidate_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("jd_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cv_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(50), nullable=False, server_default="Submitted"),
        sa.Column("routed_channel", sa.String(30), nullable=False),
        sa.Column("submitted_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.Column("created_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_applications"),
        sa.ForeignKeyConstraint(
            ["candidate_id"], ["accounts.id"],
            name="fk_applications_candidate_id_accounts",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["jd_id"], ["job_descriptions.id"],
            name="fk_applications_jd_id_job_descriptions",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["cv_version_id"], ["cv_versions.id"],
            name="fk_applications_cv_version_id_cv_versions",
            ondelete="RESTRICT",
        ),
    )
    op.create_index("idx_applications_candidate_id", "applications", ["candidate_id"])
    op.create_index("idx_applications_jd_id", "applications", ["jd_id"])
    op.create_index("idx_applications_jd_id_status", "applications",
                    ["jd_id", "status"])
    op.create_index("idx_applications_candidate_id_submitted_at",
                    "applications", ["candidate_id", "submitted_at"])

    # R7 AC7: partial unique index — at most one non-terminal app per (candidate, jd)
    op.create_index(
        "uq_applications_candidate_jd_non_terminal",
        "applications",
        ["candidate_id", "jd_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('Submitted', 'Under Review')"),
    )

    # R7 AC5: cv_version_id is immutable after INSERT
    op.execute(
        """
        CREATE OR REPLACE FUNCTION applications_reject_cv_version_change()
        RETURNS TRIGGER AS $$
        BEGIN
            IF NEW.cv_version_id IS DISTINCT FROM OLD.cv_version_id THEN
                RAISE EXCEPTION
                    'applications: cv_version_id is immutable once set';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_applications_cv_version_immutable
        BEFORE UPDATE ON applications
        FOR EACH ROW EXECUTE FUNCTION applications_reject_cv_version_change();
        """
    )

    # ── application_status_transitions ──────────────────────────────────────
    op.create_table(
        "application_status_transitions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("application_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("from_status", sa.String(50), nullable=True),
        sa.Column("to_status", sa.String(50), nullable=False),
        sa.Column("actor_account_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("occurred_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_application_status_transitions"),
        sa.ForeignKeyConstraint(
            ["application_id"], ["applications.id"],
            name="fk_application_status_transitions_application_id_applications",
            ondelete="CASCADE",
        ),
    )
    op.create_index("idx_application_status_transitions_application_id",
                    "application_status_transitions", ["application_id"])


def downgrade() -> None:
    op.drop_index("idx_application_status_transitions_application_id",
                  table_name="application_status_transitions")
    op.drop_table("application_status_transitions")
    op.execute(
        "DROP TRIGGER IF EXISTS trg_applications_cv_version_immutable ON applications"
    )
    op.execute(
        "DROP FUNCTION IF EXISTS applications_reject_cv_version_change()"
    )
    op.drop_index("uq_applications_candidate_jd_non_terminal", table_name="applications")
    op.drop_index("idx_applications_candidate_id_submitted_at", table_name="applications")
    op.drop_index("idx_applications_jd_id_status", table_name="applications")
    op.drop_index("idx_applications_jd_id", table_name="applications")
    op.drop_index("idx_applications_candidate_id", table_name="applications")
    op.drop_table("applications")
