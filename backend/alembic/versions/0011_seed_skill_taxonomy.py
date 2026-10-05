"""Seed a starter Skill_Taxonomy.

Revision ID: 0011_seed_skill_taxonomy
Revises: 0010_enum_column_alignment
Create Date: 2026-10-05

``0004a_skill_taxonomy`` created the taxonomy tables but nothing ever populated
``skills``. With an empty taxonomy every skill a Candidate enters is unmatched:
``SkillResolver`` flags it for Admin review (R4 AC3), the profile keeps no skill,
and so no profile can ever be ``Complete`` (R4 AC6 requires at least one skill).
This seeds a starter set of common skills plus a few well-known aliases. It is a
starting point for Admin curation, not a complete taxonomy.

Display names are per-locale (``ar`` / ``he`` / ``en``). Technology and product
names are kept in their Latin form in every locale, as they are written in
Arabic- and Hebrew-language job ads; only generic terms are translated.

``normalized_name`` / ``normalized_alias`` are written as literals so the
migration does not depend on application code. They must equal
``normalize_skill_term(<en name>)`` — ``tests/unit/test_skill_taxonomy_seed.py``
enforces that.

Deliberately absent: ``C``, ``C++`` and ``C#``. ``normalize_skill_term`` strips
``+`` and ``#``, so all three normalize to ``"c"``; seeding any one of them would
silently resolve the other two to it. They stay unmatched (flagged for review)
until the normalizer can tell them apart.

Upgrade is idempotent (``ON CONFLICT DO NOTHING``), so rows an Admin already
created are left alone. Downgrade removes only seeded skills nothing references.
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa

revision: str = "0011_seed_skill_taxonomy"
down_revision: str | None = "0010_enum_column_alignment"
branch_labels: str | None = None
depends_on: str | None = None

#: (normalized_name, en, ar, he). ar/he default to the en name when ``None``.
SEED_SKILLS: tuple[tuple[str, str, str | None, str | None], ...] = (
    ("python", "Python", None, None),
    ("java", "Java", None, None),
    ("javascript", "JavaScript", None, None),
    ("typescript", "TypeScript", None, None),
    ("go", "Go", None, None),
    ("rust", "Rust", None, None),
    ("kotlin", "Kotlin", None, None),
    ("swift", "Swift", None, None),
    ("php", "PHP", None, None),
    ("ruby", "Ruby", None, None),
    ("scala", "Scala", None, None),
    ("sql", "SQL", None, None),
    ("html", "HTML", None, None),
    ("css", "CSS", None, None),
    ("react", "React", None, None),
    ("angular", "Angular", None, None),
    ("vue js", "Vue.js", None, None),
    ("node js", "Node.js", None, None),
    ("next js", "Next.js", None, None),
    ("django", "Django", None, None),
    ("flask", "Flask", None, None),
    ("fastapi", "FastAPI", None, None),
    ("spring boot", "Spring Boot", None, None),
    ("net", ".NET", None, None),
    ("asp net", "ASP.NET", None, None),
    ("postgresql", "PostgreSQL", None, None),
    ("mysql", "MySQL", None, None),
    ("mongodb", "MongoDB", None, None),
    ("redis", "Redis", None, None),
    ("docker", "Docker", None, None),
    ("kubernetes", "Kubernetes", None, None),
    ("aws", "AWS", None, None),
    ("azure", "Azure", None, None),
    ("google cloud", "Google Cloud", None, None),
    ("git", "Git", None, None),
    ("linux", "Linux", None, None),
    ("terraform", "Terraform", None, None),
    ("graphql", "GraphQL", None, None),
    ("rest apis", "REST APIs", None, None),
    ("machine learning", "Machine Learning", "تعلّم الآلة", "למידת מכונה"),
    ("data analysis", "Data Analysis", "تحليل البيانات", "ניתוח נתונים"),
    ("pandas", "Pandas", None, None),
    ("numpy", "NumPy", None, None),
    ("tensorflow", "TensorFlow", None, None),
    ("pytorch", "PyTorch", None, None),
    ("figma", "Figma", None, None),
    ("agile", "Agile", None, None),
    ("scrum", "Scrum", None, None),
    ("qa automation", "QA Automation", None, None),
    ("selenium", "Selenium", None, None),
    ("playwright", "Playwright", None, None),
    ("cypress", "Cypress", None, None),
    ("excel", "Excel", None, None),
    ("power bi", "Power BI", None, None),
    ("tableau", "Tableau", None, None),
)

#: (normalized_alias, normalized_name of the skill it resolves to)
SEED_ALIASES: tuple[tuple[str, str], ...] = (
    ("js", "javascript"),
    ("ecmascript", "javascript"),
    ("ts", "typescript"),
    ("golang", "go"),
    ("postgres", "postgresql"),
    ("k8s", "kubernetes"),
    ("node", "node js"),
    ("nodejs", "node js"),
    ("vue", "vue js"),
    ("vuejs", "vue js"),
    ("reactjs", "react"),
    ("react js", "react"),
    ("nextjs", "next js"),
    ("gcp", "google cloud"),
    ("amazon web services", "aws"),
    ("ml", "machine learning"),
)


def upgrade() -> None:
    conn = op.get_bind()
    insert_skill = sa.text(
        "INSERT INTO skills (name, normalized_name) "
        "VALUES (CAST(:name AS jsonb), :normalized) "
        "ON CONFLICT (normalized_name) DO NOTHING"
    )
    for normalized, en, ar, he in SEED_SKILLS:
        name = {"en": en, "ar": ar or en, "he": he or en}
        conn.execute(
            insert_skill,
            {"name": json.dumps(name, ensure_ascii=False), "normalized": normalized},
        )

    insert_alias = sa.text(
        "INSERT INTO skill_aliases (skill_id, normalized_alias) "
        "SELECT id, :alias FROM skills WHERE normalized_name = :skill "
        "ON CONFLICT (normalized_alias) DO NOTHING"
    )
    for alias, skill in SEED_ALIASES:
        conn.execute(insert_alias, {"alias": alias, "skill": skill})


def downgrade() -> None:
    conn = op.get_bind()
    seeded = [normalized for normalized, *_ in SEED_SKILLS]
    # Aliases go with their skill (ON DELETE CASCADE). A seeded skill that a
    # profile, a job or a review-queue entry already references is kept, so a
    # downgrade never orphans user data.
    conn.execute(
        sa.text(
            """
            DELETE FROM skills s
            WHERE s.normalized_name = ANY(CAST(:names AS varchar[]))
              AND NOT EXISTS (SELECT 1 FROM candidate_skills c WHERE c.skill_id = s.id)
              AND NOT EXISTS (SELECT 1 FROM senior_expertise_skills e WHERE e.skill_id = s.id)
              AND NOT EXISTS (SELECT 1 FROM jd_required_skills j WHERE j.skill_id = s.id)
              AND NOT EXISTS (SELECT 1 FROM unmatched_skill_terms u WHERE u.skill_id = s.id)
            """
        ),
        {"names": seeded},
    )
