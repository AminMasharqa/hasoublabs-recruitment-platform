"""In-app notification queue rows.

``NotificationType`` encodes exactly the seven events in the requirements'
"Phase 1 Notifications (Minimal)" constraint, so Requirement 19 (Phase 2)
extends the enum rather than replacing the table (design: Email and
Notifications).
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Final
from uuid import UUID

from sqlalchemy import Enum, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, UuidPkMixin, utc_now


class NotificationType(StrEnum):
    """The seven Phase 1 notification events."""

    #: Registration submitted → the Verification_Code was emailed.
    VERIFICATION_CODE_ISSUED = "VerificationCodeIssued"
    #: Code confirmed, account reached PendingApproval → Admins must review.
    REGISTRATION_AWAITING_REVIEW = "RegistrationAwaitingReview"
    #: Account reached ApprovedPendingMeeting → Admins must arrange onboarding.
    ONBOARDING_MEETING_REQUIRED = "OnboardingMeetingRequired"
    #: Account moved to Approved or Rejected → notify the user.
    ACCOUNT_DECISION_RECORDED = "AccountDecisionRecorded"
    #: In-platform Application submitted → notify the Candidate.
    APPLICATION_SUBMITTED = "ApplicationSubmitted"
    #: Application status changed → notify the Candidate.
    APPLICATION_STATUS_CHANGED = "ApplicationStatusChanged"
    #: CV quarantined or its integrity check failed → notify Candidate + Admin.
    CV_INTEGRITY_ISSUE = "CvIntegrityIssue"

    @property
    def title_key(self) -> str:
        """Babel message key for the notification title."""
        return f"notification.{_TITLE_SLUG[self]}.title"


_TITLE_SLUG: Final[dict[NotificationType, str]] = {
    NotificationType.VERIFICATION_CODE_ISSUED: "verification_code_issued",
    NotificationType.REGISTRATION_AWAITING_REVIEW: "registration_awaiting_review",
    NotificationType.ONBOARDING_MEETING_REQUIRED: "onboarding_meeting_required",
    NotificationType.ACCOUNT_DECISION_RECORDED: "account_decision_recorded",
    NotificationType.APPLICATION_SUBMITTED: "application_submitted",
    NotificationType.APPLICATION_STATUS_CHANGED: "application_status_changed",
    NotificationType.CV_INTEGRITY_ISSUE: "cv_integrity_issue",
}

notification_type = Enum(
    NotificationType,
    name="notification_type",
    values_callable=lambda enum: [member.value for member in enum],
)


class Notification(Base, UuidPkMixin):
    """One in-app notification for one account."""

    __tablename__ = "notifications"

    #: Recipient. A bare UUID rather than a foreign key: the platform layer must
    #: not depend on a domain table (``accounts`` belongs to ``identity``). The FK
    #: is added by the identity migration.
    recipient_account_id: Mapped[UUID] = mapped_column(nullable=False)

    type: Mapped[NotificationType] = mapped_column(notification_type, nullable=False)

    #: What the notification is about, e.g. ``("Application", <uuid>)``. Kept as a
    #: loose pair rather than seven nullable foreign keys, since the referents
    #: live in different domain modules.
    entity_type: Mapped[str | None] = mapped_column(String(100), default=None)
    entity_id: Mapped[UUID | None] = mapped_column(default=None)

    created_at: Mapped[datetime] = mapped_column(default=utc_now, nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(default=None)

    __table_args__ = (
        # The list query: one account's notifications, newest first (keyset).
        Index("idx_notifications_recipient_created_at", "recipient_account_id", "created_at"),
        # The unread badge.
        Index(
            "idx_notifications_unread",
            "recipient_account_id",
            postgresql_where="read_at IS NULL",
        ),
    )

    @property
    def is_read(self) -> bool:
        return self.read_at is not None

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Notification {self.type} recipient={self.recipient_account_id}>"
