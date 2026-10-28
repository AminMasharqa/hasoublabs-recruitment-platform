"""Idempotent loader for the bundled residency-validation reference data.

Reads the versioned bundled asset (:mod:`app.platform.reference.data`) and
upserts it into ``israeli_localities`` and ``israeli_mobile_prefixes``, stamping
every row with :data:`~app.platform.reference.data.DATASET_VERSION`.

IDEMPOTENCE
-----------
The loader upserts through the repository's insert-if-absent path (keyed by the
tables' unique constraints), so running it twice yields the same rows: the
second run inserts nothing. This makes it safe to run at application startup or
from a migration data step.

ALEMBIC INDEPENDENCE
--------------------
The loader takes a repository (not an Alembic context), so it is decoupled from
the migration harness (Section 2, not yet merged). The CREATE-table migration
for these tables is Section 2's; wiring this loader into a post-migration data
step — or calling it at startup — is a later integration concern. It commits
nothing itself: the caller owns the transaction (Unit of Work), so a partial
load rolls back atomically with everything else in the same transaction.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.platform.reference.data import (
    DATASET_VERSION,
    ISRAELI_LOCALITIES,
    ISRAELI_MOBILE_PREFIXES,
)
from app.platform.taxonomy.normalization import normalize_text

if TYPE_CHECKING:
    from app.platform.reference.repository import ReferenceDataRepositoryProtocol

__all__ = ["ReferenceDataLoadResult", "load_reference_data"]


@dataclass(frozen=True, slots=True)
class ReferenceDataLoadResult:
    """Summary of a load run.

    Attributes:
        dataset_version: The version that was loaded.
        localities_inserted: Locality *rows* inserted this run (one per locale
            per locality; 0 on a repeat run).
        mobile_prefixes_inserted: Prefix rows inserted this run (0 on a repeat).
    """

    dataset_version: str
    localities_inserted: int
    mobile_prefixes_inserted: int


async def load_reference_data(
    repository: ReferenceDataRepositoryProtocol,
    *,
    dataset_version: str = DATASET_VERSION,
) -> ReferenceDataLoadResult:
    """Idempotently load the bundled reference data through ``repository``.

    For each locality, one row is upserted per locale (``ar`` / ``he`` / ``en``),
    each carrying the full per-locale name map and its own normalized name so a
    city typed in any language resolves. Each mobile prefix is upserted active.

    Args:
        repository: The reference-data access surface. Owns insert-if-absent.
        dataset_version: The version to stamp; defaults to the bundled version.

    Returns:
        A :class:`ReferenceDataLoadResult`. Counts reflect rows actually
        inserted, so a second call with the same version returns zeroes.
    """
    localities_inserted = 0
    for locality_key, names in ISRAELI_LOCALITIES:
        full_names = dict(names)
        for locale, display_name in names.items():
            inserted = await repository.upsert_locality(
                locality_key=locality_key,
                locale=locale,
                name=full_names,
                normalized_name=normalize_text(display_name),
                dataset_version=dataset_version,
            )
            if inserted:
                localities_inserted += 1

    prefixes_inserted = 0
    for prefix in ISRAELI_MOBILE_PREFIXES:
        inserted = await repository.upsert_mobile_prefix(
            prefix=prefix,
            active=True,
            dataset_version=dataset_version,
        )
        if inserted:
            prefixes_inserted += 1

    return ReferenceDataLoadResult(
        dataset_version=dataset_version,
        localities_inserted=localities_inserted,
        mobile_prefixes_inserted=prefixes_inserted,
    )
