"""In-app notification queue (Phase 1 Notifications)."""

from app.platform.notifications.models import Notification, NotificationType
from app.platform.notifications.service import (
    list_for_account,
    mark_all_read,
    mark_read,
    push,
    push_many,
    title_for,
    unread_count,
)

__all__ = [
    "Notification",
    "NotificationType",
    "list_for_account",
    "mark_all_read",
    "mark_read",
    "push",
    "push_many",
    "title_for",
    "unread_count",
]
