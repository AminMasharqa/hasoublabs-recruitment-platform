"""ARQ background tasks for the identity module.

Tasks registered here:
- ``expire_verification_codes``: finds stale PendingCode verifications and
  expires them, releasing the email slot (R1 AC17, R2 AC10).
"""

from __future__ import annotations

import logging

from app.platform.jobs.registry import RetryPolicy, task
from app.platform.jobs.catalog import JobName

_LOG = logging.getLogger(__name__)


@task(
    JobName.EXPIRE_VERIFICATION_CODES,
    retry=RetryPolicy(max_tries=3, base_delay_seconds=60),
    timeout_seconds=120,
)
async def expire_verification_codes(ctx: dict) -> dict:
    """Expire stale PendingCode verifications.

    Runs every 5 minutes via APScheduler. For each verification where
    ``expires_at < now`` and state is still PendingCode:
    - Set state = Expired.
    - Set ``email_released = True`` on the account row so the email
      address can be reused.
    """
    from app.platform.db.unit_of_work import UnitOfWork  # noqa: PLC0415
    from app.platform.jobs.runtime import worker_session_factory  # noqa: PLC0415

    session_factory = worker_session_factory()
    uow_factory = lambda: UnitOfWork(session_factory)  # noqa: E731

    from app.modules.identity.service import VerificationService  # noqa: PLC0415
    from app.config import get_settings  # noqa: PLC0415
    import hashlib  # noqa: PLC0415

    settings = get_settings()
    pepper = hashlib.sha256(
        (settings.app_secret_key + ":blind_index").encode()
    ).digest()

    service = VerificationService(
        uow_factory,
        pepper=pepper,
        verification_code_ttl_hours=settings.verification_code_ttl_hours,
        max_attempts=settings.verification_code_max_attempts,
    )
    count = await service.expire_stale_verifications()
    return {"expired": count}
