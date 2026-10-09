"""C, C++, C# and F# resolve to four different skills (R4 AC2, AC3).

The normalizer used to map all three C names to ``"c"``, so ``0011`` left them
out of the taxonomy and a Candidate entering "C++" was flagged for review.
``0012`` seeds them once the normalizer keeps a trailing ``+``/``#``.

Runs against ``alembic upgrade head`` with the real repository.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from app.platform.taxonomy.repository import SkillRepository
from app.platform.taxonomy.resolver import SkillResolutionOutcome, SkillResolver

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

pytestmark = pytest.mark.integration


async def test_each_c_family_name_resolves_to_its_own_skill(
    pg_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    resolver = SkillResolver(SkillRepository(pg_sessionmaker))

    canonical = {term: await resolver.resolve(term) for term in ("C", "C++", "C#", "F#")}
    assert all(r.outcome is SkillResolutionOutcome.CANONICAL for r in canonical.values())
    assert len({r.skill_id for r in canonical.values()}) == 4

    for alias, name in (("cpp", "C++"), ("C Sharp", "C#"), ("fsharp", "F#")):
        resolved = await resolver.resolve(alias)
        assert resolved.outcome is SkillResolutionOutcome.ALIAS
        assert resolved.skill_id == canonical[name].skill_id
