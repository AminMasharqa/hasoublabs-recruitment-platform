"""Keep a skill that is not in the taxonomy on the profile, as pending.

Revision ID: 0013_candidate_pending_skills
Revises: 0012_skill_language_symbols
Create Date: 2026-10-09

R4 AC3 stores a skill that is not in the Skill_Taxonomy as an
``unmatched_skill_terms`` row flagged for Admin review. ``candidate_skills``
could only hold a confirmed ``skill_id``, so the service dropped the term from
the profile. Each row now holds either a confirmed skill or the pending
unmatched term, never both and never neither.

Downgrade deletes pending rows, which a NOT NULL ``skill_id`` cannot hold. Their
unmatched terms stay in the review queue.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0013_candidate_pending_skills"
down_revision: str | None = "0012_skill_language_symbols"
branch_labels: str | None = None
depends_on: str | None = None

_CHECK = "ck_candidate_skills_skill_or_pending_term"


def upgrade() -> None:
    op.add_column(
        "candidate_skills",
        sa.Column("unmatched_term_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_candidate_skills_unmatched_term_id_unmatched_skill_terms",
        "candidate_skills",
        "unmatched_skill_terms",
        ["unmatched_term_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "idx_candidate_skills_unmatched_term_id", "candidate_skills", ["unmatched_term_id"]
    )
    op.alter_column("candidate_skills", "skill_id", nullable=True)
    op.create_check_constraint(
        _CHECK, "candidate_skills", "num_nonnulls(skill_id, unmatched_term_id) = 1"
    )


def downgrade() -> None:
    op.execute("DELETE FROM candidate_skills WHERE skill_id IS NULL")
    op.drop_constraint(_CHECK, "candidate_skills", type_="check")
    op.alter_column("candidate_skills", "skill_id", nullable=False)
    op.drop_index("idx_candidate_skills_unmatched_term_id", table_name="candidate_skills")
    op.drop_constraint(
        "fk_candidate_skills_unmatched_term_id_unmatched_skill_terms",
        "candidate_skills",
        type_="foreignkey",
    )
    op.drop_column("candidate_skills", "unmatched_term_id")
