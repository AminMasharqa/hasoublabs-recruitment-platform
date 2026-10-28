"""Skill taxonomy: skills, skill_aliases, unmatched_skill_terms.

Revision ID: 0004a_skill_taxonomy
Revises: 0004_cvs
Create Date: 2026-09-20

Creates the pg_trgm extension and the three Skill_Taxonomy tables that
0005_profiles and 0006_jobs reference via foreign keys to skills.id
(candidate_skills, senior_expertise_skills, jd_required_skills). Hand-authored
to mirror the ORM models in app/platform/taxonomy/models.py exactly, including
the GIN trigram indexes those models declare in __table_args__.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004a_skill_taxonomy"
down_revision: str | None = "0004_cvs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # pg_trgm powers the GIN trigram indexes below (fuzzy candidate search).
    # Idempotent: safe even if another migration already created it.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # ── skills ───────────────────────────────────────────────────────────────
    op.create_table(
        "skills",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", postgresql.JSONB(), nullable=False),
        sa.Column("normalized_name", sa.String(100), nullable=False),
        sa.Column("created_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_skills"),
        sa.UniqueConstraint("normalized_name", name="uq_skills_normalized_name"),
    )
    op.create_index(
        "idx_skills_normalized_name_trgm",
        "skills",
        ["normalized_name"],
        postgresql_using="gin",
        postgresql_ops={"normalized_name": "gin_trgm_ops"},
    )

    # ── skill_aliases ────────────────────────────────────────────────────────
    op.create_table(
        "skill_aliases",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("skill_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("normalized_alias", sa.String(100), nullable=False),
        sa.Column("created_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_skill_aliases"),
        sa.ForeignKeyConstraint(
            ["skill_id"], ["skills.id"],
            name="fk_skill_aliases_skill_id_skills",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("normalized_alias", name="uq_skill_aliases_normalized_alias"),
    )
    op.create_index("idx_skill_aliases_skill_id", "skill_aliases", ["skill_id"])
    op.create_index(
        "idx_skill_aliases_normalized_alias_trgm",
        "skill_aliases",
        ["normalized_alias"],
        postgresql_using="gin",
        postgresql_ops={"normalized_alias": "gin_trgm_ops"},
    )

    # ── unmatched_skill_terms ────────────────────────────────────────────────
    op.create_table(
        "unmatched_skill_terms",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("raw_term", sa.Text(), nullable=False),
        sa.Column("normalized_term", sa.String(100), nullable=False),
        sa.Column("skill_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("pending_review", sa.Boolean(), nullable=False,
                  server_default=sa.text("true")),
        sa.Column("created_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_unmatched_skill_terms"),
        sa.ForeignKeyConstraint(
            ["skill_id"], ["skills.id"],
            name="fk_unmatched_skill_terms_skill_id_skills",
            ondelete="SET NULL",
        ),
    )
    op.create_index("idx_unmatched_skill_terms_skill_id", "unmatched_skill_terms", ["skill_id"])
    op.create_index(
        "idx_unmatched_skill_terms_pending_review",
        "unmatched_skill_terms",
        ["pending_review"],
        postgresql_where=sa.text("pending_review"),
    )
    op.create_index(
        "idx_unmatched_skill_terms_normalized_term",
        "unmatched_skill_terms",
        ["normalized_term"],
    )
    op.create_index(
        "idx_unmatched_skill_terms_normalized_term_trgm",
        "unmatched_skill_terms",
        ["normalized_term"],
        postgresql_using="gin",
        postgresql_ops={"normalized_term": "gin_trgm_ops"},
    )


def downgrade() -> None:
    op.drop_index("idx_unmatched_skill_terms_normalized_term_trgm",
                  table_name="unmatched_skill_terms")
    op.drop_index("idx_unmatched_skill_terms_normalized_term",
                  table_name="unmatched_skill_terms")
    op.drop_index("idx_unmatched_skill_terms_pending_review",
                  table_name="unmatched_skill_terms")
    op.drop_index("idx_unmatched_skill_terms_skill_id", table_name="unmatched_skill_terms")
    op.drop_table("unmatched_skill_terms")

    op.drop_index("idx_skill_aliases_normalized_alias_trgm", table_name="skill_aliases")
    op.drop_index("idx_skill_aliases_skill_id", table_name="skill_aliases")
    op.drop_table("skill_aliases")

    op.drop_index("idx_skills_normalized_name_trgm", table_name="skills")
    op.drop_table("skills")

    # The pg_trgm extension is intentionally left in place: other parts of the
    # schema may depend on it, and dropping a shared extension in a per-
    # migration downgrade is unsafe.
