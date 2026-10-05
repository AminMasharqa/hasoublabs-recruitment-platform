"""The seeded Skill_Taxonomy agrees with the resolver's normalizer.

``0011_seed_skill_taxonomy`` writes ``normalized_name`` / ``normalized_alias`` as
literals so the migration does not import application code. The resolver looks
skills up by ``normalize_skill_term(<entered term>)``, so a literal that drifts
from the normalizer is a seeded skill nobody can ever match. No I/O: the migration
module is loaded from its file.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from app.platform.taxonomy.normalization import normalize_skill_term

if TYPE_CHECKING:
    from types import ModuleType

pytestmark = pytest.mark.unit

_MIGRATION = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "0011_seed_skill_taxonomy.py"
)


def _load_seed() -> ModuleType:
    spec = importlib.util.spec_from_file_location("seed_skill_taxonomy", _MIGRATION)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SEED = _load_seed()


@pytest.mark.parametrize(("normalized", "en", "ar", "he"), SEED.SEED_SKILLS)
def test_each_seeded_skill_is_reachable_by_its_english_name(
    normalized: str, en: str, ar: str | None, he: str | None
) -> None:
    assert normalize_skill_term(en) == normalized
    for name in (ar, he):
        assert name is None or name.strip()


def test_seeded_names_and_aliases_are_unique_and_disjoint() -> None:
    names = [normalized for normalized, *_ in SEED.SEED_SKILLS]
    aliases = [alias for alias, _ in SEED.SEED_ALIASES]
    assert len(names) == len(set(names))
    assert len(aliases) == len(set(aliases))
    # An alias equal to a canonical name would shadow nothing and only confuse.
    assert not set(aliases) & set(names)


@pytest.mark.parametrize(("alias", "skill"), SEED.SEED_ALIASES)
def test_each_alias_is_normalized_and_targets_a_seeded_skill(alias: str, skill: str) -> None:
    assert normalize_skill_term(alias) == alias
    assert skill in {normalized for normalized, *_ in SEED.SEED_SKILLS}


@pytest.mark.parametrize("ambiguous", ["C", "C++", "C#"])
def test_ambiguous_c_family_is_not_seeded(ambiguous: str) -> None:
    # All three normalize to "c"; seeding one would resolve the others to it.
    assert normalize_skill_term(ambiguous) == "c"
    assert "c" not in {normalized for normalized, *_ in SEED.SEED_SKILLS}
