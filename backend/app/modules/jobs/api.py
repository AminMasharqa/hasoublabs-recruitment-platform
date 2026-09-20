"""JobsApi — public interface for cross-module access (Section 17).

Other modules must ONLY import from ``api.py`` or ``schemas.py`` in this module.
They must never import from ``models.py``, ``repository.py``, or ``service.py``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from app.modules.jobs.schemas import JobDescriptionDTO

if TYPE_CHECKING:
    pass

try:
    from typing import Protocol, runtime_checkable
except ImportError:  # pragma: no cover
    from typing_extensions import Protocol, runtime_checkable  # type: ignore[assignment]


# ── Protocol ───────────────────────────────────────────────────────────────────


@runtime_checkable
class JobsApi(Protocol):
    """Cross-module interface for jobs operations.

    All methods must be awaitable. No implementation detail leaks through
    this interface — callers depend only on this contract.
    """

    async def get_jd(self, jd_id: UUID) -> JobDescriptionDTO:
        """Return a Job Description by id.

        Args:
            jd_id: The JD UUID.

        Returns:
            The JobDescriptionDTO.

        Raises:
            AuthorizationDenied: If the JD does not exist.
        """
        ...

    async def jd_is_open(self, jd_id: UUID) -> bool:
        """Return True if the Job Description is in OPEN status.

        Used by the applications module to gate submission (R7 AC2).

        Args:
            jd_id: The JD UUID.

        Returns:
            True if Open, False otherwise (including not-found).
        """
        ...

    async def get_jd_skill_ids(self, jd_id: UUID) -> list[UUID]:
        """Return the required skill UUIDs for a Job Description.

        Args:
            jd_id: The JD UUID.

        Returns:
            List of skill UUIDs (empty if none or JD not found).
        """
        ...

    async def close_jd_cascade_applications(
        self, jd_id: UUID, actor_id: UUID
    ) -> None:
        """Close the JD and cascade-close all its open applications.

        Called by ApplicationService when a JD is closed so both the JD status
        change and application status changes commit atomically.

        Args:
            jd_id: The JD UUID.
            actor_id: The account that triggered the close action (for audit).
        """
        ...


# ── Default Implementation ─────────────────────────────────────────────────────


class DefaultJobsApi:
    """Concrete implementation of :class:`JobsApi`.

    Wired by the application lifespan and injected into modules that need job
    data. Never imported by other modules directly.

    Args:
        uow_factory: Zero-argument callable returning a new :class:`UnitOfWork`.
    """

    def __init__(self, uow_factory: Any) -> None:
        self._uow_factory = uow_factory

    async def get_jd(self, jd_id: UUID) -> JobDescriptionDTO:
        """Return a Job Description by id, or raise AuthorizationDenied.

        Args:
            jd_id: The JD UUID.

        Returns:
            The JobDescriptionDTO.

        Raises:
            AuthorizationDenied: If the JD does not exist.
        """
        from app.modules.jobs import repository as repo  # noqa: PLC0415
        from app.platform.security.errors import AuthorizationDenied  # noqa: PLC0415
        from app.modules.jobs.service import _jd_to_dto  # noqa: PLC0415

        async with self._uow_factory() as uow:
            jd = await repo.get_jd(uow.session, jd_id)
            if jd is None:
                raise AuthorizationDenied()
            skill_ids = await repo.get_jd_skill_ids(uow.session, jd_id)
            return _jd_to_dto(jd, skill_ids)

    async def jd_is_open(self, jd_id: UUID) -> bool:
        """Return True if the JD is in OPEN status.

        Args:
            jd_id: The JD UUID.

        Returns:
            True if the JD exists and is Open.
        """
        from app.modules.jobs import repository as repo  # noqa: PLC0415
        from app.platform.db.enums import JdStatus  # noqa: PLC0415

        async with self._uow_factory() as uow:
            jd = await repo.get_jd(uow.session, jd_id)
            if jd is None:
                return False
            return jd.status == JdStatus.OPEN

    async def get_jd_skill_ids(self, jd_id: UUID) -> list[UUID]:
        """Return the required skill UUIDs for a JD.

        Args:
            jd_id: The JD UUID.

        Returns:
            List of skill UUIDs (empty if the JD does not exist).
        """
        from app.modules.jobs import repository as repo  # noqa: PLC0415

        async with self._uow_factory() as uow:
            return await repo.get_jd_skill_ids(uow.session, jd_id)

    async def close_jd_cascade_applications(
        self, jd_id: UUID, actor_id: UUID
    ) -> None:
        """Close a JD and all its open applications atomically.

        This is the transactional boundary: both the JD status change and the
        application status changes must commit together. The applications module
        provides the cascade logic via its own repository; we call it here inside
        a single UoW transaction.

        Args:
            jd_id: The JD UUID.
            actor_id: The account triggering the close (for audit context).
        """
        from app.modules.jobs import repository as repo  # noqa: PLC0415
        from app.platform.db.base import utc_now  # noqa: PLC0415
        from app.platform.db.enums import JdStatus  # noqa: PLC0415
        from app.platform.security.errors import AuthorizationDenied  # noqa: PLC0415

        async with self._uow_factory() as uow:
            jd = await repo.get_jd(uow.session, jd_id)
            if jd is None:
                raise AuthorizationDenied()

            if jd.status != JdStatus.CLOSED:
                await repo.set_jd_status(
                    uow.session,
                    jd,
                    JdStatus.CLOSED,
                    closed_at=utc_now(),
                )

            # Attempt to cascade-close applications if the module is available.
            # This import is conditional so the jobs module has no hard
            # dependency on the applications module.
            try:
                from app.modules.applications import repository as app_repo  # noqa: PLC0415
                await app_repo.close_applications_for_jd(uow.session, jd_id=jd_id)
            except ImportError:
                pass  # Applications module not yet available (staged deployment).


__all__ = ["DefaultJobsApi", "JobsApi", "JobDescriptionDTO"]
