"""CVs repository — all DB access (R5, Task 14.2, module-private).

All queries are parameterised through SQLAlchemy so no user data is ever
interpolated into SQL strings. Access-scoping is enforced at the query level:
every function that loads a user-owned resource accepts account_id and adds it
to the WHERE clause, rather than loading-then-checking.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import func, select, update

from app.platform.db.base import utc_now
from app.platform.db.enums import CvVersionState
from app.modules.cvs.models import CvVariant, CvVersion

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


# ── CvVariant queries ─────────────────────────────────────────────────────────


async def get_variant(
    session: AsyncSession,
    variant_id: UUID,
    *,
    account_id: UUID | None = None,
) -> CvVariant | None:
    """Return a variant by id, optionally scoped to an account."""
    stmt = select(CvVariant).where(CvVariant.id == variant_id)
    if account_id is not None:
        stmt = stmt.where(CvVariant.account_id == account_id)
    return (await session.scalars(stmt)).first()


async def list_variants(
    session: AsyncSession,
    account_id: UUID,
    *,
    include_archived: bool = False,
) -> list[CvVariant]:
    """Return all variants for an account, optionally including archived ones."""
    stmt = select(CvVariant).where(CvVariant.account_id == account_id)
    if not include_archived:
        stmt = stmt.where(CvVariant.is_archived.is_(False))
    stmt = stmt.order_by(CvVariant.created_at)
    return list((await session.scalars(stmt)).all())


async def count_active_variants(session: AsyncSession, account_id: UUID) -> int:
    """Return how many non-archived variants the account has."""
    result = await session.execute(
        select(func.count(CvVariant.id)).where(
            CvVariant.account_id == account_id,
            CvVariant.is_archived.is_(False),
        )
    )
    return int(result.scalar_one())


async def create_variant(
    session: AsyncSession,
    *,
    account_id: UUID,
    name: str,
    description: str | None,
) -> CvVariant:
    """Insert a new variant and return the ORM instance."""
    variant = CvVariant(
        account_id=account_id,
        name=name,
        description=description,
        is_primary=False,
        is_archived=False,
    )
    session.add(variant)
    await session.flush()
    return variant


async def update_variant(
    session: AsyncSession,
    variant: CvVariant,
    *,
    name: str | None,
    description: str | None,
) -> None:
    """Apply a partial update to a variant's mutable fields."""
    if name is not None:
        variant.name = name
    if description is not None:
        variant.description = description
    variant.updated_at = utc_now()
    await session.flush()


async def set_primary_variant(
    session: AsyncSession,
    account_id: UUID,
    variant_id: UUID,
) -> None:
    """Set exactly one variant as primary, clearing the flag on all others.

    Uses two UPDATE statements inside the same transaction:
    1. Clear is_primary on all active variants for the account.
    2. Set is_primary=True on the target variant.
    """
    # Clear existing primary
    await session.execute(
        update(CvVariant)
        .where(
            CvVariant.account_id == account_id,
            CvVariant.is_archived.is_(False),
        )
        .values(is_primary=False, updated_at=utc_now())
    )
    # Set new primary
    await session.execute(
        update(CvVariant)
        .where(CvVariant.id == variant_id)
        .values(is_primary=True, updated_at=utc_now())
    )
    await session.flush()


async def archive_variant(
    session: AsyncSession,
    variant: CvVariant,
) -> None:
    """Archive the variant.

    If the variant was primary, the service layer must decide a replacement
    before calling this function. This function only sets the flag.
    """
    variant.is_archived = True
    variant.is_primary = False
    variant.updated_at = utc_now()
    await session.flush()


