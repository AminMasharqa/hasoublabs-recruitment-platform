"""CvsApi — public interface for cross-module access (R5, Task 14.5).

Other modules (e.g. applications) import only this file to check whether a
candidate has an uploadable CV or to resolve the active version reference.
They must never import ``models``, ``repository``, or ``service`` directly.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol, runtime_checkable
from uuid import UUID

from app.platform.security.errors import AuthorizationDenied
from app.modules.cvs import repository as repo
from app.modules.cvs.schemas import CvVersionRef

if TYPE_CHECKING:
    from app.platform.db.uow import UnitOfWork


@runtime_checkable
class CvsApi(Protocol):
    """Public contract for inter-module CV access."""

    async def has_any_version(self, candidate_id: UUID) -> bool:
        """Return True if the candidate has at least one Available CV version."""
        ...

    async def resolve_active_version(
        self,
        candidate_id: UUID,
        variant_id: UUID | None,
    ) -> CvVersionRef:
        """Return a minimal reference to the candidate's active CV version.

        If ``variant_id`` is given, resolves the latest Available version for
        that specific variant. Otherwise resolves the primary active variant's
        latest Available version.

        Raises:
            AuthorizationDenied: If no matching Available version is found.
        """
        ...


class DefaultCvsApi:
    """Default implementation of :class:`CvsApi` backed by the CVs repository."""

    def __init__(self, uow_factory: type[UnitOfWork]) -> None:
        self._uow_factory = uow_factory

    async def has_any_version(self, candidate_id: UUID) -> bool:
        """Return True if the candidate has at least one Available CV version."""
        async with self._uow_factory() as uow:
            return await repo.has_any_available_version(uow.session, candidate_id)

    async def resolve_active_version(
        self,
        candidate_id: UUID,
        variant_id: UUID | None = None,
    ) -> CvVersionRef:
        """Resolve a CvVersionRef for the candidate.

        Args:
            candidate_id: The candidate's account UUID.
            variant_id: If supplied, target this specific variant; otherwise use
                the candidate's primary active variant.

        Raises:
            AuthorizationDenied: If no Available version is found (existence
                must not be leaked to the caller, per design R3 AC6).
        """
        async with self._uow_factory() as uow:
            if variant_id is not None:
                # Verify the variant belongs to this candidate
                variant = await repo.get_variant(
                    uow.session, variant_id, account_id=candidate_id
                )
                if variant is None or variant.is_archived:
                    raise AuthorizationDenied()

                version = await repo.get_active_version_for_variant(
                    uow.session, variant_id
                )
            else:
                version = await repo.get_primary_active_version(
                    uow.session, candidate_id
                )
                if version is not None:
                    variant = await repo.get_variant(
                        uow.session, version.variant_id, account_id=candidate_id
                    )
                else:
                    variant = None

            if version is None or variant is None:
                raise AuthorizationDenied()

            return CvVersionRef(
                version_id=version.id,
                variant_id=version.variant_id,
                account_id=variant.account_id,
                object_key=version.object_key,
                bucket=version.bucket,
            )
