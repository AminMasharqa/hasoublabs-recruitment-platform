"""Transactional email: outbox table, sender adapter, drainer, templates.

Domain services call :func:`enqueue_email` inside their own transaction; nothing
sends mail inline. The worker drains the outbox (see
:mod:`app.platform.mail.tasks`).
"""

from app.platform.mail.config import (
    MailRuntime,
    configure_mail,
    drain_options,
    mail_secret_store,
    mail_sender,
    reset_mail_runtime,
)
from app.platform.mail.models import OutboxEmail, OutboxEmailState
from app.platform.mail.outbox import (
    DrainOptions,
    DrainResult,
    OutboxDrainer,
    enqueue_email,
    pending_backlog,
)
from app.platform.mail.secrets import (
    DEFAULT_SECRET_TTL,
    InMemorySecretStore,
    ShortLivedSecretStore,
    ValkeySecretStore,
)
from app.platform.mail.sender import (
    CollectingMailSender,
    MailSender,
    OutgoingEmail,
    SmtpMailSender,
    SmtpSettings,
)
from app.platform.mail.templates import (
    REQUIRED_PARAMS,
    SECRET_REFS_KEY,
    EmailTemplate,
    RenderedEmail,
    TemplateRenderError,
    missing_params,
    render,
)

__all__ = [
    "DEFAULT_SECRET_TTL",
    "REQUIRED_PARAMS",
    "SECRET_REFS_KEY",
    "CollectingMailSender",
    "DrainOptions",
    "DrainResult",
    "EmailTemplate",
    "InMemorySecretStore",
    "MailRuntime",
    "MailSender",
    "OutboxDrainer",
    "OutboxEmail",
    "OutboxEmailState",
    "OutgoingEmail",
    "RenderedEmail",
    "ShortLivedSecretStore",
    "SmtpMailSender",
    "SmtpSettings",
    "TemplateRenderError",
    "ValkeySecretStore",
    "configure_mail",
    "drain_options",
    "enqueue_email",
    "mail_secret_store",
    "mail_sender",
    "missing_params",
    "pending_backlog",
    "render",
    "reset_mail_runtime",
]
