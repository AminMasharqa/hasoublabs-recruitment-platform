"""Background tasks owned by the mail layer.

Importing this module registers the tasks; ``app/worker.py`` does that before it
builds the ARQ settings.
"""

from __future__ import annotations

from typing import Any

from app.platform.jobs.catalog import JobName
from app.platform.jobs.registry import RetryPolicy, task
from app.platform.jobs.runtime import worker_session_factory
from app.platform.mail.config import drain_options, mail_secret_store, mail_sender
from app.platform.mail.outbox import OutboxDrainer


@task(
    JobName.DRAIN_EMAIL_OUTBOX,
    # The schedule fires every 10 seconds, so a failed pass is picked up by the
    # next tick; long retry chains would only pile up overlapping drains.
    retry=RetryPolicy(max_tries=2, base_delay_seconds=5.0),
    timeout_seconds=60.0,
)
async def drain_email_outbox(ctx: dict[str, Any]) -> dict[str, int]:  # noqa: ARG001
    """Send one batch of due outbox emails."""
    drainer = OutboxDrainer(
        session_factory=worker_session_factory(),
        sender=mail_sender(),
        secret_store=mail_secret_store(),
        options=drain_options(),
    )
    result = await drainer.drain_once()
    return result.as_dict()
