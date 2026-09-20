"""Residency-validation reference tables: ``israeli_localities`` and
``israeli_mobile_prefixes``.

These are the bundled, **versioned** platform reference datasets the
``ResidencyValidator`` (Karim's Task 11.2, ``app/modules/identity``) consumes to
decide R2 AC2 — that a residential address's city resolves to a locality within
Israel, and that a mobile phone number carries a valid Israeli local mobile
prefix. Task 7.2 owns only the *data* and its lookup surface, never the
pass/fail validator itself.

Data model (design: Data Models — "Platform reference data"; O-8; D-15):

* ``israeli_localities`` — one row per CBS locality, with per-locale display
  ``name`` (``ar`` / ``he`` / ``en``) in ``JSONB`` (stored byte-identical, never
  transliterated) and per-locale ``normalized_name`` lookup rows so a city typed
  in **any** of the three languages resolves via a normalized, offline,
  sub-millisecond lookup. Every row carries a ``dataset_version``.
* ``israeli_mobile_prefixes`` — the configurable set of valid Israeli local
  mobile prefixes (R2 AC2 calls this "configurable platform data"), each with an
  ``active`` flag and a ``dataset_version``.

VERSIONING
----------
Both tables are versioned via ``dataset_version`` so that
``residency_proofs.validator_version`` — which records *which* prefix/locality
dataset accepted a stored proof — is meaningful and a later dataset change is
explainable (design: residency_proofs; O-8). The loader stamps every row it
upserts with the dataset version it is loading.

MIGRATION OWNERSHIP
-------------------
The CREATE-table migration for these tables belongs to Section 2's (not-yet-
merged) migration harness; these ORM models only hang metadata on the shared
``Base``. The bundled-data loader (:mod:`app.platform.reference.loader`) is
deliberately independent of Alembic so it can run standalone at startup or be
wired into a migration data step later.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Boolean, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, TimestampMixin, UuidPkMixin

__all__ = ["IsraeliLocality", "IsraeliMobilePrefix"]


class IsraeliLocality(Base, UuidPkMixin, TimestampMixin):
    """One Israeli locality (CBS locality list) with ar/he/en name variants.

    A single row resolves a city typed in any of the three languages: the
    per-locale display names live in :attr:`name`, and a single
    :attr:`normalized_name` column carries the normalized key for whichever
    locale a lookup arrives in. One physical row therefore exists **per locale
    per locality** — three rows for a trilingual locality — all sharing the same
    :attr:`locality_key` (the stable identity of the place across locales) so
    the three variants of one city are joinable and countable as one place.
    """

    __tablename__ = "israeli_localities"

    #: Stable cross-locale identity of the place (e.g. ``"jerusalem"``). Rows for
    #: the ar/he/en variants of the same locality share this key, so "one
    #: locality" is countable independent of how many locales name it.
    locality_key: Mapped[str] = mapped_column(String(100), nullable=False)

    #: Locale code of *this* row's name variant: ``ar`` / ``he`` / ``en``.
    locale: Mapped[str] = mapped_column(String(8), nullable=False)

    #: Per-locale display names for the locality, keyed by locale code
    #: (``ar`` / ``he`` / ``en``). Stored byte-identical — Arabic/Hebrew names
    #: are never transliterated. Duplicated across the locale rows of a locality
    #: so any single row is self-describing for display.
    name: Mapped[dict[str, Any]] = mapped_column(nullable=False)

    #: The display name for this row's :attr:`locale`, reduced by
    #: :func:`app.platform.taxonomy.normalization.normalize_text`. The exact
    #: lookup key: a city typed in ar, he, or en normalizes to one of these.
    normalized_name: Mapped[str] = mapped_column(String(200), nullable=False)

    #: Which bundled dataset version this row belongs to (O-8). Stamped by the
    #: loader; recorded onto ``residency_proofs.validator_version`` at accept.
    dataset_version: Mapped[str] = mapped_column(String(32), nullable=False)

    __table_args__ = (
        # A normalized name is unique *within a dataset version and locale*, so
        # exact lookup keyed by (version, normalized_name) is unambiguous while
        # different dataset versions may coexist during a migration.
        UniqueConstraint(
            "dataset_version",
            "locale",
            "normalized_name",
            name="uq_israeli_localities_version_locale_normalized_name",
        ),
        # The validator's hot path: resolve a normalized city name within the
        # current dataset version, across any locale.
        Index(
            "idx_israeli_localities_version_normalized_name",
            "dataset_version",
            "normalized_name",
        ),
        # Group the locale variants of one place together.
        Index(
            "idx_israeli_localities_version_locality_key",
            "dataset_version",
            "locality_key",
        ),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return (
            f"<IsraeliLocality {self.locality_key!r} "
            f"[{self.locale}] v={self.dataset_version}>"
        )


class IsraeliMobilePrefix(Base, UuidPkMixin, TimestampMixin):
    """One valid Israeli local mobile prefix (e.g. ``"050"``), versioned.

    R2 AC2 declares the prefix set "configurable platform data". A row is a
    single prefix within a dataset version, with an :attr:`active` flag so a
    prefix can be retired without deleting its history.
    """

    __tablename__ = "israeli_mobile_prefixes"

    #: The local mobile prefix, digits only (e.g. ``"050"``, ``"052"``). Stored
    #: as text to preserve any leading zero.
    prefix: Mapped[str] = mapped_column(String(8), nullable=False)

    #: Whether this prefix is currently accepted. Retiring a prefix flips this
    #: rather than deleting the row, so past ``validator_version`` decisions stay
    #: explainable.
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    #: Which bundled dataset version this prefix belongs to.
    dataset_version: Mapped[str] = mapped_column(String(32), nullable=False)

    __table_args__ = (
        # A prefix appears at most once per dataset version.
        UniqueConstraint(
            "dataset_version",
            "prefix",
            name="uq_israeli_mobile_prefixes_version_prefix",
        ),
        # Membership check on the hot path: active prefixes of a dataset version.
        Index(
            "idx_israeli_mobile_prefixes_version_active",
            "dataset_version",
            "active",
        ),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return (
            f"<IsraeliMobilePrefix {self.prefix!r} "
            f"active={self.active} v={self.dataset_version}>"
        )