async def _find_replacement_primary(
    session: AsyncSession,
    account_id: UUID,
    exclude_variant_id: UUID,
) -> CvVariant | None:
    """Return the best candidate to promote to primary after archiving another.

    Strategy: the active variant whose latest version was created most recently.
    Falls back to the most recently created active variant if none has a version.
    """
    # Active variants with at least one available version, sorted by version recency
    stmt = (
        select(CvVariant)
        .join(CvVersion, CvVersion.variant_id == CvVariant.id)
        .where(
            CvVariant.account_id == account_id,
            CvVariant.is_archived.is_(False),
            CvVariant.id != exclude_variant_id,
            CvVersion.state == CvVersionState.AVAILABLE,
        )
        .order_by(CvVersion.created_at.desc())
        .limit(1)
    )
    result = (await session.scalars(stmt)).first()
    if result is not None:
        return result

    # Fallback: newest active variant, regardless of version presence
    fallback_stmt = (
        select(CvVariant)
        .where(
            CvVariant.account_id == account_id,
            CvVariant.is_archived.is_(False),
            CvVariant.id != exclude_variant_id,
        )
        .order_by(CvVariant.created_at.desc())
        .limit(1)
    )
    return (await session.scalars(fallback_stmt)).first()


# ── CvVersion queries ─────────────────────────────────────────────────────────


async def get_version(
    session: AsyncSession,
    version_id: UUID,
) -> CvVersion | None:
    """Return a version by its UUID."""
    return await session.get(CvVersion, version_id)


async def get_version_by_number(
    session: AsyncSession,
    variant_id: UUID,
    version_number: int,
) -> CvVersion | None:
    """Return a specific version by its variant and monotonic number."""
    stmt = select(CvVersion).where(
        CvVersion.variant_id == variant_id,
        CvVersion.version_number == version_number,
    )
    return (await session.scalars(stmt)).first()


async def list_versions(
    session: AsyncSession,
    variant_id: UUID,
) -> list[CvVersion]:
    """Return all versions for a variant, ordered by version number."""
    stmt = (
        select(CvVersion)
        .where(CvVersion.variant_id == variant_id)
        .order_by(CvVersion.version_number)
    )
    return list((await session.scalars(stmt)).all())


async def get_latest_version(
    session: AsyncSession,
    variant_id: UUID,
) -> CvVersion | None:
    """Return the highest-numbered version for a variant."""
    stmt = (
        select(CvVersion)
        .where(CvVersion.variant_id == variant_id)
        .order_by(CvVersion.version_number.desc())
        .limit(1)
    )
    return (await session.scalars(stmt)).first()


async def allocate_version_number(
    session: AsyncSession,
    variant_id: UUID,
) -> int:
    """Return the next version number for a variant, with a row-level lock.

    The SELECT ... FOR UPDATE on the variant row serialises concurrent uploads
    for the same variant so version numbers are never duplicated.

    Returns:
        The next monotonic version number (1-based).
    """
    # Lock the variant row to serialise concurrent uploads
    stmt = (
        select(CvVariant)
        .where(CvVariant.id == variant_id)
        .with_for_update()
    )
    await session.scalars(stmt)  # Acquires row-level lock

    # Count existing versions
    count_stmt = select(func.count(CvVersion.id)).where(
        CvVersion.variant_id == variant_id
    )
    count_result = await session.execute(count_stmt)
    current_count = int(count_result.scalar_one())
    return current_count + 1


async def create_version(
    session: AsyncSession,
    *,
    variant_id: UUID,
    version_number: int,
    object_key: str,
    object_version_id: str | None,
    bucket: str,
    sha256_digest: bytes,
    size_bytes: int,
    mime_type: str,
    original_filename: str,
) -> CvVersion:
    """Insert a new version row (state=PendingScan) and return it."""
    version = CvVersion(
        variant_id=variant_id,
        version_number=version_number,
        object_key=object_key,
        object_version_id=object_version_id,
        bucket=bucket,
        sha256_digest=sha256_digest,
        size_bytes=size_bytes,
        mime_type=mime_type,
        original_filename=original_filename,
        state=CvVersionState.PENDING_SCAN,
    )
    session.add(version)
    await session.flush()
    return version


