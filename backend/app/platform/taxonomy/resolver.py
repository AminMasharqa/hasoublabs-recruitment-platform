"""The :class:`SkillResolver` — maps an entered term onto the Skill_Taxonomy.

Resolution order (design: SkillResolver; R4 AC2, AC3):

1. **Exact canonical** — normalized term equals a ``skills.normalized_name`` →
   resolved to that canonical skill.
2. **Exact alias** — normalized term equals a ``skill_aliases.normalized_alias``
   → resolved to the alias's canonical skill (e.g. "React.js" → "React").
3. **Fuzzy / flag** — no exact match: pull trigram candidates from the
   repository, re-score with ``rapidfuzz``. If the best candidate clears the
   confidence threshold, link the stored unmatched term to that canonical skill;
   otherwise store it with ``skill_id = NULL``. **Either way** the term is
   persisted with ``pending_review = True`` (R4 AC3 — always stored + flagged).

The outcome is **total**: every normal input is either *resolved* to a canonical
skill or *stored and flagged*; the resolver never raises on a normal term
(Property 21). The one guarded case is a term that normalizes to the empty
string (e.g. ``"!!!"``), which cannot be a skill — see :meth:`SkillResolver.resolve`.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING
from uuid import UUID

from rapidfuzz import fuzz

from app.platform.taxonomy.errors import EmptySkillTerm
from app.platform.taxonomy.models import UnmatchedSkillTerm
from app.platform.taxonomy.normalization import normalize_skill_term

if TYPE_CHECKING:
    from app.platform.taxonomy.repository import SkillRepositoryProtocol

__all__ = [
    "DEFAULT_CONFIDENCE_THRESHOLD",
    "SkillResolution",
    "SkillResolutionOutcome",
    "SkillResolver",
]

#: rapidfuzz score (0–100) a fuzzy candidate must clear to be auto-linked to a
#: stored unmatched term. Below it, the term is stored with no link. A single
#: module constant rather than scattered literals so it is tuned in one place.
DEFAULT_CONFIDENCE_THRESHOLD = 85.0


class SkillResolutionOutcome(StrEnum):
    """Which arm of the resolver produced the result."""

    #: Exact match against a canonical skill's normalized name.
    CANONICAL = "canonical"
    #: Exact match against an alias, resolved to its canonical skill.
    ALIAS = "alias"
    #: No exact match; term stored + flagged, linked to a fuzzy-matched skill.
    FLAGGED_LINKED = "flagged_linked"
    #: No exact match and no confident fuzzy candidate; term stored + flagged
    #: with no canonical link.
    FLAGGED_UNLINKED = "flagged_unlinked"


@dataclass(frozen=True, slots=True)
class SkillResolution:
    """The result of resolving one entered term.

    Attributes:
        outcome: Which arm produced the result.
        normalized_term: The entered term reduced by ``normalize_skill_term``.
        skill_id: The canonical skill this term maps to, or ``None`` when the
            term was flagged with no confident fuzzy candidate.
        is_resolved: ``True`` for an exact canonical/alias hit (the term *is* a
            taxonomy skill); ``False`` when the term was stored for Admin review.
        confidence: The rapidfuzz score of the linked fuzzy candidate, when the
            outcome is ``FLAGGED_LINKED``; otherwise ``None``.
    """

    outcome: SkillResolutionOutcome
    normalized_term: str
    skill_id: UUID | None
    is_resolved: bool
    confidence: float | None = None


class SkillResolver:
    """Resolves entered skill terms against the taxonomy, aliases, then fuzzily.

    The resolver orchestrates; the repository owns all database access, so this
    class is unit-testable against a fake repository with no Postgres.
    """

    def __init__(
        self,
        repository: SkillRepositoryProtocol,
        *,
        confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
    ) -> None:
        self._repo = repository
        self._threshold = confidence_threshold

    async def resolve(self, term: str) -> SkillResolution:
        """Resolve one entered term to a canonical skill, or store and flag it.

        Args:
            term: The raw term as entered by a Candidate, Senior, or extractor.

        Returns:
            A :class:`SkillResolution` describing the outcome. Total for any term
            that normalizes to a non-empty string.

        Raises:
            EmptySkillTerm: If ``term`` normalizes to the empty string (no
                letters, digits, or marks) and therefore cannot denote a skill.
        """
        normalized = normalize_skill_term(term)
        if not normalized:
            raise EmptySkillTerm(term)

        # 1. Exact canonical match.
        skill = await self._repo.find_skill_by_normalized_name(normalized)
        if skill is not None:
            return SkillResolution(
                outcome=SkillResolutionOutcome.CANONICAL,
                normalized_term=normalized,
                skill_id=skill.id,
                is_resolved=True,
            )

        # 2. Exact alias match.
        alias = await self._repo.find_alias_by_normalized(normalized)
        if alias is not None:
            return SkillResolution(
                outcome=SkillResolutionOutcome.ALIAS,
                normalized_term=normalized,
                skill_id=alias.skill_id,
                is_resolved=True,
            )

        # 3. No exact match — fuzzy candidates, then store + flag either way.
        best_id, best_score = await self._best_fuzzy_candidate(normalized)
        linked = best_id is not None and best_score >= self._threshold

        self._repo.add_unmatched_term(
            UnmatchedSkillTerm(
                raw_term=term,
                normalized_term=normalized,
                skill_id=best_id if linked else None,
                pending_review=True,
            )
        )

        if linked:
            return SkillResolution(
                outcome=SkillResolutionOutcome.FLAGGED_LINKED,
                normalized_term=normalized,
                skill_id=best_id,
                is_resolved=False,
                confidence=best_score,
            )
        return SkillResolution(
            outcome=SkillResolutionOutcome.FLAGGED_UNLINKED,
            normalized_term=normalized,
            skill_id=None,
            is_resolved=False,
        )

    async def _best_fuzzy_candidate(self, normalized: str) -> tuple[UUID | None, float]:
        """Return the highest-scoring fuzzy candidate and its rapidfuzz score.

        Trigram candidates come from the repository; each is re-scored against
        ``normalized`` with ``rapidfuzz.fuzz.ratio`` (0–100). Returns
        ``(None, 0.0)`` when there are no candidates.
        """
        candidates = await self._repo.find_fuzzy_candidates(normalized)
        best_id: UUID | None = None
        best_score = 0.0
        for candidate in candidates:
            score = fuzz.ratio(normalized, candidate.normalized_value)
            if score > best_score:
                best_score = score
                best_id = candidate.skill_id
        return best_id, best_score
