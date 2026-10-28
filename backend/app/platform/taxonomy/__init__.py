"""Skill taxonomy platform sub-package (R4 AC2, AC3).

The canonical Skill_Taxonomy (``skills`` + ``skill_aliases``) plus the
``unmatched_skill_terms`` review queue, and :class:`SkillResolver`, which maps an
entered term onto the taxonomy — exact canonical, then alias, then fuzzy
(``pg_trgm`` + ``rapidfuzz``) — always resolving it or storing and flagging it
for Admin taxonomy review. :func:`normalize_skill_term` is the pure, idempotent,
non-Latin-safe normalization used as the lookup key throughout.

This is a platform sub-package, not a domain module: no ``router.py`` / ``api.py``.
The public surface is this ``__all__``.
"""

from app.platform.taxonomy.errors import EmptySkillTerm
from app.platform.taxonomy.models import Skill, SkillAlias, UnmatchedSkillTerm
from app.platform.taxonomy.normalization import normalize_skill_term, normalize_text
from app.platform.taxonomy.repository import (
    FuzzyCandidate,
    SkillRepository,
    SkillRepositoryProtocol,
)
from app.platform.taxonomy.resolver import (
    DEFAULT_CONFIDENCE_THRESHOLD,
    SkillResolution,
    SkillResolutionOutcome,
    SkillResolver,
)

__all__ = [
    "DEFAULT_CONFIDENCE_THRESHOLD",
    "EmptySkillTerm",
    "FuzzyCandidate",
    "Skill",
    "SkillAlias",
    "SkillRepository",
    "SkillRepositoryProtocol",
    "SkillResolution",
    "SkillResolutionOutcome",
    "SkillResolver",
    "UnmatchedSkillTerm",
    "normalize_skill_term",
    "normalize_text",
]
