"""Process-wide mail configuration.

The outbox drainer runs as a background job, so it cannot be handed a sender
through a request scope. The process configures the transport once at startup and
the drain task reads it from here.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.platform.mail.outbox import DrainOptions

if TYPE_CHECKING:
    from app.platform.mail.secrets import ShortLivedSecretStore
    from app.platform.mail.sender import MailSender


@dataclass(slots=True)
class MailRuntime:
    """Transport and options available to the outbox drainer."""

    sender: MailSender | None = None
    secret_store: ShortLivedSecretStore | None = None
    options: DrainOptions = DrainOptions()


_RUNTIME = MailRuntime()


def configure_mail(
    *,
    sender: MailSender | None = None,
    secret_store: ShortLivedSecretStore | None = None,
    options: DrainOptions | None = None,
) -> None:
    """Install the mail transport for this process."""
    if sender is not None:
        _RUNTIME.sender = sender
    if secret_store is not None:
        _RUNTIME.secret_store = secret_store
    if options is not None:
        _RUNTIME.options = options


def reset_mail_runtime() -> None:
    """Clear the mail configuration (tests)."""
    _RUNTIME.sender = None
    _RUNTIME.secret_store = None
    _RUNTIME.options = DrainOptions()


def mail_sender() -> MailSender:
    """Return the configured transport.

    Raises:
        RuntimeError: If no transport was configured. Failing loudly beats
            silently dropping a Verification_Code.
    """
    if _RUNTIME.sender is None:
        msg = "No MailSender configured; call configure_mail()"
        raise RuntimeError(msg)
    return _RUNTIME.sender


def mail_secret_store() -> ShortLivedSecretStore | None:
    """Return the send-time secret store, if one is configured."""
    return _RUNTIME.secret_store


def drain_options() -> DrainOptions:
    """Return the drainer tunables."""
    return _RUNTIME.options
