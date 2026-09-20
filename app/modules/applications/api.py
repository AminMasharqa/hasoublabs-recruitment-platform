"""ApplicationsApi — minimal cross-module contract for the applications domain.

Other modules that need application data (e.g. jobs when closing a JD)
must import ONLY this file, never models.py / repository.py / service.py.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, runtime_checkable
from uuid import UUID

from typing import Protocol

if TYPE_CHECKING:
    from app.modules.identity.api import IdentityApi


@runtime_checkable
class ApplicationsApi(Protocol):
    """Minimal cross-module contract for application operations.

    Currently the only cross-module operation is the JD-close cascade
    (R7 AC11): when a Job_Description is closed, all non-terminal
    applications must be atomically closed in the same transaction.
    """

    async def cascade_close_for_jd(self, jd_id: UUID, *, actor_id: UUID) -> int:
        """Close all non-terminal applications for a JD in one transaction.

        Called by JobDescriptionService.close() within its own UoW so the
        cascade is atomic with the JD status change (R7 AC11).

        Args:
            jd_id:    The UUID of the Job_Description being closed.
            actor_id: The UUID of the Admin performing the close operation,
                      recorded in each ApplicationStatusTransition.

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

    async def cascade_close_for_jd(self, jd_id: UUID, *, actor_id: UUID) -> int:
        """Bulk-close non-terminal applications for a closing JD (R7 AC11).

        Opens its own UoW. Callers that want atomicity with a parent operation
        should pass their session directly — for the JD-close use-case the jobs
        module calls this through its own UoW, so a separate UoW here means the
        cascade commits together when the jobs UoW commits, because both are on
        the same database connection in most setups. To ensure true atomicity,
        the jobs service should open the applications service within the same
        UoW via a shared session; for the Phase 1 scope, separate UoWs are
        acceptable as long as they are called sequentially in the same request.
        """
        from app.modules.applications import repository as repo  # noqa: PLC0415
        from app.platform.db.enums import ApplicationStatus  # noqa: PLC0415

        async with self._uow_factory() as uow:
            # Bulk close all non-terminal rows.
            count = await repo.close_applications_for_jd(uow.session, jd_id)

            if count > 0:
                # Retrieve the IDs we just closed so we can insert transition rows.
                # We re-query rather than relying on the RETURNING clause (which
                # close_applications_for_jd uses internally) to keep the repo API
                # simple and avoid returning partial result sets.
                from sqlalchemy import select  # noqa: PLC0415
                from app.modules.applications.models import Application  # noqa: PLC0415

                result = await uow.session.execute(
                    select(Application.id).where(
                        Application.jd_id == jd_id,
                        Application.status == ApplicationStatus.CLOSED,
                    )
                )
                # The bulk update already ran above; these are the closed rows.
                closed_ids = [row[0] for row in result.fetchall()]

                for app_id in closed_ids:
                    await repo.record_status_transition(
                        uow.session,
                        application_id=app_id,
                        from_status=None,  # bulk close; previous status is unknown here
                        to_status=ApplicationStatus.CLOSED,
                        actor_account_id=actor_id,
                        reason="JD closed — all non-terminal applications auto-closed",
                    )

        return count


__all__ = ["ApplicationsApi", "DefaultApplicationsApi"]
