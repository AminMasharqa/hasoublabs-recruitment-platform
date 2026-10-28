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


# ── 0012: the C family, seeded once the normalizer could tell them apart ──────

_SYMBOLS_MIGRATION = _MIGRATION.with_name("0012_skill_language_symbols.py")


def _load_symbols_seed() -> ModuleType:
    spec = importlib.util.spec_from_file_location("skill_language_symbols", _SYMBOLS_MIGRATION)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SYMBOLS = _load_symbols_seed()


@pytest.mark.parametrize(("normalized", "en"), SYMBOLS.SEED_SKILLS)
def test_each_c_family_skill_is_reachable_by_its_name(normalized: str, en: str) -> None:
    assert normalize_skill_term(en) == normalized


@pytest.mark.parametrize(("alias", "skill"), SYMBOLS.SEED_ALIASES)
def test_each_c_family_alias_is_normalized_and_resolves_to_a_seeded_skill(
    alias: str, skill: str
) -> None:
    assert normalize_skill_term(alias) == alias
    assert skill in {normalized for normalized, _ in SYMBOLS.SEED_SKILLS}


def test_the_c_family_does_not_collide_with_the_first_seed() -> None:
    first = {normalized for normalized, *_ in SEED.SEED_SKILLS} | {a for a, _ in SEED.SEED_ALIASES}
    second = {n for n, _ in SYMBOLS.SEED_SKILLS} | {a for a, _ in SYMBOLS.SEED_ALIASES}
    assert not first & second


@pytest.mark.parametrize(
    "term", ["C", "C++", "c#", "F#", "C/C++", "React + Redux", "Node.js", "ج++", "a+b", "++"]
)
def test_the_migrations_copy_of_the_normalizer_matches_the_real_one(term: str) -> None:
    assert SYMBOLS._skill_key(term) == normalize_skill_term(term)
