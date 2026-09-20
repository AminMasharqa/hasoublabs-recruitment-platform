"""Bundled, versioned residency-validation reference data.

This module ships the reference datasets as a versioned in-package asset. The
loader (:mod:`app.platform.reference.loader`) reads these constants and
idempotently upserts them, stamping every row with :data:`DATASET_VERSION`.

DATASET STATUS — REPRESENTATIVE SEED SUBSET
-------------------------------------------
:data:`ISRAELI_LOCALITIES` is a **curated, representative subset** of the CBS
(Israel Central Bureau of Statistics) locality list: major cities with real
Arabic / Hebrew / English name variants. The full CBS list has ~1200+
localities.

    TODO(reference-data): Replace this seed subset with the full CBS locality
    list. Bump ``DATASET_VERSION`` when it is loaded so stored
    ``residency_proofs.validator_version`` values remain meaningful. Do NOT
    fabricate rows — source the real CBS dataset.

:data:`ISRAELI_MOBILE_PREFIXES` is the well-known standard set of Israeli
cellular prefixes. This is real, defensible data (not a placeholder), though
still "configurable platform data" per R2 AC2 and versioned like the localities.

All names are stored byte-identical; nothing here is transliterated.
"""

from __future__ import annotations

from typing import TypedDict

__all__ = [
    "DATASET_VERSION",
    "ISRAELI_LOCALITIES",
    "ISRAELI_MOBILE_PREFIXES",
    "LocalityNames",
]

#: The bundled dataset version. Bump on any change to the data below so that
#: ``residency_proofs.validator_version`` keeps pointing at the exact dataset
#: that accepted a proof (O-8). ``YYYY.MM.N`` (date + serial within the month).
DATASET_VERSION = "2024.06.1-seed"


class LocalityNames(TypedDict):
    """Per-locale display names for one locality."""

    ar: str
    he: str
    en: str


#: Representative subset of the CBS Israeli locality list. Each entry carries a
#: stable cross-locale ``key`` and real ar/he/en name variants. SEED SUBSET —
#: see module docstring TODO.
ISRAELI_LOCALITIES: tuple[tuple[str, LocalityNames], ...] = (
    ("jerusalem", {"ar": "القدس", "he": "ירושלים", "en": "Jerusalem"}),
    ("tel_aviv_yafo", {"ar": "تل أبيب", "he": "תל אביב-יפו", "en": "Tel Aviv-Yafo"}),
    ("haifa", {"ar": "حيفا", "he": "חיפה", "en": "Haifa"}),
    ("nazareth", {"ar": "الناصرة", "he": "נצרת", "en": "Nazareth"}),
    ("beer_sheva", {"ar": "بئر السبع", "he": "באר שבע", "en": "Be'er Sheva"}),
    ("rishon_lezion", {"ar": "ريشون لتسيون", "he": "ראשון לציון", "en": "Rishon LeZion"}),
    ("petah_tikva", {"ar": "بيتح تكفا", "he": "פתח תקווה", "en": "Petah Tikva"}),
    ("ashdod", {"ar": "أشدود", "he": "אשדוד", "en": "Ashdod"}),
    ("netanya", {"ar": "نتانيا", "he": "נתניה", "en": "Netanya"}),
    ("umm_al_fahm", {"ar": "أم الفحم", "he": "אום אל-פחם", "en": "Umm al-Fahm"}),
    ("tira", {"ar": "الطيرة", "he": "טירה", "en": "Tira"}),
    ("tayibe", {"ar": "الطيبة", "he": "טייבה", "en": "Tayibe"}),
    ("sakhnin", {"ar": "سخنين", "he": "סח'נין", "en": "Sakhnin"}),
    ("shefa_amr", {"ar": "شفا عمرو", "he": "שפרעם", "en": "Shefa-'Amr"}),
    ("acre", {"ar": "عكا", "he": "עכו", "en": "Acre"}),
)

#: The standard set of Israeli cellular (mobile) prefixes. Real, defensible data
#: — the local prefixes assigned to mobile networks. "Configurable platform
#: data" per R2 AC2, versioned via :data:`DATASET_VERSION`.
ISRAELI_MOBILE_PREFIXES: tuple[str, ...] = (
    "050",
    "051",
    "052",
    "053",
    "054",
    "055",
    "056",
    "058",
)
