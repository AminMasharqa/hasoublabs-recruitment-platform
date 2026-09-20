"""Unit tests for the skill taxonomy (Task 7.1).

Two concerns, no I/O:

* :func:`normalize_skill_term` — casing/spacing/punctuation folding, idempotence
  (``normalize(normalize(x)) == normalize(x)``), and trilingual safety (Arabic
  and Hebrew survive unchanged except punctuation/whitespace). Includes a
  property-based idempotence check across arbitrary text.
* :class:`SkillResolver` — exact canonical hit, alias hit, fuzzy-match links +
  flags, and no-match stores-with-null-skill + flags. Driven by an in-memory
  fake repository, so no Postgres / ``pg_trgm`` is needed.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from hypothesis import given
from hypothesis import strategies as st
import pytest

from app.platform.taxonomy.errors import EmptySkillTerm
from app.platform.taxonomy.models import Skill, SkillAlias, UnmatchedSkillTerm
from app.platform.taxonomy.normalization import normalize_skill_term
from app.platform.taxonomy.repository import FuzzyCandidate
from app.platform.taxonomy.resolver import (
    DEFAULT_CONFIDENCE_THRESHOLD,
    SkillResolutionOutcome,
    SkillResolver,
)

pytestmark = pytest.mark.unit


# ── normalize_skill_term ──────────────────────────────────────────────────────


def test_normalize_lowercases_and_trims() -> None:
    assert normalize_skill_term("  React  ") == "react"


def test_normalize_collapses_internal_whitespace() -> None:
    assert normalize_skill_term("machine   learning") == "machine learning"


def test_normalize_strips_punctuation_to_space() -> None:
    # "React.js" and "react js" must share a key.
    assert normalize_skill_term("React.js") == normalize_skill_term("react js")


def test_normalize_folds_case_across_ascii() -> None:
    assert normalize_skill_term("PYTHON") == normalize_skill_term("python")


def test_normalize_nfkc_folds_compatibility_forms() -> None:
    # Full-width "React" (NFKC) folds to ASCII "react".
    fullwidth = "\uff32\uff45\uff41\uff43\uff54"  # Ｒｅａｃｔ
    assert normalize_skill_term(fullwidth) == "react"


def test_normalize_all_punctuation_yields_empty_string() -> None:
    assert normalize_skill_term("!!!") == ""
    assert normalize_skill_term("   ") == ""


def test_normalize_is_idempotent_examples() -> None:
    for term in ["  React.js ", "MACHINE   learning", "C++", "Node.js/Express"]:
        once = normalize_skill_term(term)
        assert normalize_skill_term(once) == once


# ── trilingual safety: Arabic / Hebrew letters must not be stripped or changed ─


def test_normalize_preserves_arabic_letters() -> None:
    # Arabic for "programming" — no case, must survive intact.
    arabic = "برمجة"
    assert normalize_skill_term(arabic) == arabic


def test_normalize_preserves_hebrew_letters() -> None:
    # Hebrew for "software" — no case, must survive intact.
    hebrew = "תוכנה"
    assert normalize_skill_term(hebrew) == hebrew


def test_normalize_arabic_only_trims_whitespace_and_punctuation() -> None:
    assert normalize_skill_term("  برمجة.  ") == "برمجة"


def test_normalize_hebrew_only_trims_whitespace_and_punctuation() -> None:
    assert normalize_skill_term("  תוכנה!  ") == "תוכנה"


def test_normalize_preserves_arabic_combining_marks() -> None:
    # A word carrying Arabic diacritics (combining marks, category Mn) must keep
    # them — marks are never stripped.
    with_marks = "بَرْمَجَة"
    assert normalize_skill_term(with_marks) == with_marks


@given(st.text())
def test_normalize_is_idempotent_property(term: str) -> None:
    """**Property 21 (normalization portion): normalization is idempotent.**

    Validates: Requirements 4.2, 4.3
    """
    once = normalize_skill_term(term)
    assert normalize_skill_term(once) == once


@given(st.text(alphabet="ابتثجحخدذرزسشصضطظعغفقكلمنهوي", min_size=1, max_size=12))
def test_normalize_never_drops_arabic_letters_property(word: str) -> None:
    # With no punctuation/whitespace in the alphabet, every letter must survive.
    assert normalize_skill_term(word) == word


# ── SkillResolver against a fake repository ───────────────────────────────────


@dataclass
class FakeSkillRepository:
    """In-memory :class:`SkillRepositoryProtocol` — no DB, keyed by normalized form."""

    skills_by_norm: dict[str, Skill] = field(default_factory=dict)
    aliases_by_norm: dict[str, SkillAlias] = field(default_factory=dict)
    fuzzy: list[FuzzyCandidate] = field(default_factory=list)
    added: list[UnmatchedSkillTerm] = field(default_factory=list)

    async def find_skill_by_normalized_name(self, normalized: str) -> Skill | None:
        return self.skills_by_norm.get(normalized)

    async def find_alias_by_normalized(self, normalized: str) -> SkillAlias | None:
        return self.aliases_by_norm.get(normalized)

    async def find_fuzzy_candidates(self, normalized: str) -> list[FuzzyCandidate]:
        return list(self.fuzzy)

    def add_unmatched_term(self, term: UnmatchedSkillTerm) -> None:
        self.added.append(term)


def _make_skill(normalized: str) -> Skill:
    skill = Skill(name={"en": normalized}, normalized_name=normalized)
    skill.id = uuid.uuid4()
    return skill


@pytest.mark.asyncio
async def test_resolve_exact_canonical_hit() -> None:
    react = _make_skill("react")
    repo = FakeSkillRepository(skills_by_norm={"react": react})
    resolver = SkillResolver(repo)

    result = await resolver.resolve("  React  ")

    assert result.outcome is SkillResolutionOutcome.CANONICAL
    assert result.is_resolved is True
    assert result.skill_id == react.id
    assert repo.added == []  # exact hits are not stored for review


@pytest.mark.asyncio
async def test_resolve_alias_hit() -> None:
    react = _make_skill("react")
    alias = SkillAlias(skill_id=react.id, normalized_alias="react js")
    repo = FakeSkillRepository(
        skills_by_norm={"react": react},
        aliases_by_norm={"react js": alias},
    )
    resolver = SkillResolver(repo)

    result = await resolver.resolve("React.js")  # normalizes to "react js"

    assert result.outcome is SkillResolutionOutcome.ALIAS
    assert result.is_resolved is True
    assert result.skill_id == react.id
    assert repo.added == []


@pytest.mark.asyncio
async def test_resolve_fuzzy_match_links_and_flags() -> None:
    react = _make_skill("react")
    # "reactt" is one edit from "react" — well above the 85 threshold.
    repo = FakeSkillRepository(
        fuzzy=[FuzzyCandidate(skill_id=react.id, normalized_value="react")],
    )
    resolver = SkillResolver(repo)

    result = await resolver.resolve("Reactt")

    assert result.outcome is SkillResolutionOutcome.FLAGGED_LINKED
    assert result.is_resolved is False  # stored for review, not a taxonomy skill
    assert result.skill_id == react.id
    assert result.confidence is not None
    assert result.confidence >= DEFAULT_CONFIDENCE_THRESHOLD
    # R4 AC3: always stored + flagged.
    assert len(repo.added) == 1
    stored = repo.added[0]
    assert stored.raw_term == "Reactt"
    assert stored.normalized_term == "reactt"
    assert stored.skill_id == react.id
    assert stored.pending_review is True


@pytest.mark.asyncio
async def test_resolve_no_match_stores_with_null_skill_and_flags() -> None:
    # A distant candidate that cannot clear the confidence threshold.
    far = _make_skill("kubernetes")
    repo = FakeSkillRepository(
        fuzzy=[FuzzyCandidate(skill_id=far.id, normalized_value="kubernetes")],
    )
    resolver = SkillResolver(repo)

    result = await resolver.resolve("Quantum Basket Weaving")

    assert result.outcome is SkillResolutionOutcome.FLAGGED_UNLINKED
    assert result.is_resolved is False
    assert result.skill_id is None
    assert result.confidence is None
    assert len(repo.added) == 1
    stored = repo.added[0]
    assert stored.skill_id is None
    assert stored.pending_review is True


@pytest.mark.asyncio
async def test_resolve_no_candidates_at_all_stores_and_flags() -> None:
    repo = FakeSkillRepository()  # empty taxonomy, no fuzzy candidates
    resolver = SkillResolver(repo)

    result = await resolver.resolve("برمجة")  # Arabic term, nothing to match

    assert result.outcome is SkillResolutionOutcome.FLAGGED_UNLINKED
    assert result.skill_id is None
    assert len(repo.added) == 1
    assert repo.added[0].normalized_term == "برمجة"
    assert repo.added[0].pending_review is True


@pytest.mark.asyncio
async def test_resolve_empty_after_normalization_raises() -> None:
    repo = FakeSkillRepository()
    resolver = SkillResolver(repo)

    with pytest.raises(EmptySkillTerm):
        await resolver.resolve("!!!")
    assert repo.added == []  # nothing stored for a non-term


@pytest.mark.asyncio
async def test_resolve_is_total_resolved_or_flagged() -> None:
    """Every non-empty term is either resolved or stored+flagged (Property 21)."""
    react = _make_skill("react")
    repo = FakeSkillRepository(
        skills_by_norm={"react": react},
        fuzzy=[FuzzyCandidate(skill_id=react.id, normalized_value="react")],
    )
    resolver = SkillResolver(repo)

    for term in ["React", "reactt", "totally unrelated skill name"]:
        result = await resolver.resolve(term)
        assert result.is_resolved or result.outcome in {
            SkillResolutionOutcome.FLAGGED_LINKED,
            SkillResolutionOutcome.FLAGGED_UNLINKED,
        }
