"""Reviews module: reviews table (append-only, no UPDATE/DELETE grants).

Revision ID: 0008_reviews
Revises: 0007_applications
Create Date: 2026-09-20

Creates:
- reviews table with rating CHECK constraints, assessment length CHECK,
  per-candidate unique seq, and timeline + reviewer indexes.
- Revokes UPDATE and DELETE on reviews for hasoub_app role (double layer).
- BEFORE UPDATE/DELETE trigger that raises unconditionally (R9 AC3).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008_reviews"
down_revision: str | None = "0007_applications"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reviews",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("candidate_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reviewer_account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("jd_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("rating_technical", sa.Integer(), nullable=False),
        sa.Column("rating_communication", sa.Integer(), nullable=False),
        sa.Column("rating_culture_fit", sa.Integer(), nullable=False),
        sa.Column("rating_overall", sa.Integer(), nullable=False),
        sa.Column("assessment", sa.Text(), nullable=False),
        sa.Column("corrects_review_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at",
                  postgresql.TIMESTAMP(timezone=True, precision=3),
                  nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_reviews"),
        sa.ForeignKeyConstraint(
            ["candidate_id"], ["accounts.id"],
            name="fk_reviews_candidate_id_accounts",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["reviewer_account_id"], ["accounts.id"],
            name="fk_reviews_reviewer_account_id_accounts",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["jd_id"], ["job_descriptions.id"],
            name="fk_reviews_jd_id_job_descriptions",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["corrects_review_id"], ["reviews.id"],
            name="fk_reviews_corrects_review_id_reviews",
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint("candidate_id", "seq",
                            name="uq_reviews_candidate_id_seq"),
        sa.CheckConstraint("rating_technical BETWEEN 1 AND 5",
                           name="ck_reviews_rating_technical_range"),
        sa.CheckConstraint("rating_communication BETWEEN 1 AND 5",
                           name="ck_reviews_rating_communication_range"),
        sa.CheckConstraint("rating_culture_fit BETWEEN 1 AND 5",
                           name="ck_reviews_rating_culture_fit_range"),
        sa.CheckConstraint("rating_overall BETWEEN 1 AND 5",
                           name="ck_reviews_rating_overall_range"),
        sa.CheckConstraint("char_length(assessment) BETWEEN 1 AND 2000",
                           name="ck_reviews_assessment_length"),
    )

    op.create_index("idx_reviews_candidate_id_created_at_seq",
                    "reviews", ["candidate_id", "created_at", "seq"])
    op.create_index("idx_reviews_reviewer_account_id_candidate_id",
                    "reviews", ["reviewer_account_id", "candidate_id"])
    op.create_index("idx_reviews_jd_id", "reviews", ["jd_id"])

    # ── Append-only enforcement (R9 AC3) ─────────────────────────────────────
    op.execute(
        """
        CREATE OR REPLACE FUNCTION reviews_reject_mutation()
        RETURNS TRIGGER AS $$
        BEGIN
            RAISE EXCEPTION
                'reviews: UPDATE and DELETE are not permitted on the reviews table';
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_reviews_no_mutation
        BEFORE UPDATE OR DELETE ON reviews
        FOR EACH ROW EXECUTE FUNCTION reviews_reject_mutation();
        """
    )

    # Grant INSERT + SELECT only for the app role (if it exists)
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hasoub_app') THEN
                REVOKE UPDATE, DELETE ON reviews FROM hasoub_app;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_reviews_no_mutation ON reviews")
    op.execute("DROP FUNCTION IF EXISTS reviews_reject_mutation()")
    op.drop_index("idx_reviews_jd_id", table_name="reviews")
    op.drop_index("idx_reviews_reviewer_account_id_candidate_id", table_name="reviews")
    op.drop_index("idx_reviews_candidate_id_created_at_seq", table_name="reviews")
    op.drop_table("reviews")
