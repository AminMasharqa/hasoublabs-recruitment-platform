"""Job collection tables: job_sources, job_collection_runs, job_description_flags.

Revision ID: 0014_job_collection
Revises: 0013_candidate_pending_skills
Create Date: 2026-11-02

Adds the R23 job-collection schema:
- Two new PG enum types: job_source_type, collection_run_status
- job_sources: ATS configuration rows
- job_collection_runs: per-poll audit log
- job_description_flags: jobs that could not be auto-created
- Partial unique index on job_descriptions.external_url (WHERE NOT NULL)
- System account seed row (id = 00000000-0000-0000-0000-000000000001)
  so that auto-collected JDs have a non-NULL creator_account_id FK.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "0014_job_collection"
down_revision: str | None = "0013_candidate_pending_skills"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SYSTEM_ACCOUNT_ID = "00000000-0000-0000-0000-000000000001"


def upgrade() -> None:
    bind = op.get_bind()

    # ── 1. PG enum types ─────────────────────────────────────────────────────
    # Use create_type=False so SQLAlchemy does not auto-CREATE in create_table;
    # we create them explicitly here with checkfirst=True.
    _job_source_type = postgresql.ENUM(
        "greenhouse",
        "lever",
        "ashby",
        "workable",
        "smartrecruiters",
        "recruitee",
        "workday",
        name="job_source_type",
        create_type=False,
    )
    _job_source_type.create(bind, checkfirst=True)

    _collection_run_status = postgresql.ENUM(
        "running",
        "completed",
        "failed",
        name="collection_run_status",
        create_type=False,
    )
    _collection_run_status.create(bind, checkfirst=True)

    # ── 2. job_sources ───────────────────────────────────────────────────────
    op.create_table(
        "job_sources",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column(
            "source_type",
            _job_source_type,
            nullable=False,
        ),
        sa.Column("slug", sa.String(200), nullable=False),
        sa.Column("workday_tenant", sa.String(200), nullable=True),
        sa.Column("workday_site", sa.String(200), nullable=True),
        sa.Column(
            "poll_interval_hours",
            sa.SmallInteger(),
            nullable=False,
            server_default="6",
        ),
        sa.Column(
            "enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "last_polled_at",
            postgresql.TIMESTAMP(timezone=True, precision=3),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True, precision=3),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True, precision=3),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_job_sources"),
        sa.CheckConstraint(
            "poll_interval_hours >= 1",
            name="ck_job_sources_poll_interval_hours",
        ),
        sa.UniqueConstraint("source_type", "slug", name="uq_job_sources_source_type_slug"),
    )

    # ── 3. job_collection_runs ───────────────────────────────────────────────
    op.create_table(
        "job_collection_runs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "started_at",
            postgresql.TIMESTAMP(timezone=True, precision=3),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "finished_at",
            postgresql.TIMESTAMP(timezone=True, precision=3),
            nullable=True,
        ),
        sa.Column(
            "jobs_fetched",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "jobs_created",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "jobs_skipped",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "jobs_flagged",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "status",
            _collection_run_status,
            nullable=False,
            server_default="running",
        ),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_job_collection_runs"),
        sa.ForeignKeyConstraint(
            ["source_id"],
            ["job_sources.id"],
            name="fk_job_collection_runs_source_id_job_sources",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "idx_job_collection_runs_source_id",
        "job_collection_runs",
        ["source_id"],
    )

    # ── 4. job_description_flags ─────────────────────────────────────────────
    op.create_table(
        "job_description_flags",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("resolved_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("external_url", sa.String(500), nullable=False),
        sa.Column("raw_payload", postgresql.JSONB, nullable=False),
        sa.Column(
            "missing_fields",
            postgresql.ARRAY(sa.String()),
            nullable=False,
        ),
        sa.Column(
            "flagged_at",
            postgresql.TIMESTAMP(timezone=True, precision=3),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "resolved_at",
            postgresql.TIMESTAMP(timezone=True, precision=3),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_job_description_flags"),
        sa.ForeignKeyConstraint(
            ["source_id"],
            ["job_sources.id"],
            name="fk_job_description_flags_source_id_job_sources",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["job_collection_runs.id"],
            name="fk_job_description_flags_run_id_job_collection_runs",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["resolved_by"],
            ["accounts.id"],
            name="fk_job_description_flags_resolved_by_accounts",
        ),
    )
    op.create_index(
        "idx_job_description_flags_source_id",
        "job_description_flags",
        ["source_id"],
    )
    op.create_index(
        "idx_job_description_flags_resolved_at",
        "job_description_flags",
        ["resolved_at"],
    )

    # ── 5. Partial unique index on job_descriptions.external_url ────────────
    op.execute(
        "CREATE UNIQUE INDEX idx_job_descriptions_external_url "
        "ON job_descriptions (external_url) "
        "WHERE external_url IS NOT NULL"
    )

    # ── 6. System account seed ───────────────────────────────────────────────
    # A synthetic ADMIN account that owns auto-collected Job_Descriptions.
    # password_hash is set to '!' — a sentinel that no bcrypt hash can match,
    # so this account can never authenticate via password.
    op.execute(
        f"""
        INSERT INTO accounts (id, email, roles, status, password_hash,
                              email_released, language_preference,
                              created_at, updated_at)
        VALUES (
            '{_SYSTEM_ACCOUNT_ID}',
            'system@internal.hasoub.invalid',
            ARRAY['ADMIN']::role[],
            'Approved',
            '!',
            false,
            'ar',
            NOW(),
            NOW()
        )
        ON CONFLICT (id) DO NOTHING
        """
    )


def downgrade() -> None:
    # ── Reverse order of upgrade ─────────────────────────────────────────────

    # 6. Remove system account seed
    op.execute("DELETE FROM accounts WHERE id = '00000000-0000-0000-0000-000000000001'")

    # 5. Drop partial unique index on job_descriptions.external_url
    op.execute("DROP INDEX IF EXISTS idx_job_descriptions_external_url")

    # 4. job_description_flags
    op.drop_index("idx_job_description_flags_resolved_at", table_name="job_description_flags")
    op.drop_index("idx_job_description_flags_source_id", table_name="job_description_flags")
    op.drop_table("job_description_flags")

    # 3. job_collection_runs
    op.drop_index("idx_job_collection_runs_source_id", table_name="job_collection_runs")
    op.drop_table("job_collection_runs")

    # 2. job_sources
    op.drop_table("job_sources")

    # 1. PG enum types
    bind = op.get_bind()
    postgresql.ENUM(name="collection_run_status", create_type=False).drop(bind, checkfirst=True)
    postgresql.ENUM(name="job_source_type", create_type=False).drop(bind, checkfirst=True)
