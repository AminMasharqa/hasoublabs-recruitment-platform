"""Skill taxonomy tables: ``skills``, ``skill_aliases``, ``unmatched_skill_terms``.

The Skill_Taxonomy is the platform-maintained canonical list of skills used for
profile entry, job requirements, and (Phase 2) matching (R4 AC2). An entered
term that is not in the taxonomy is stored linked to a normalized term and
flagged for Admin taxonomy review (R4 AC3).

Data model (design: Data Models — "skills / skill_aliases / unmatched_skill_terms"):

* ``skills`` — canonical rows. Per-locale display ``name`` (``ar`` / ``he`` /
  ``en``) in ``JSONB``, plus a ``normalized_name`` used as the exact-lookup key
  (unique).
* ``skill_aliases`` — synonym rows pointing at a canonical ``skill_id``, each
  carrying its own ``normalized_alias`` (unique). This is how "React.js"
  resolves to canonical "React" (design ERD: ``SKILLS ||--o{ SKILL_ALIASES``).
* ``unmatched_skill_terms`` — the raw entered term, its normalized form, a
  nullable link to the canonical skill it was matched to (``skill_id``), and a
  ``pending_review`` flag for the Admin taxonomy-review queue (design ERD:
  ``SKILLS ||--o{ UNMATCHED_SKILL_TERMS : "normalizes to"``).

``pg_trgm`` extension
---------------------
The GIN trigram indexes below power fuzzy candidate search (design: SkillResolver
— "Fuzzy candidates come from ``pg_trgm`` similarity plus ``rapidfuzz`` scoring").
Creating the extension (``CREATE EXTENSION IF NOT EXISTS pg_trgm``) belongs to
Section 2's migration harness, which is not yet merged; the indexes here declare
``postgresql_using="gin"`` with ``gin_trgm_ops`` so they are ready the moment the
extension exists.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, TimestampMixin, UuidPkMixin

__all__ = ["Skill", "SkillAlias", "UnmatchedSkillTerm"]


class Skill(Base, UuidPkMixin, TimestampMixin):
    """A canonical skill in the Skill_Taxonomy (R4 AC2)."""

    __tablename__ = "skills"

    #: Per-locale display names, keyed by locale code (``ar`` / ``he`` / ``en``).
    #: Stored byte-identical — non-Latin names are never transliterated.
    name: Mapped[dict[str, Any]] = mapped_column(nullable=False)

    #: Exact-lookup key: the canonical name reduced by ``normalize_skill_term``.
    #: UNIQUE, so one canonical row owns each normalized form.
    normalized_name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)

    __table_args__ = (
        # Fuzzy candidate search: trigram similarity over the normalized name.
        # Requires the pg_trgm extension (created by Section 2's migrations).
        Index(
            "idx_skills_normalized_name_trgm",
            "normalized_name",
            postgresql_using="gin",
            postgresql_ops={"normalized_name": "gin_trgm_ops"},
        ),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Skill {self.normalized_name!r}>"


class SkillAlias(Base, UuidPkMixin, TimestampMixin):
    """A synonym that resolves to a canonical :class:`Skill` (e.g. "React.js")."""

    __tablename__ = "skill_aliases"

    #: The canonical skill this alias resolves to.
    skill_id: Mapped[UUID] = mapped_column(
        ForeignKey("skills.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    #: The alias reduced by ``normalize_skill_term``. UNIQUE, so one alias maps to
    #: exactly one canonical skill and exact alias lookup is unambiguous.
    normalized_alias: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)

    __table_args__ = (
        # Fuzzy candidate search over aliases (same rationale as skills).
        Index(
            "idx_skill_aliases_normalized_alias_trgm",
            "normalized_alias",
            postgresql_using="gin",
            postgresql_ops={"normalized_alias": "gin_trgm_ops"},
        ),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<SkillAlias {self.normalized_alias!r} -> {self.skill_id}>"


class UnmatchedSkillTerm(Base, UuidPkMixin, TimestampMixin):
    """An entered term stored linked to a normalized form for Admin review (R4 AC3).

    Persisted whenever an entered term does not exactly match a canonical skill
    or alias. ``skill_id`` is the fuzzy-matched canonical skill when a candidate
    cleared the confidence threshold, otherwise ``NULL``. ``pending_review`` is
    always ``True`` on creation — every such term is flagged for Admin taxonomy
    review regardless of whether a fuzzy link was found.
    """

    __tablename__ = "unmatched_skill_terms"

    #: The term exactly as entered, stored byte-identical (no transliteration).
    raw_term: Mapped[str] = mapped_column(Text, nullable=False)

    #: The entered term reduced by ``normalize_skill_term`` — the "normalizes to"
    #: form the row is linked by (design ERD).
    normalized_term: Mapped[str] = mapped_column(String(100), nullable=False)

    #: The fuzzy-matched canonical skill, or ``NULL`` when no candidate cleared
    #: the confidence threshold. Nullable FK.
    skill_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("skills.id", ondelete="SET NULL"),
        default=None,
        index=True,
    )

    #: Admin taxonomy-review flag (R4 AC3). Always set on creation.
    pending_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    __table_args__ = (
        # The Admin review queue: outstanding terms, oldest first.
        Index(
            "idx_unmatched_skill_terms_pending_review",
            "pending_review",
            postgresql_where="pending_review",
        ),
        # Exact/normalized-form lookup and dedup by normalized term.
        Index("idx_unmatched_skill_terms_normalized_term", "normalized_term"),
        # Fuzzy grouping of similar unmatched terms for the review UI.
        Index(
            "idx_unmatched_skill_terms_normalized_term_trgm",
            "normalized_term",
            postgresql_using="gin",
            postgresql_ops={"normalized_term": "gin_trgm_ops"},
        ),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return (
            f"<UnmatchedSkillTerm {self.normalized_term!r} "
            f"skill_id={self.skill_id} pending_review={self.pending_review}>"
        )
