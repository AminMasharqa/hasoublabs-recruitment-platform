"""Seed C, C++, C# and F#, now that skill keys keep a trailing "+" or "#".

Revision ID: 0012_skill_language_symbols
Revises: 0011_seed_skill_taxonomy
Create Date: 2026-10-09

``normalize_skill_term`` used to strip every symbol, so "C", "C++" and "C#" all
normalized to ``"c"`` and ``0011`` left them out of the taxonomy. It now keeps a
``+`` or ``#`` attached to the end of a word, so the four names get distinct keys
and can be seeded.

Upgrade, in order:

1. **Re-normalize existing rows** whose text carries such a symbol: a skill's
   ``normalized_name`` (from its English name) and an unmatched term's
   ``normalized_term`` (from its raw term). A skill whose new key is already
   taken keeps its old one; that is reported, never merged.
2. **Seed** the four skills and their aliases, idempotently
   (``ON CONFLICT DO NOTHING``), as ``0011`` does.

``_skill_key`` copies the normalizer so the migration does not import
application code; ``tests/unit/test_skill_taxonomy_seed.py`` checks it against
``normalize_skill_term``.

Downgrade removes only seeded skills nothing references. Re-normalized keys are
left as they are: the old keys collided, so they cannot be restored faithfully.
"""

from __future__ import annotations

import json
import unicodedata

from alembic import op
import sqlalchemy as sa

revision: str = "0012_skill_language_symbols"
down_revision: str | None = "0011_seed_skill_taxonomy"
branch_labels: str | None = None
depends_on: str | None = None

#: (normalized_name, en). Language names stay Latin in every locale.
SEED_SKILLS: tuple[tuple[str, str], ...] = (
    ("c", "C"),
    ("c++", "C++"),
    ("c#", "C#"),
    ("f#", "F#"),
)

#: (normalized_alias, normalized_name of the skill it resolves to).
SEED_ALIASES: tuple[tuple[str, str], ...] = (
    ("cpp", "c++"),
    ("c plus plus", "c++"),
    ("csharp", "c#"),
    ("c sharp", "c#"),
    ("fsharp", "f#"),
    ("f sharp", "f#"),
)

_SUFFIXES = frozenset("+#")


def _skill_key(term: str) -> str:
    """A copy of ``normalize_skill_term`` at this revision."""
    folded = unicodedata.normalize("NFKC", term).casefold()
    kept: list[str] = []
    for ch in folded:
        attached = bool(kept) and (kept[-1].isalnum() or kept[-1] in _SUFFIXES)
        if ch in _SUFFIXES and attached:
            kept.append(ch)
        elif unicodedata.category(ch).startswith(("P", "S")):
            kept.append(" ")
        else:
            kept.append(ch)
    return " ".join("".join(kept).split())


def _renormalize(conn: sa.Connection) -> None:
    skills = conn.execute(
        sa.text(
            "SELECT id, name ->> 'en' AS en, normalized_name FROM skills "
            "WHERE name ->> 'en' ~ '[+#]'"
        )
    ).all()
    for row in skills:
        key = _skill_key(row.en or "")
        if not key or key == row.normalized_name:
            continue
        taken = conn.execute(
            sa.text("SELECT 1 FROM skills WHERE normalized_name = :k"), {"k": key}
        ).first()
        if taken:
            print(f"0012: skill {row.id} keeps {row.normalized_name!r}; {key!r} is taken")
            continue
        conn.execute(
            sa.text("UPDATE skills SET normalized_name = :k WHERE id = :id"),
            {"k": key, "id": row.id},
        )

    terms = conn.execute(
        sa.text("SELECT id, raw_term FROM unmatched_skill_terms WHERE raw_term ~ '[+#]'")
    ).all()
    for row in terms:
        conn.execute(
            sa.text("UPDATE unmatched_skill_terms SET normalized_term = :k WHERE id = :id"),
            {"k": _skill_key(row.raw_term), "id": row.id},
        )


def upgrade() -> None:
    conn = op.get_bind()
    _renormalize(conn)

    insert_skill = sa.text(
        "INSERT INTO skills (name, normalized_name) "
        "VALUES (CAST(:name AS jsonb), :normalized) "
        "ON CONFLICT (normalized_name) DO NOTHING"
    )
    for normalized, en in SEED_SKILLS:
        name = {"en": en, "ar": en, "he": en}
        conn.execute(insert_skill, {"name": json.dumps(name), "normalized": normalized})

    insert_alias = sa.text(
        "INSERT INTO skill_aliases (skill_id, normalized_alias) "
        "SELECT id, :alias FROM skills WHERE normalized_name = :skill "
        "ON CONFLICT (normalized_alias) DO NOTHING"
    )
    for alias, skill in SEED_ALIASES:
        conn.execute(insert_alias, {"alias": alias, "skill": skill})


def downgrade() -> None:
    conn = op.get_bind()
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
        {"names": [normalized for normalized, _ in SEED_SKILLS]},
    )
