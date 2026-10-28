"""Enqueueing into the transactional outbox, and draining it.

Enqueue runs inside the caller's transaction and never commits: that is the whole
point of the pattern. Drain runs in the worker, claims due rows with
``FOR UPDATE SKIP LOCKED`` so N workers never fight over the same row, sends, and
records the outcome.

Failure handling distinguishes two kinds:

* transient (SMTP down) — attempts incremented, ``next_attempt_at`` pushed out
  with exponential backoff, row stays ``Pending`` until the attempt ceiling;
* permanent (template cannot render) — row goes straight to ``Failed``, because
  retrying a message that can never be built only delays the operator noticing.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import timedelta
import logging
from typing import TYPE_CHECKING, Any, Final

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from app.platform.db.base import utc_now
from app.platform.errors.base import ValidationFailed
from app.platform.mail.models import OutboxEmail, OutboxEmailState
from app.platform.mail.sender import OutgoingEmail
from app.platform.mail.templates import (
    SECRET_REFS_KEY,
    EmailTemplate,
    TemplateRenderError,
    missing_params,
    render,
)

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping
    from datetime import datetime
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession

    from app.platform.mail.secrets import ShortLivedSecretStore
    from app.platform.mail.sender import MailSender

    SessionFactory = Callable[[], AsyncSession]

_LOG = logging.getLogger(__name__)

_MAX_ERROR_LENGTH: Final[int] = 2000


async def enqueue_email(
    session: AsyncSession,
    *,
    template: EmailTemplate,
    to_address: str,
    locale: str,
    idempotency_key: str,
    payload: Mapping[str, Any] | None = None,
    secret_refs: Mapping[str, str] | None = None,
    recipient_account_id: UUID | None = None,
    send_after: timedelta | None = None,
) -> bool:
    """Queue one email inside the caller's transaction.

    Args:
        session: The caller's session. **Not committed here** — the row lands
            with the state change that justified it, or not at all.
        template: Which Phase 1 email to send.
        to_address: Recipient address.
        locale: Recipient's language preference.
        idempotency_key: Natural key of the triggering event. A second call with
            the same key is a no-op.
        payload: Template parameters that are safe to persist.
        secret_refs: ``{parameter: reference}`` for values that must not be
            persisted (a Verification_Code), redeemed at send time.
        recipient_account_id: Recipient account, when there is one.
        send_after: Delay before the first send attempt.

    Returns:
        Whether a new row was inserted (``False`` means the key already existed).

    Raises:
        ValidationFailed: If a required template parameter is missing. Caught in
            the caller's transaction rather than at send time, where the row
            would already be committed and unrenderable.
    """
    body_payload: dict[str, Any] = dict(payload or {})
    if secret_refs:
        body_payload[SECRET_REFS_KEY] = dict(secret_refs)

    absent = missing_params(template, body_payload)
    if absent:
        raise ValidationFailed(
            log_message=f"{template}: missing template parameters {sorted(absent)}"
        )

    next_attempt_at = utc_now() + send_after if send_after else utc_now()
    statement = (
        insert(OutboxEmail)
        .values(
            idempotency_key=idempotency_key,
            to_address=to_address,
            recipient_account_id=recipient_account_id,
            template=template.value,
            locale=locale,
            payload=body_payload,
            state=OutboxEmailState.PENDING,
            attempts=0,
            next_attempt_at=next_attempt_at,
        )
        .on_conflict_do_nothing(index_elements=[OutboxEmail.idempotency_key])
        .returning(OutboxEmail.id)
    )
    inserted = (await session.execute(statement)).scalar_one_or_none()
    if inserted is None:
        _LOG.debug("Outbox key %s already queued; enqueue skipped", idempotency_key)
    return inserted is not None


@dataclass(frozen=True, slots=True)
class DrainOptions:
    """Tunables for :class:`OutboxDrainer`."""

    #: Rows are locked while the batch sends, so the batch stays small.
    batch_size: int = 20
    max_attempts: int = 6
    base_delay: timedelta = timedelta(seconds=30)
    max_delay: timedelta = timedelta(hours=1)
    send_timeout: timedelta = timedelta(seconds=15)

    def delay_for(self, attempts: int) -> timedelta:
        """Backoff before the next attempt (``attempts`` already made)."""
        exponent = max(0, attempts - 1)
        seconds = min(
            self.base_delay.total_seconds() * (2**exponent),
            self.max_delay.total_seconds(),
        )
        return timedelta(seconds=seconds)


@dataclass(frozen=True, slots=True)
class DrainResult:
    """Outcome of one drain pass."""

    claimed: int = 0
    sent: int = 0
    retried: int = 0
    failed: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "claimed": self.claimed,
            "sent": self.sent,
            "retried": self.retried,
            "failed": self.failed,
        }


class OutboxDrainer:
    """Claims due outbox rows, sends them, and records the outcome."""

    def __init__(
        self,
        *,
        session_factory: SessionFactory,
        sender: MailSender,
        secret_store: ShortLivedSecretStore | None = None,
        options: DrainOptions | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._sender = sender
        self._secret_store = secret_store
        self._options = options or DrainOptions()

    async def drain_once(self) -> DrainResult:
        """Send one batch of due emails."""
        options = self._options
        sent = retried = failed = 0

        async with self._session_factory() as session:
            claim = (
                select(OutboxEmail)
                .where(
                    OutboxEmail.state == OutboxEmailState.PENDING,
                    OutboxEmail.next_attempt_at <= utc_now(),
                )
                .order_by(OutboxEmail.next_attempt_at)
                .limit(options.batch_size)
                .with_for_update(skip_locked=True)
            )
            rows = list((await session.scalars(claim)).all())

            for row in rows:
                outcome = await self._deliver(row)
                if outcome == "sent":
                    sent += 1
                elif outcome == "retried":
                    retried += 1
                else:
                    failed += 1

            await session.commit()

        if rows:
            _LOG.info(
                "Outbox drain: claimed=%d sent=%d retried=%d failed=%d",
                len(rows),
                sent,
                retried,
                failed,
            )
        return DrainResult(claimed=len(rows), sent=sent, retried=retried, failed=failed)

    async def _deliver(self, row: OutboxEmail) -> str:
        """Attempt one row; mutates it in the caller's session."""
        options = self._options
        row.attempts += 1

        try:
            template = EmailTemplate(row.template)
        except ValueError:
            return self._mark_failed(row, f"Unknown template {row.template!r}")

        try:
            rendered = await render(
                template,
                locale=row.locale,
                payload=row.payload,
                secret_store=self._secret_store,
            )
        except TemplateRenderError as exc:
            # Permanent: the secret expired or a parameter is absent.
            return self._mark_failed(row, str(exc))

        try:
            message_id = await asyncio.wait_for(
                self._sender.send(
                    OutgoingEmail(
                        to_address=row.to_address,
                        subject=rendered.subject,
                        text_body=rendered.text_body,
                    )
                ),
                timeout=options.send_timeout.total_seconds(),
            )
        except Exception as exc:  # noqa: BLE001 - transport failures are transient
            # Includes TimeoutError from the send deadline above.
            if row.attempts >= options.max_attempts:
                return self._mark_failed(row, f"Giving up after {row.attempts} attempts: {exc}")
            row.next_attempt_at = utc_now() + options.delay_for(row.attempts)
            row.last_error = str(exc)[:_MAX_ERROR_LENGTH]
            _LOG.warning(
                "Outbox row %s attempt %d failed; retrying at %s",
                row.id,
                row.attempts,
                row.next_attempt_at,
            )
            return "retried"

        row.state = OutboxEmailState.SENT
        row.sent_at = utc_now()
        row.provider_message_id = message_id[:255]
        row.last_error = None
        return "sent"

    @staticmethod
    def _mark_failed(row: OutboxEmail, error: str) -> str:
        row.state = OutboxEmailState.FAILED
        row.last_error = error[:_MAX_ERROR_LENGTH]
        _LOG.error("Outbox row %s failed permanently: %s", row.id, error)
        return "failed"


async def pending_backlog(session: AsyncSession) -> tuple[int, float]:
    """Return ``(pending_count, oldest_pending_age_seconds)``.

    Feeds the ``outbox_pending_age_seconds`` gauge, which is what guards the
    60-second verification-code and 5-minute confirmation SLAs.
    """
    result = await session.execute(
        select(
            func.count(OutboxEmail.id),
            func.min(OutboxEmail.created_at),
        ).where(OutboxEmail.state == OutboxEmailState.PENDING)
    )
    count, oldest = result.one()
    if not count or oldest is None:
        return 0, 0.0
    oldest_at: datetime = oldest
    return int(count), max(0.0, (utc_now() - oldest_at).total_seconds())
