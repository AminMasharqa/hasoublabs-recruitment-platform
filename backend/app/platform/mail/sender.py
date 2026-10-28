"""The ``MailSender`` interface and its SMTP adapter.

Phase 1 sends through a provider SMTP endpoint with ``aiosmtplib``, kept behind
this interface so switching provider (or moving to a self-hosted Postal
instance) is an adapter swap. Locally, Mailpit captures everything.

Bodies are UTF-8 throughout: Arabic and Hebrew subjects and bodies must survive
unmodified (Localization constraint), which means an explicit charset rather
than the ASCII default.
"""

from __future__ import annotations

from abc import abstractmethod
from dataclasses import dataclass, field
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
import logging
from typing import TYPE_CHECKING, Final, Protocol, runtime_checkable

from app.platform.errors.base import UpstreamUnavailable

if TYPE_CHECKING:
    from collections.abc import Mapping

_LOG = logging.getLogger(__name__)

_DEFAULT_TIMEOUT_SECONDS: Final[float] = 15.0


@dataclass(frozen=True, slots=True)
class OutgoingEmail:
    """One message ready for a transport."""

    to_address: str
    subject: str
    text_body: str
    headers: Mapping[str, str] = field(default_factory=dict)


@runtime_checkable
class MailSender(Protocol):
    """Transport for transactional email."""

    @abstractmethod
    async def send(self, email: OutgoingEmail) -> str:
        """Send ``email`` and return the provider message id.

        Raises:
            UpstreamUnavailable: If the transport is unreachable or rejects the
                message transiently. The outbox drainer retries with backoff.
        """
        ...


@dataclass(frozen=True, slots=True)
class SmtpSettings:
    """Connection settings for :class:`SmtpMailSender`."""

    host: str
    port: int
    username: str = ""
    password: str = ""
    from_address: str = "noreply@hasoublabs.com"
    from_name: str = "HasoubLabs"
    use_tls: bool = False
    start_tls: bool = False
    timeout_seconds: float = _DEFAULT_TIMEOUT_SECONDS


def build_message(email: OutgoingEmail, settings: SmtpSettings) -> EmailMessage:
    """Build a UTF-8 MIME message with a stable ``Message-ID``."""
    message = EmailMessage()
    message["From"] = formataddr((settings.from_name, settings.from_address))
    message["To"] = email.to_address
    message["Subject"] = email.subject
    message["Message-ID"] = make_msgid(domain=settings.from_address.split("@")[-1])
    # Transactional mail must not land in a reply-all thread or be auto-replied to.
    message["Auto-Submitted"] = "auto-generated"
    for name, value in email.headers.items():
        message[name] = value
    message.set_content(email.text_body, subtype="plain", charset="utf-8")
    return message


class SmtpMailSender:
    """:class:`MailSender` over SMTP via ``aiosmtplib``."""

    def __init__(self, settings: SmtpSettings) -> None:
        self._settings = settings

    async def send(self, email: OutgoingEmail) -> str:
        import aiosmtplib  # noqa: PLC0415

        message = build_message(email, self._settings)
        try:
            await aiosmtplib.send(
                message,
                hostname=self._settings.host,
                port=self._settings.port,
                username=self._settings.username or None,
                password=self._settings.password or None,
                use_tls=self._settings.use_tls,
                start_tls=self._settings.start_tls or None,
                timeout=self._settings.timeout_seconds,
            )
        except Exception as exc:
            raise UpstreamUnavailable(
                service="smtp",
                log_message=f"SMTP send failed: {exc}",
            ) from exc
        return str(message["Message-ID"])


@dataclass
class CollectingMailSender:
    """:class:`MailSender` that records messages instead of sending them.

    Used by unit tests and by any local run without a Mailpit container.
    """

    sent: list[OutgoingEmail] = field(default_factory=list)
    fail_next: bool = False

    async def send(self, email: OutgoingEmail) -> str:
        if self.fail_next:
            self.fail_next = False
            raise UpstreamUnavailable(service="smtp", log_message="injected failure")
        self.sent.append(email)
        _LOG.debug("Collected email to %s: %s", email.to_address, email.subject)
        return f"<collected-{len(self.sent)}@localhost>"

    def clear(self) -> None:
        self.sent.clear()
