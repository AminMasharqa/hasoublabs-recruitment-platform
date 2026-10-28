"""The transactional outbox table.

A domain transaction inserts an ``outbox_emails`` row, so queueing the mail is
atomic with the state change that justified it: an account cannot reach
``PendingVerification`` without its code email queued, and a queued email can
never reference a rolled-back account (design: Email and Notifications).

Verification-code plaintext is never stored here. ``payload`` holds
``secret_refs`` — handles into a short-lived secret store that the renderer
redeems at send time (see :mod:`app.platform.mail.secrets`).
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from sqlalchemy import Enum, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, TimestampMixin, UuidPkMixin, utc_now


class OutboxEmailState(StrEnum):
    """Lifecycle of one queued email."""

    PENDING = "Pending"
    SENT = "Sent"
    FAILED = "Failed"


#: Native PostgreSQL enum. Not part of Task 2.2's shared domain enum list — this
#: type is platform-internal, so it is declared with the table that uses it.
outbox_email_state = Enum(
    OutboxEmailState,
    name="outbox_email_state",
    values_callable=lambda enum: [member.value for member in enum],
)


class OutboxEmail(Base, UuidPkMixin, TimestampMixin):
    """One queued transactional email."""

    __tablename__ = "outbox_emails"

    #: Natural key of the triggering event, e.g.
    #: ``verification_code:<account_id>:<verification_id>``. UNIQUE, so a retried
    #: request or an at-least-once caller cannot queue the same mail twice.
    idempotency_key: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)

    to_address: Mapped[str] = mapped_column(String(320), nullable=False)

    #: Optional recipient account. Declared as a bare UUID, not a foreign key:
    #: the platform layer must not depend on a domain table (``accounts`` belongs
    #: to ``identity``). The FK is added by the identity migration.
    recipient_account_id: Mapped[UUID | None] = mapped_column(default=None, index=True)

    template: Mapped[str] = mapped_column(String(100), nullable=False)
    locale: Mapped[str] = mapped_column(String(8), nullable=False, default="en")

    #: Template parameters plus ``secret_refs``. Never carries a secret value.
    payload: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)

    state: Mapped[OutboxEmailState] = mapped_column(
        outbox_email_state,
        default=OutboxEmailState.PENDING,
        nullable=False,
    )

    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    next_attempt_at: Mapped[datetime] = mapped_column(default=utc_now, nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(default=None)
    provider_message_id: Mapped[str | None] = mapped_column(String(255), default=None)
    last_error: Mapped[str | None] = mapped_column(Text, default=None)

    __table_args__ = (
        # The drainer's claim query: pending rows that are due, oldest first.
        Index(
            "idx_outbox_emails_due",
            "next_attempt_at",
            postgresql_where="state = 'Pending'",
        ),
        Index("idx_outbox_emails_state_created_at", "state", "created_at"),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<OutboxEmail {self.template} {self.state} attempts={self.attempts}>"
