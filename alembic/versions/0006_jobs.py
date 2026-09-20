"""Jobs module: job_descriptions, jd_required_skills, jd_extraction_drafts.

Revision ID: 0006_jobs
Revises: 0005_profiles
Create Date: 2026-09-20

All 15 shared domain enum types were already created in 0003_identity.
This migration creates:
- job_descriptions table (with tsvector search trigger)
- jd_required_skills M2M table
- jd_extraction_drafts (transient; TTL-purged)
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006_jobs"
down_revision: str | None = "0005_profiles"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── job_descriptions ─────────────────────────────────────────────────────
    op.create_table(
        "job_descriptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("creator_account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("company", sa.String(200), nullable=False),
        sa.Column("company_norm", sa.String(200), nullable=False),
        sa.Column("location", sa.String(200), nullable=True),
        sa.Column("work_model", sa.String(20), nullable=True),
        sa.Column("employment_type", sa.String(20), nullable=True),
        sa.Column("experience_level", sa.String(20), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("external_url", sa.String(500), nullable=True),
        sa.Column("status", sa.String(10), nullable=False, server_default="Draft"),
        sa.Column("application_channel", sa.String(30), nullable=True),
        sa.Column("published_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3), nullable=True),
        sa.Column("closed_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3), nullable=True),
        sa.Column("search_tsv", postgresql.TSVECTOR, nullable=True),
        sa.Column("created_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_job_descriptions"),
        sa.ForeignKeyConstraint(
            ["creator_account_id"], ["accounts.id"],
            name="fk_job_descriptions_creator_account_id_accounts",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "description IS NULL OR char_length(description) <= 10000",
            name="ck_job_descriptions_description_max_length",
        ),
    )
    op.create_index("idx_job_descriptions_creator_account_id",
                    "job_descriptions", ["creator_account_id"])
    op.create_index(
        "idx_job_descriptions_status_published_at_id",
        "job_descriptions",
        ["status", sa.text("published_at DESC"), sa.text("id DESC")],
    )
    op.create_index(
        "idx_job_descriptions_search_tsv",
        "job_descriptions",
        ["search_tsv"],
        postgresql_using="gin",
    )

    # ── tsvector trigger ─────────────────────────────────────────────────────
    op.execute(
        """
        CREATE OR REPLACE FUNCTION jd_search_tsv_update()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.search_tsv = to_tsvector(
                'simple',
                coalesce(NEW.title, '') || ' ' ||
                coalesce(NEW.company, '') || ' ' ||
                coalesce(NEW.description, '')
            );
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_jd_search_tsv
        BEFORE INSERT OR UPDATE ON job_descriptions
        FOR EACH ROW EXECUTE FUNCTION jd_search_tsv_update();
        """
    )

    # ── jd_required_skills ───────────────────────────────────────────────────
    op.create_table(
        "jd_required_skills",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("jd_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("skill_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_jd_required_skills"),
        sa.ForeignKeyConstraint(
            ["jd_id"], ["job_descriptions.id"],
            name="fk_jd_required_skills_jd_id_job_descriptions",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["skill_id"], ["skills.id"],
            name="fk_jd_required_skills_skill_id_skills",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("jd_id", "skill_id", name="uq_jd_required_skills_jd_id_skill_id"),
    )
    op.create_index("idx_jd_required_skills_jd_id", "jd_required_skills", ["jd_id"])

    # ── jd_extraction_drafts ─────────────────────────────────────────────────
    op.create_table(
        "jd_extraction_drafts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("creator_account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source", sa.String(10), nullable=False),
        sa.Column("source_url", sa.String(500), nullable=True),
        sa.Column("raw_content", sa.Text(), nullable=True),
        sa.Column("extracted_fields", postgresql.JSONB, nullable=True),
        sa.Column("skill_candidates", postgresql.JSONB, nullable=True),
        sa.Column("created_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.Column("expires_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_jd_extraction_drafts"),
    )
    op.create_index("idx_jd_extraction_drafts_expires_at",
                    "jd_extraction_drafts", ["expires_at"])
    op.create_index("idx_jd_extraction_drafts_creator_account_id",
                    "jd_extraction_drafts", ["creator_account_id"])


def downgrade() -> None:
    op.drop_index("idx_jd_extraction_drafts_creator_account_id",
                  table_name="jd_extraction_drafts")
    op.drop_index("idx_jd_extraction_drafts_expires_at",
                  table_name="jd_extraction_drafts")
    op.drop_table("jd_extraction_drafts")
    op.drop_index("idx_jd_required_skills_jd_id", table_name="jd_required_skills")
    op.drop_table("jd_required_skills")
    op.execute("DROP TRIGGER IF EXISTS trg_jd_search_tsv ON job_descriptions")
    op.execute("DROP FUNCTION IF EXISTS jd_search_tsv_update()")
    op.drop_index("idx_job_descriptions_search_tsv", table_name="job_descriptions")
    op.drop_index("idx_job_descriptions_status_published_at_id",
                  table_name="job_descriptions")
    op.drop_index("idx_job_descriptions_creator_account_id",
                  table_name="job_descriptions")
    op.drop_table("job_descriptions")
