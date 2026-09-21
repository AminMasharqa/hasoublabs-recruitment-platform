"""Data access for the skill taxonomy.

The repository is the only place that touches the database, so
:class:`~app.platform.taxonomy.resolver.SkillResolver` can be exercised in unit
tests against an in-memory fake that satisfies :class:`SkillRepositoryProtocol`
without a Postgres/``pg_trgm`` backend.

Fuzzy candidate retrieval uses ``pg_trgm`` similarity over the normalized
columns (design: SkillResolver). Candidates are returned unscored — the
resolver re-scores them with ``rapidfuzz`` and applies the confidence threshold.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol
from uuid import UUID

from sqlalchemy import func, select

from app.platform.taxonomy.models import Skill, SkillAlias, UnmatchedSkillTerm

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

__all__ = [
    "FuzzyCandidate",
    "SkillRepository",
    "SkillRepositoryProtocol",
]

#: How many trigram-nearest candidates to pull for rapidfuzz re-scoring.
_FUZZY_CANDIDATE_LIMIT = 10

#: Minimum pg_trgm similarity for a row to be considered a candidate at all.
#: A coarse pre-filter; the precise decision is rapidfuzz + the resolver's
#: confidence threshold.
_TRGM_SIMILARITY_FLOOR = 0.3


@dataclass(frozen=True, slots=True)
class FuzzyCandidate:
    """A canonical skill proposed as a fuzzy match for an entered term.

    Attributes:
        skill_id: The canonical skill's id.
        normalized_value: The normalized canonical name or alias that matched;
            what the resolver scores the entered term against with rapidfuzz.
    """

    skill_id: UUID
    normalized_value: str


class SkillRepositoryProtocol(Protocol):
    """The data-access surface the resolver depends on.

    Kept narrow so unit tests can supply a fake. All lookups are keyed by an
    already-normalized term (the resolver owns normalization).
    """

    async def find_skill_by_normalized_name(self, normalized: str) -> Skill | None:
        """Return the canonical skill whose ``normalized_name`` equals ``normalized``."""
        ...

    async def find_alias_by_normalized(self, normalized: str) -> SkillAlias | None:
        """Return the alias whose ``normalized_alias`` equals ``normalized``."""
        ...

    async def find_fuzzy_candidates(self, normalized: str) -> list[FuzzyCandidate]:
        """Return canonical-skill candidates near ``normalized`` by trigram similarity."""
        ...

    async def add_unmatched_term(self, term: UnmatchedSkillTerm) -> None:
        """Persist a new unmatched-term row.

        Committed independently of any caller transaction — see
        :class:`SkillRepository` for why.
        """
        ...


class SkillRepository:
    """SQLAlchemy implementation of :class:`SkillRepositoryProtocol`.

    This repository is invoked *outside* of any caller's ``UnitOfWork``:
    ``SkillResolver.resolve`` (and every service that calls it — profiles, jobs)
    deliberately resolves skill terms before opening its own transaction, so
    there is no caller-owned session for this repository to join. It therefore
    owns a sessionmaker, not a session, and opens (and commits/closes) one
    short-lived session per call — a lookup-scoped analogue of ``UnitOfWork``
    for this narrow surface. This also means ``add_unmatched_term`` commits its
    row independently: an unmatched term is not part of the atomicity guarantee
    of whatever profile/job write later uses the resolved skill ids, matching
    the resolver's own contract that a term is stored+flagged unconditionally,
    regardless of what happens afterwards.
    """

    def __init__(self, sessionmaker: async_sessionmaker[AsyncSession]) -> None:
        self._sessionmaker = sessionmaker

    async def find_skill_by_normalized_name(self, normalized: str) -> Skill | None:
        stmt = select(Skill).where(Skill.normalized_name == normalized)
        async with self._sessionmaker() as session:
            return (await session.execute(stmt)).scalar_one_or_none()

    async def find_alias_by_normalized(self, normalized: str) -> SkillAlias | None:
        stmt = select(SkillAlias).where(SkillAlias.normalized_alias == normalized)
        async with self._sessionmaker() as session:
            return (await session.execute(stmt)).scalar_one_or_none()

    async def find_fuzzy_candidates(self, normalized: str) -> list[FuzzyCandidate]:
        """Trigram-nearest canonical skills, via canonical names and aliases.

        Uses ``pg_trgm``'s ``similarity`` to rank; the coarse floor prunes obvious
        non-matches. Results from both the canonical-name and alias paths are
        merged (aliases carry their own ``skill_id``).
        """
        name_sim = func.similarity(Skill.normalized_name, normalized)
        name_stmt = (
            select(Skill.id, Skill.normalized_name, name_sim.label("sim"))
            .where(name_sim >= _TRGM_SIMILARITY_FLOOR)
            .order_by(name_sim.desc())
            .limit(_FUZZY_CANDIDATE_LIMIT)
        )

        alias_sim = func.similarity(SkillAlias.normalized_alias, normalized)
        alias_stmt = (
            select(SkillAlias.skill_id, SkillAlias.normalized_alias, alias_sim.label("sim"))
            .where(alias_sim >= _TRGM_SIMILARITY_FLOOR)
            .order_by(alias_sim.desc())
            .limit(_FUZZY_CANDIDATE_LIMIT)
        )

        candidates: list[FuzzyCandidate] = []
        async with self._sessionmaker() as session:
            for row in (await session.execute(name_stmt)).all():
                candidates.append(FuzzyCandidate(skill_id=row[0], normalized_value=row[1]))
            for row in (await session.execute(alias_stmt)).all():
                candidates.append(FuzzyCandidate(skill_id=row[0], normalized_value=row[1]))
        return candidates

    async def add_unmatched_term(self, term: UnmatchedSkillTerm) -> None:
        async with self._sessionmaker() as session:
            session.add(term)
            await session.commit()
