"""The read/lookup surface the ``ResidencyValidator`` consumes.

Task 7.2 ships the *data* and this lookup service; the pass/fail validator
itself is Karim's Task 11.2 in ``app/modules/identity``. The validator calls:

* :meth:`ReferenceDataService.is_valid_mobile_prefix` — is a prefix in the
  active set of the current (or a pinned) dataset version?
* :meth:`ReferenceDataService.resolve_locality` — does a city name (typed in
  ar, he, or en) resolve to a locality within Israel? Normalized lookup.
* :meth:`ReferenceDataService.current_dataset_version` — the version to stamp
  onto ``residency_proofs.validator_version`` when a proof is accepted (O-8).

Locality-name normalization reuses the shared, idempotent, script-safe
:func:`app.platform.taxonomy.normalization.normalize_text` — the same core
transform the skill taxonomy uses — so a city typed in any casing/spacing and in
any of the three scripts resolves, and Arabic/Hebrew letters are never stripped
or transliterated.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.platform.reference.data import DATASET_VERSION
from app.platform.taxonomy.normalization import normalize_text

if TYPE_CHECKING:
    from app.platform.reference.models import IsraeliLocality
    from app.platform.reference.repository import ReferenceDataRepositoryProtocol

__all__ = ["LocalityMatch", "ReferenceDataService"]


@dataclass(frozen=True, slots=True)
class LocalityMatch:
    """A resolved locality, flattened so the validator needs no ORM object.

    Attributes:
        locality_key: Stable cross-locale identity of the place.
        names: The per-locale display names (``ar`` / ``he`` / ``en``).
        matched_locale: Which locale's name the lookup matched on.
        dataset_version: The dataset version the match came from — the value to
            record as ``residency_proofs.validator_version``.
    """

    locality_key: str
    names: dict[str, str]
    matched_locale: str
    dataset_version: str


class ReferenceDataService:
    """Normalized, offline, sub-millisecond lookups over the reference data.

    The service orchestrates and owns normalization; the repository owns all
    database access, so this class is unit-testable against a fake repository
    with no Postgres.
    """

    def __init__(
        self,
        repository: ReferenceDataRepositoryProtocol,
        *,
        dataset_version: str = DATASET_VERSION,
    ) -> None:
        """Create the service.

        Args:
            repository: The reference-data access surface.
            dataset_version: The dataset version this service reads and stamps.
                Defaults to the bundled :data:`DATASET_VERSION`; a caller may pin
                an older version to re-validate against the dataset that
                originally accepted a proof.
        """
        self._repo = repository
        self._version = dataset_version

    def current_dataset_version(self) -> str:
        """Return the dataset version this service reads and stamps onto proofs."""
        return self._version

    async def is_valid_mobile_prefix(
        self, prefix: str, *, version: str | None = None
    ) -> bool:
        """Return whether ``prefix`` is an active Israeli mobile prefix.

        Args:
            prefix: The candidate local mobile prefix, digits only (e.g. ``"050"``).
            version: Dataset version to check against; defaults to this service's
                version.

        Returns:
            ``True`` if a row exists for the prefix in the given version and it is
            active; otherwise ``False``.
        """
        row = await self._repo.find_mobile_prefix(
            prefix, dataset_version=version or self._version
        )
        return row is not None and row.active

    async def resolve_locality(
        self, city_name: str, *, version: str | None = None
    ) -> LocalityMatch | None:
        """Resolve a city name to an Israeli locality via normalized lookup.

        The name may be typed in Arabic, Hebrew, or English and in any casing,
        spacing, or punctuation style; it is reduced by :func:`normalize_text`
        before lookup.

        Args:
            city_name: The city as typed by the user.
            version: Dataset version to resolve against; defaults to this
                service's version.

        Returns:
            A :class:`LocalityMatch` if the normalized name resolves to a
            locality, otherwise ``None``. An empty/punctuation-only name never
            resolves.
        """
        normalized = normalize_text(city_name)
        if not normalized:
            return None
        resolved_version = version or self._version
        locality: IsraeliLocality | None = await self._repo.find_locality_by_normalized_name(
            normalized, dataset_version=resolved_version
        )
        if locality is None:
            return None
        return LocalityMatch(
            locality_key=locality.locality_key,
            names=dict(locality.name),
            matched_locale=locality.locale,
            dataset_version=locality.dataset_version,
        )