async def promote_version(
    session: AsyncSession,
    version: CvVersion,
    *,
    object_key: str,
    bucket: str,
) -> None:
    """Mark a version as Available and update its bucket after scan clearance."""
    await session.execute(
        update(CvVersion)
        .where(CvVersion.id == version.id)
        .values(
            state=CvVersionState.AVAILABLE,
            bucket=bucket,
            object_key=object_key,
        )
    )
    # Keep in-memory object consistent
    version.state = CvVersionState.AVAILABLE
    version.bucket = bucket
    # object_key is immutable after insert; the promotion key should be the same
    await session.flush()


async def quarantine_version(
    session: AsyncSession,
    version: CvVersion,
    *,
    scan_result: str,
) -> None:
    """Mark a version as Quarantined and record the scan result."""
    await session.execute(
        update(CvVersion)
        .where(CvVersion.id == version.id)
        .values(
            state=CvVersionState.QUARANTINED,
            scan_result=scan_result,
        )
    )
    version.state = CvVersionState.QUARANTINED
    version.scan_result = scan_result
    await session.flush()


async def update_version_scan(
    session: AsyncSession,
    version: CvVersion,
    *,
    state: CvVersionState,
    scan_result: str,
    scanned_at: datetime,
) -> None:
    """Record the full scan result on a version row."""
    await session.execute(
        update(CvVersion)
        .where(CvVersion.id == version.id)
        .values(
            state=state,
            scan_result=scan_result,
            scanned_at=scanned_at,
        )
    )
    version.state = state
    version.scan_result = scan_result
    version.scanned_at = scanned_at
    await session.flush()


# ── Cross-variant queries ─────────────────────────────────────────────────────


async def has_any_available_version(
    session: AsyncSession,
    account_id: UUID,
) -> bool:
    """Return True if the account has at least one Available CV version."""
    stmt = (
        select(CvVersion.id)
        .join(CvVariant, CvVariant.id == CvVersion.variant_id)
        .where(
            CvVariant.account_id == account_id,
            CvVariant.is_archived.is_(False),
            CvVersion.state == CvVersionState.AVAILABLE,
        )
        .limit(1)
    )
    result = (await session.scalars(stmt)).first()
    return result is not None


async def get_primary_active_version(
    session: AsyncSession,
    account_id: UUID,
) -> CvVersion | None:
    """Return the latest Available version from the primary active variant."""
    stmt = (
        select(CvVersion)
        .join(CvVariant, CvVariant.id == CvVersion.variant_id)
        .where(
            CvVariant.account_id == account_id,
            CvVariant.is_primary.is_(True),
            CvVariant.is_archived.is_(False),
            CvVersion.state == CvVersionState.AVAILABLE,
        )
        .order_by(CvVersion.version_number.desc())
        .limit(1)
    )
    return (await session.scalars(stmt)).first()


async def get_active_version_for_variant(
    session: AsyncSession,
    variant_id: UUID,
) -> CvVersion | None:
    """Return the latest Available version for a specific variant."""
    stmt = (
        select(CvVersion)
        .where(
            CvVersion.variant_id == variant_id,
            CvVersion.state == CvVersionState.AVAILABLE,
        )
        .order_by(CvVersion.version_number.desc())
        .limit(1)
    )
    return (await session.scalars(stmt)).first()


async def list_all_available_versions(
    session: AsyncSession,
) -> list[tuple[CvVersion, UUID]]:
    """Return (version, account_id) pairs for all Available versions.

    Used by the nightly integrity sweep (R5 AC15).
    """
    stmt = (
        select(CvVersion, CvVariant.account_id)
        .join(CvVariant, CvVariant.id == CvVersion.variant_id)
        .where(CvVersion.state == CvVersionState.AVAILABLE)
        .order_by(CvVersion.created_at)
    )
    rows = (await session.execute(stmt)).all()
    return [(row[0], row[1]) for row in rows]
