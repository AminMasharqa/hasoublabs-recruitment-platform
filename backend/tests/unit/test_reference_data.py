"""Unit tests for the residency-validation reference data (Task 7.2).

No I/O — an in-memory fake repository stands in for Postgres. Coverage:

* Trilingual normalized locality resolution: the Arabic, Hebrew, and English
  name of the same city all resolve to that one locality (R2 AC2, O-8).
* Mobile-prefix membership, including the active flag.
* Dataset-version reporting (so the validator can stamp ``validator_version``).
* Loader idempotence: loading twice yields the same row count.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from app.platform.reference.data import (
    DATASET_VERSION,
    ISRAELI_LOCALITIES,
    ISRAELI_MOBILE_PREFIXES,
)
from app.platform.reference.loader import load_reference_data
from app.platform.reference.service import ReferenceDataService
from app.platform.taxonomy.normalization import normalize_text

pytestmark = pytest.mark.unit


# ── In-memory fake repository (mirrors the real unique-key semantics) ─────────


@dataclass
class _FakeLocalityRow:
    locality_key: str
    locale: str
    name: dict[str, str]
    normalized_name: str
    dataset_version: str


@dataclass
class _FakeMobilePrefixRow:
    prefix: str
    active: bool
    dataset_version: str


@dataclass
class FakeReferenceDataRepository:
    """In-memory :class:`ReferenceDataRepositoryProtocol` — no DB.

    Upserts honour the same unique keys as the SQLAlchemy repository:
    ``(dataset_version, locale, normalized_name)`` for localities and
    ``(dataset_version, prefix)`` for prefixes, so loader idempotence is
    faithfully exercised.
    """

    localities: list[_FakeLocalityRow] = field(default_factory=list)
    prefixes: list[_FakeMobilePrefixRow] = field(default_factory=list)

    async def find_locality_by_normalized_name(
        self, normalized: str, *, dataset_version: str
    ) -> _FakeLocalityRow | None:
        for row in self.localities:
            if row.dataset_version == dataset_version and row.normalized_name == normalized:
                return row
        return None

    async def find_mobile_prefix(
        self, prefix: str, *, dataset_version: str
    ) -> _FakeMobilePrefixRow | None:
        for row in self.prefixes:
            if row.dataset_version == dataset_version and row.prefix == prefix:
                return row
        return None

    async def upsert_locality(
        self,
        *,
        locality_key: str,
        locale: str,
        name: dict[str, str],
        normalized_name: str,
        dataset_version: str,
    ) -> bool:
        for row in self.localities:
            if (
                row.dataset_version == dataset_version
                and row.locale == locale
                and row.normalized_name == normalized_name
            ):
                return False
        self.localities.append(
            _FakeLocalityRow(
                locality_key=locality_key,
                locale=locale,
                name=dict(name),
                normalized_name=normalized_name,
                dataset_version=dataset_version,
            )
        )
        return True

    async def upsert_mobile_prefix(
        self, *, prefix: str, active: bool, dataset_version: str
    ) -> bool:
        for row in self.prefixes:
            if row.dataset_version == dataset_version and row.prefix == prefix:
                return False
        self.prefixes.append(
            _FakeMobilePrefixRow(
                prefix=prefix, active=active, dataset_version=dataset_version
            )
        )
        return True


async def _loaded_repo() -> FakeReferenceDataRepository:
    repo = FakeReferenceDataRepository()
    await load_reference_data(repo)
    return repo


# ── Loader ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_loader_inserts_one_row_per_locale_per_locality() -> None:
    repo = await _loaded_repo()
    # Every seed locality ships three locale variants (ar/he/en).
    assert len(repo.localities) == len(ISRAELI_LOCALITIES) * 3
    assert len(repo.prefixes) == len(ISRAELI_MOBILE_PREFIXES)


@pytest.mark.asyncio
async def test_loader_is_idempotent() -> None:
    repo = await _loaded_repo()
    locality_count = len(repo.localities)
    prefix_count = len(repo.prefixes)

    # Second load inserts nothing.
    result = await load_reference_data(repo)

    assert result.localities_inserted == 0
    assert result.mobile_prefixes_inserted == 0
    assert len(repo.localities) == locality_count
    assert len(repo.prefixes) == prefix_count


@pytest.mark.asyncio
async def test_loader_stamps_bundled_dataset_version() -> None:
    repo = await _loaded_repo()
    assert all(row.dataset_version == DATASET_VERSION for row in repo.localities)
    assert all(row.dataset_version == DATASET_VERSION for row in repo.prefixes)


@pytest.mark.asyncio
async def test_loader_first_run_reports_inserts() -> None:
    repo = FakeReferenceDataRepository()
    result = await load_reference_data(repo)
    assert result.localities_inserted == len(ISRAELI_LOCALITIES) * 3
    assert result.mobile_prefixes_inserted == len(ISRAELI_MOBILE_PREFIXES)
    assert result.dataset_version == DATASET_VERSION


# ── Trilingual locality resolution ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_resolve_locality_across_all_three_languages() -> None:
    """Arabic, Hebrew, and English names of one city resolve to that locality."""
    repo = await _loaded_repo()
    service = ReferenceDataService(repo)

    ar = await service.resolve_locality("القدس")
    he = await service.resolve_locality("ירושלים")
    en = await service.resolve_locality("Jerusalem")

    assert ar is not None and he is not None and en is not None
    # All three name variants point at the same place.
    assert ar.locality_key == he.locality_key == en.locality_key == "jerusalem"
    assert ar.matched_locale == "ar"
    assert he.matched_locale == "he"
    assert en.matched_locale == "en"


@pytest.mark.asyncio
async def test_resolve_locality_is_case_and_whitespace_insensitive() -> None:
    repo = await _loaded_repo()
    service = ReferenceDataService(repo)

    spaced = await service.resolve_locality("  haifa  ")
    upper = await service.resolve_locality("HAIFA")

    assert spaced is not None and upper is not None
    assert spaced.locality_key == upper.locality_key == "haifa"


@pytest.mark.asyncio
async def test_resolve_locality_preserves_arabic_display_name() -> None:
    repo = await _loaded_repo()
    service = ReferenceDataService(repo)

    match = await service.resolve_locality("الناصرة")  # Nazareth in Arabic

    assert match is not None
    assert match.locality_key == "nazareth"
    # Display names are stored byte-identical (never transliterated).
    assert match.names["ar"] == "الناصرة"
    assert match.names["he"] == "נצרת"


@pytest.mark.asyncio
async def test_resolve_locality_unknown_city_returns_none() -> None:
    repo = await _loaded_repo()
    service = ReferenceDataService(repo)
    assert await service.resolve_locality("Atlantis") is None


@pytest.mark.asyncio
async def test_resolve_locality_empty_or_punctuation_returns_none() -> None:
    repo = await _loaded_repo()
    service = ReferenceDataService(repo)
    assert await service.resolve_locality("") is None
    assert await service.resolve_locality("   ") is None
    assert await service.resolve_locality("!!!") is None


@pytest.mark.asyncio
async def test_resolve_locality_reports_dataset_version() -> None:
    repo = await _loaded_repo()
    service = ReferenceDataService(repo)
    match = await service.resolve_locality("Tel Aviv-Yafo")
    assert match is not None
    assert match.dataset_version == DATASET_VERSION


# ── Mobile-prefix membership ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_is_valid_mobile_prefix_accepts_seeded_prefixes() -> None:
    repo = await _loaded_repo()
    service = ReferenceDataService(repo)
    for prefix in ("050", "052", "053", "054", "055", "058"):
        assert await service.is_valid_mobile_prefix(prefix) is True


@pytest.mark.asyncio
async def test_is_valid_mobile_prefix_rejects_unknown_prefix() -> None:
    repo = await _loaded_repo()
    service = ReferenceDataService(repo)
    assert await service.is_valid_mobile_prefix("099") is False
    assert await service.is_valid_mobile_prefix("02") is False


@pytest.mark.asyncio
async def test_is_valid_mobile_prefix_rejects_inactive_prefix() -> None:
    repo = FakeReferenceDataRepository()
    await repo.upsert_mobile_prefix(
        prefix="050", active=False, dataset_version=DATASET_VERSION
    )
    service = ReferenceDataService(repo)
    assert await service.is_valid_mobile_prefix("050") is False


# ── Dataset-version reporting & pinning ───────────────────────────────────────


@pytest.mark.asyncio
async def test_current_dataset_version_defaults_to_bundled() -> None:
    service = ReferenceDataService(FakeReferenceDataRepository())
    assert service.current_dataset_version() == DATASET_VERSION


@pytest.mark.asyncio
async def test_service_pins_a_specific_dataset_version() -> None:
    repo = FakeReferenceDataRepository()
    await load_reference_data(repo, dataset_version="v-old")
    service = ReferenceDataService(repo, dataset_version="v-old")

    assert service.current_dataset_version() == "v-old"
    match = await service.resolve_locality("Haifa")
    assert match is not None
    assert match.dataset_version == "v-old"
    # The bundled current version has no rows in this repo, so it resolves None.
    assert await service.resolve_locality("Haifa", version=DATASET_VERSION) is None


# ── Bundled-data sanity ───────────────────────────────────────────────────────


def test_bundled_localities_have_all_three_locales() -> None:
    for _key, names in ISRAELI_LOCALITIES:
        assert set(names.keys()) == {"ar", "he", "en"}
        assert all(names[loc].strip() for loc in ("ar", "he", "en"))


def test_bundled_locality_normalized_names_are_idempotent() -> None:
    for _key, names in ISRAELI_LOCALITIES:
        for display in names.values():
            once = normalize_text(display)
            assert normalize_text(once) == once
