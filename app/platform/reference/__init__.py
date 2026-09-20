"""Residency-validation reference-data platform sub-package (R2 AC2, O-8).

The bundled, versioned Israeli reference datasets — ``israeli_localities`` (CBS
locality names with ar/he/en variants) and ``israeli_mobile_prefixes``
(configurable prefix set) — plus a versioned loader and the read/lookup service
the ``ResidencyValidator`` (Karim's Task 11.2, ``app/modules/identity``)
consumes. This package owns the *data* and its lookup surface only, never the
pass/fail validation logic.

Locality-name resolution reuses the shared, idempotent, script-safe
:func:`app.platform.taxonomy.normalization.normalize_text`, so a city typed in
Arabic, Hebrew, or English resolves and non-Latin letters are never stripped.

This is a platform sub-package, not a domain module: no ``router.py`` / ``api.py``.
The public surface is this ``__all__``.
"""

from app.platform.reference.data import (
    DATASET_VERSION,
    ISRAELI_LOCALITIES,
    ISRAELI_MOBILE_PREFIXES,
)
from app.platform.reference.loader import (
    ReferenceDataLoadResult,
    load_reference_data,
)
from app.platform.reference.models import IsraeliLocality, IsraeliMobilePrefix
from app.platform.reference.repository import (
    ReferenceDataRepository,
    ReferenceDataRepositoryProtocol,
)
from app.platform.reference.service import LocalityMatch, ReferenceDataService

__all__ = [
    "DATASET_VERSION",
    "ISRAELI_LOCALITIES",
    "ISRAELI_MOBILE_PREFIXES",
    "IsraeliLocality",
    "IsraeliMobilePrefix",
    "LocalityMatch",
    "ReferenceDataLoadResult",
    "ReferenceDataRepository",
    "ReferenceDataRepositoryProtocol",
    "ReferenceDataService",
    "load_reference_data",
]
