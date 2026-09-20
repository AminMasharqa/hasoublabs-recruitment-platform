"""Reading and writing the in-app notification queue.

Writes join the caller's transaction, exactly like the outbox: an Application
confirmation that is visible in-app but whose Application rolled back would be a
lie the user can see (R7 AC12).

Every read is scoped to one account id inside the query, never filtered after
the fact — the access-scoping rule that keeps one user's notifications
unreachable to another.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from sqlalchemy import func, select, update

from app.platform.db.base import utc_now
from app.platform.i18n.catalog import translate
from app.platform.notifications.models import Notification
from app.platform.pagination.keyset import Page, PageRequest, SortKey, paginate

if TYPE_CHECKING:
    from collections.abc import Iterable, Sequence
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession

    from app.platform.notifications.models import NotificationType

_LOG = logging.getLogger(__name__)


def _sort_keys() -> tuple[SortKey, ...]:
    """Newest first, with the id as the unique tiebreaker the cursor needs."""
    return (
        SortKey(Notification.created_at, "desc"),
        SortKey(Notification.id, "desc"),
    )


def push(
    session: AsyncSession,
    *,
    recipient_account_id: UUID,
    notification_type: NotificationType,
    entity_type: str | None = None,
    entity_id: UUID | None = None,
) -> Notification:
    """Queue one notification in the caller's transaction (no commit)."""
    notification = Notification(
        recipient_account_id=recipient_account_id,
        type=notification_type,
        entity_type=entity_type,
        entity_id=entity_id,
        created_at=utc_now(),
    )
    session.add(notification)
    return notification


def push_many(
    session: AsyncSession,
    *,
    recipient_account_ids: Iterable[UUID],
    notification_type: NotificationType,
    entity_type: str | None = None,
    entity_id: UUID | None = None,
) -> list[Notification]:
    """Queue the same notification for several accounts (e.g. all Admins)."""
    return [
        push(
            session,
            recipient_account_id=account_id,
            notification_type=notification_type,
            entity_type=entity_type,
            entity_id=entity_id,
        )
        for account_id in recipient_account_ids
    ]


async def list_for_account(
    session: AsyncSession,
    account_id: UUID,
    page: PageRequest | None = None,
    *,
    unread_only: bool = False,
) -> Page[Notification]:
    """Return one keyset page of an account's notifications, newest first."""
    statement = select(Notification).where(Notification.recipient_account_id == account_id)
    if unread_only:
        statement = statement.where(Notification.read_at.is_(None))
    return await paginate(session, statement, _sort_keys(), page or PageRequest())


async def unread_count(session: AsyncSession, account_id: UUID) -> int:
    """Return how many unread notifications an account has."""
    result = await session.execute(
        select(func.count(Notification.id)).where(
            Notification.recipient_account_id == account_id,
            Notification.read_at.is_(None),
        )
    )
    return int(result.scalar_one())


async def mark_read(
    session: AsyncSession,
    *,
    account_id: UUID,
    notification_ids: Sequence[UUID],
) -> int:
    """Mark notifications read. Returns how many rows changed.

    The account id is part of the predicate, so a caller passing someone else's
    notification id changes nothing and learns nothing — the same outcome as
    passing an id that does not exist.
    """
    if not notification_ids:
        return 0
    result = await session.execute(
        update(Notification)
        .where(
            Notification.recipient_account_id == account_id,
            Notification.id.in_(notification_ids),
            Notification.read_at.is_(None),
        )
        .values(read_at=utc_now())
    )
    return int(result.rowcount or 0)


async def mark_all_read(session: AsyncSession, account_id: UUID) -> int:
    """Mark every unread notification of an account read."""
    result = await session.execute(
        update(Notification)
        .where(
            Notification.recipient_account_id == account_id,
            Notification.read_at.is_(None),
        )
        .values(read_at=utc_now())
    )
    return int(result.rowcount or 0)


def title_for(notification: Notification, locale: str | None = None) -> str:
    """Return the localized title for a notification."""
    return translate(notification.type.title_key, locale)
