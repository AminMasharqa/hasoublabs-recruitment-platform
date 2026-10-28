"""IdentityApi — public interface for cross-module access (Task 12.5).

Other domain modules that need identity data (e.g. profiles, cvs, applications)
must import ONLY this module, never models.py / repository.py / service.py.

The Protocol is the compile-time contract; DefaultIdentityApi is the runtime
implementation injected through app.state.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, runtime_checkable
from uuid import UUID

from typing import Protocol

from app.platform.db.enums import AccountStatus
from app.platform.db.unit_of_work import UnitOfWork
from app.modules.identity import repository as repo
from app.modules.identity.schemas import AccountDTO, NotificationTarget

if TYPE_CHECKING:
    from collections.abc import Callable

logger = logging.getLogger(__name__)


@runtime_checkable
class IdentityApi(Protocol):
    """Minimal cross-module contract for the identity domain."""

    async def get_account(self, account_id: UUID) -> AccountDTO:
        """Return the account DTO for the given ID.

        Raises AuthorizationDenied (treated as not-found) if the account does
        not exist, in line with the constant-time denial policy.
        """
        ...

    async def account_is_approved(self, account_id: UUID) -> bool:
        """Return True if the account exists and is in the Approved status."""
        ...

    async def list_admin_recipients(self) -> list[NotificationTarget]:
        """Return notification targets for every active Admin account.

        Used by other modules that need to notify all platform administrators
        (e.g. when a new CV is uploaded or an application needs review).
        """
        ...

    async def resolve_actor_label(self, account_id: UUID | None) -> str:
        """Return a human-readable label for an audit actor.

        Returns the account email if found, "system" for None / unknown IDs.
        """
        ...


class DefaultIdentityApi:
    """Production implementation of IdentityApi backed by the DB."""

    def __init__(self, uow_factory: Callable[[], UnitOfWork]) -> None:
        self._uow_factory = uow_factory

    async def get_account(self, account_id: UUID) -> AccountDTO:
        """Return the account DTO or raise AuthorizationDenied."""
        from app.platform.security.errors import AuthorizationDenied  # noqa: PLC0415
        from app.platform.security.mfa import is_enrolled  # noqa: PLC0415

        async with self._uow_factory() as uow:
            account = await repo.get_account_by_id(uow.session, account_id)

        if account is None:
            raise AuthorizationDenied()

        return AccountDTO(
            id=account.id,
            email=account.email,
            roles=[r.value for r in account.roles],
            status=account.status.value,
            language_preference=account.language_preference,
            created_at=account.created_at,
            mfa_enrolled=is_enrolled(account.mfa_secret_enc),
        )

    async def account_is_approved(self, account_id: UUID) -> bool:
        """Return True if the account is Approved, False if not found or other status."""
        async with self._uow_factory() as uow:
            account = await repo.get_account_by_id(uow.session, account_id)

        return account is not None and account.status == AccountStatus.APPROVED

    async def list_admin_recipients(self) -> list[NotificationTarget]:
        """Return a NotificationTarget for each active Admin account."""
        async with self._uow_factory() as uow:
            admins = await repo.get_all_admin_accounts(uow.session)

        return [
            NotificationTarget(
                account_id=admin.id,
                email=admin.email,
                language_preference=admin.language_preference,
            )
            for admin in admins
        ]

    async def resolve_actor_label(self, account_id: UUID | None) -> str:
        """Return the email for the given account ID, or "system" as fallback."""
        if account_id is None:
            return "system"

        try:
            async with self._uow_factory() as uow:
                account = await repo.get_account_by_id(uow.session, account_id)
        except Exception:  # noqa: BLE001
            logger.warning("resolve_actor_label: DB error for account_id %s", account_id)
            return str(account_id)

        if account is None:
            return str(account_id)

        return account.email
