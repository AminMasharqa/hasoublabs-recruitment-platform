"""Profiles module: candidate_profiles, candidate_education, candidate_work_experience,
candidate_skills, candidate_languages, senior_profiles, senior_expertise_skills.

Revision ID: 0005_profiles
Revises: 0004_cvs
Create Date: 2026-09-20

The enum types used here (enrolment_status, profile_state, contact_channel_pref,
contact_scope_pref) were all created in migration 0003_identity.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_profiles"
down_revision: str | None = "0004_cvs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── candidate_profiles ────────────────────────────────────────────────────
    op.create_table(
        "candidate_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("full_name", sa.String(100), nullable=False),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("phone", sa.String(30), nullable=True),
        sa.Column("city", sa.String(100), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("linkedin_url", sa.String(200), nullable=True),
        sa.Column("state", sa.String(20), nullable=False, server_default="Draft"),
        sa.Column("created_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_candidate_profiles"),
        sa.ForeignKeyConstraint(
            ["account_id"], ["accounts.id"],
            name="fk_candidate_profiles_account_id_accounts",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("account_id", name="uq_candidate_profiles_account_id"),
        sa.CheckConstraint(
            "summary IS NULL OR length(summary) <= 1000",
            name="ck_candidate_profiles_summary_len",
        ),
        sa.CheckConstraint(
            "linkedin_url IS NULL OR length(linkedin_url) <= 200",
            name="ck_candidate_profiles_linkedin_url_len",
        ),
    )

    # ── candidate_education ───────────────────────────────────────────────────
    op.create_table(
        "candidate_education",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("profile_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("institution", sa.String(200), nullable=False),
        sa.Column("degree", sa.String(100), nullable=False),
        sa.Column("field_of_study", sa.String(100), nullable=True),
        sa.Column("enrolment_status", sa.String(20), nullable=False),
        sa.Column("start_year", sa.Integer(), nullable=False),
        sa.Column("end_year", sa.Integer(), nullable=True),
        sa.Column("created_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_candidate_education"),
        sa.ForeignKeyConstraint(
            ["account_id"], ["accounts.id"],
            name="fk_candidate_education_account_id_accounts",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id"], ["candidate_profiles.id"],
            name="fk_candidate_education_profile_id_candidate_profiles",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "end_year IS NULL OR end_year >= start_year",
            name="ck_candidate_education_year_order",
        ),
    )
    op.create_index("idx_candidate_education_account_id", "candidate_education", ["account_id"])
    op.create_index("idx_candidate_education_profile_id", "candidate_education", ["profile_id"])

    # ── candidate_work_experience ─────────────────────────────────────────────
    op.create_table(
        "candidate_work_experience",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("profile_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company", sa.String(200), nullable=False),
        sa.Column("title", sa.String(100), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_candidate_work_experience"),
        sa.ForeignKeyConstraint(
            ["account_id"], ["accounts.id"],
            name="fk_candidate_work_experience_account_id_accounts",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id"], ["candidate_profiles.id"],
            name="fk_candidate_work_experience_profile_id_candidate_profiles",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "end_date IS NULL OR end_date >= start_date",
            name="ck_candidate_work_experience_date_order",
        ),
    )
    op.create_index("idx_candidate_work_experience_account_id",
                    "candidate_work_experience", ["account_id"])
    op.create_index("idx_candidate_work_experience_profile_id",
                    "candidate_work_experience", ["profile_id"])

    # ── candidate_skills ───────────────────────────────────────────────────────
    op.create_table(
        "candidate_skills",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("profile_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("skill_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("years_experience", sa.Integer(), nullable=True),
        sa.Column("created_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_candidate_skills"),
        sa.ForeignKeyConstraint(
            ["account_id"], ["accounts.id"],
            name="fk_candidate_skills_account_id_accounts",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id"], ["candidate_profiles.id"],
            name="fk_candidate_skills_profile_id_candidate_profiles",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["skill_id"], ["skills.id"],
            name="fk_candidate_skills_skill_id_skills",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "years_experience IS NULL OR (years_experience >= 0 AND years_experience <= 50)",
            name="ck_candidate_skills_years_experience_range",
        ),
    )
    op.create_index("idx_candidate_skills_account_id", "candidate_skills", ["account_id"])
    op.create_index("idx_candidate_skills_profile_id", "candidate_skills", ["profile_id"])

    # ── candidate_languages ────────────────────────────────────────────────────
    op.create_table(
        "candidate_languages",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("profile_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("language_code", sa.String(10), nullable=False),
        sa.Column("proficiency", sa.String(20), nullable=False),
        sa.Column("created_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_candidate_languages"),
        sa.ForeignKeyConstraint(
            ["account_id"], ["accounts.id"],
            name="fk_candidate_languages_account_id_accounts",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id"], ["candidate_profiles.id"],
            name="fk_candidate_languages_profile_id_candidate_profiles",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "profile_id", "language_code",
            name="uq_candidate_languages_profile_id_language_code",
        ),
    )
    op.create_index("idx_candidate_languages_profile_id", "candidate_languages", ["profile_id"])

    # ── senior_profiles ────────────────────────────────────────────────────────
    op.create_table(
        "senior_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("full_name", sa.String(100), nullable=False),
        sa.Column("company_affiliation", sa.String(200), nullable=True),
        sa.Column("job_title", sa.String(100), nullable=True),
        sa.Column("contact_channel_pref", sa.String(10), nullable=False,
                  server_default="None"),
        sa.Column("contact_scope_pref", sa.String(30), nullable=True),
        sa.Column("created_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_senior_profiles"),
        sa.ForeignKeyConstraint(
            ["account_id"], ["accounts.id"],
            name="fk_senior_profiles_account_id_accounts",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("account_id", name="uq_senior_profiles_account_id"),
        sa.CheckConstraint(
            "contact_channel_pref = 'None' OR contact_scope_pref IS NOT NULL",
            name="ck_senior_profiles_scope_required_when_contactable",
        ),
    )

    # ── senior_expertise_skills ────────────────────────────────────────────────
    op.create_table(
        "senior_expertise_skills",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("skill_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_senior_expertise_skills"),
        sa.ForeignKeyConstraint(
            ["account_id"], ["accounts.id"],
            name="fk_senior_expertise_skills_account_id_accounts",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["skill_id"], ["skills.id"],
            name="fk_senior_expertise_skills_skill_id_skills",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint(
            "account_id", "skill_id",
            name="uq_senior_expertise_skills_account_id_skill_id",
        ),
    )
    op.create_index("idx_senior_expertise_skills_account_id",
                    "senior_expertise_skills", ["account_id"])


def downgrade() -> None:
    op.drop_index("idx_senior_expertise_skills_account_id",
                  table_name="senior_expertise_skills")
    op.drop_table("senior_expertise_skills")
    op.drop_table("senior_profiles")
    op.drop_index("idx_candidate_languages_profile_id",
                  table_name="candidate_languages")
    op.drop_table("candidate_languages")
    op.drop_index("idx_candidate_skills_profile_id", table_name="candidate_skills")
    op.drop_index("idx_candidate_skills_account_id", table_name="candidate_skills")
    op.drop_table("candidate_skills")
    op.drop_index("idx_candidate_work_experience_profile_id",
                  table_name="candidate_work_experience")
    op.drop_index("idx_candidate_work_experience_account_id",
                  table_name="candidate_work_experience")
    op.drop_table("candidate_work_experience")
    op.drop_index("idx_candidate_education_profile_id", table_name="candidate_education")
    op.drop_index("idx_candidate_education_account_id", table_name="candidate_education")
    op.drop_table("candidate_education")
    op.drop_table("candidate_profiles")
