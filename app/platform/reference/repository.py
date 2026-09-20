"""Data access for the residency-validation reference data.

The repository is the only place that touches the database, so the read/lookup
service (:mod:`app.platform.reference.service`) — and, through it, the
``ResidencyValidator`` — can be exercised in unit tests against an in-memory
fake that satisfies :class:`ReferenceDataRepositoryProtocol` without Postgres.

All lookups are keyed by an *already-normalized* locality name and scoped to a
``dataset_version``, so a running validator can pin the exact dataset it decided
against and record it as ``residency_proofs.validator_version`` (O-8).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from sqlalchemy import select

from app.platform.reference.models import IsraeliLocality, IsraeliMobilePrefix

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

__all__ = [
    "ReferenceDataRepository",
    "ReferenceDataRepositoryProtocol",
]


class ReferenceDataRepositoryProtocol(Protocol):
    """The data-access surface the reference read service depends on.

    Kept narrow so unit tests can supply a fake. Locality lookups take an
    already-normalized name (the service owns normalization).
    """

    async def find_locality_by_normalized_name(
        self, normalized: str, *, dataset_version: str
    ) -> IsraeliLocality | None:
        """Return the locality row whose ``normalized_name`` matches within a version."""
        ...

    async def find_mobile_prefix(
        self, prefix: str, *, dataset_version: str
    ) -> IsraeliMobilePrefix | None:
        """Return the mobile-prefix row for ``prefix`` within a version, or ``None``."""
        ...

    async def upsert_locality(
        self,
        *,
        locality_key: str,
        locale: str,
        name: dict[str, str],
        normalized_name: str,
        dataset_version: str,
    ) -> bool:
        """Insert a locality row if absent for its unique key; return whether inserted."""
        ...

    async def upsert_mobile_prefix(
        self, *, prefix: str, active: bool, dataset_version: str
    ) -> bool:
        """Insert a mobile-prefix row if absent for its unique key; return whether inserted."""
        ...


class ReferenceDataRepository:
    """SQLAlchemy implementation of :class:`ReferenceDataRepositoryProtocol`.

    Upserts are idempotent: they look up the unique key first and only insert
    when absent, so the loader is safe to run repeatedly (at startup or in a
    migration data step) without duplicating rows.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def find_locality_by_normalized_name(
        self, normalized: str, *, dataset_version: str
    ) -> IsraeliLocality | None:
        stmt = select(IsraeliLocality).where(
            IsraeliLocality.dataset_version == dataset_version,
            IsraeliLocality.normalized_name == normalized,
        )
        return (await self._session.execute(stmt)).scalars().first()

    async def find_mobile_prefix(
        self, prefix: str, *, dataset_version: str
    ) -> IsraeliMobilePrefix | None:
        stmt = select(IsraeliMobilePrefix).where(
            IsraeliMobilePrefix.dataset_version == dataset_version,
            IsraeliMobilePrefix.prefix == prefix,
        )
        return (await self._session.execute(stmt)).scalar_one_or_none()

    async def upsert_locality(
        self,
        *,
        locality_key: str,
        locale: str,
        name: dict[str, str],
        normalized_name: str,
        dataset_version: str,
    ) -> bool:
        existing = select(IsraeliLocality).where(
            IsraeliLocality.dataset_version == dataset_version,
            IsraeliLocality.locale == locale,
            IsraeliLocality.normalized_name == normalized_name,
        )
        if (await self._session.execute(existing)).scalars().first() is not None:
            return False
        self._session.add(
            IsraeliLocality(
                locality_key=locality_key,
                locale=locale,
                name=name,
                normalized_name=normalized_name,
                dataset_version=dataset_version,
            )
        )
        return True

    async def upsert_mobile_prefix(
        self, *, prefix: str, active: bool, dataset_version: str
    ) -> bool:
        existing = select(IsraeliMobilePrefix).where(
            IsraeliMobilePrefix.dataset_version == dataset_version,
            IsraeliMobilePrefix.prefix == prefix,
        )
        if (await self._session.execute(existing)).scalar_one_or_none() is not None:
            return False
        self._session.add(
            IsraeliMobilePrefix(
                prefix=prefix,
                active=active,
                dataset_version=dataset_version,
            )
        )
        return True
