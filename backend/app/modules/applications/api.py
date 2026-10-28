"""ApplicationsApi — minimal cross-module contract for the applications domain.

Other modules that need application data (e.g. jobs when closing a JD)
must import ONLY this file, never models.py / repository.py / service.py.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, runtime_checkable
from uuid import UUID

from typing import Protocol

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.modules.identity.api import IdentityApi


@runtime_checkable
class ApplicationsApi(Protocol):
    """Minimal cross-module contract for application operations.

    Currently the only cross-module operation is the JD-close cascade
    (R7 AC11): when a Job_Description is closed, all non-terminal
    applications must be atomically closed in the same transaction.
    """

    async def cascade_close_for_jd(
        self, session: AsyncSession, jd_id: UUID, *, actor_id: UUID
    ) -> int:
        """Close all non-terminal applications for a JD in the caller's transaction.

        Called by JobDescriptionService.close() with its own UoW's session, so
        the cascade commits or rolls back with the JD status change (R7 AC11).

        Args:
            session:  The caller's open session; this method neither commits nor
                      opens a UoW of its own.
            jd_id:    The UUID of the Job_Description being closed.
            actor_id: The UUID of the account performing the close, recorded
                      in each ApplicationStatusTransition.

        Returns:
            The number of applications that were closed.
        """
        ...


class DefaultApplicationsApi:
    """Production implementation of :class:`ApplicationsApi`.

    Wired during application startup and stored on ``app.state``.
    """

    def __init__(
        self,
        uow_factory: Any,
        *,
        identity_api: IdentityApi,
    ) -> None:
        self._uow_factory = uow_factory
        self._identity_api = identity_api

    async def cascade_close_for_jd(
        self, session: AsyncSession, jd_id: UUID, *, actor_id: UUID
    ) -> int:
        """Close non-terminal applications for a closing JD (R7 AC11).

        Runs on the caller's session so it is atomic with the JD close.
        """
        from app.modules.applications import repository as repo  # noqa: PLC0415
        from app.platform.db.enums import ApplicationStatus  # noqa: PLC0415

        closed = await repo.close_applications_for_jd(session, jd_id)
        for application_id, from_status in closed:
            await repo.record_status_transition(
                session,
                application_id=application_id,
                from_status=from_status,
                to_status=ApplicationStatus.CLOSED,
                actor_account_id=actor_id,
                reason="JD closed — application auto-closed by cascade",
            )
        return len(closed)


__all__ = ["ApplicationsApi", "DefaultApplicationsApi"]
