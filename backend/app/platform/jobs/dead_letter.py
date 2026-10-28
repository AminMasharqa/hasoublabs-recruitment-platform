"""Writing dead-letter rows for terminally failed jobs."""

from __future__ import annotations

from collections.abc import Mapping
import logging
from typing import TYPE_CHECKING, Final

from sqlalchemy.dialects.postgresql import insert

from app.platform.db.base import utc_now
from app.platform.jobs.models import JobDeadLetter
from app.platform.jobs.runtime import optional_session_factory

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy.ext.asyncio import AsyncSession

_LOG = logging.getLogger(__name__)

_MAX_STRING_LENGTH: Final[int] = 500
_MAX_ERROR_LENGTH: Final[int] = 4000
_MAX_DEPTH: Final[int] = 4


def _jsonable(value: object, depth: int = 0) -> object:
    """Coerce a job argument into something JSONB can hold.

    Anything unrecognized becomes a truncated ``repr``: a dead-letter row is a
    diagnostic, and it must never fail to be written because an argument was not
    serializable.
    """
    if value is None or isinstance(value, bool | int | float):
        return value
    if isinstance(value, str):
        return value[:_MAX_STRING_LENGTH]
    if depth >= _MAX_DEPTH:
        return repr(value)[:_MAX_STRING_LENGTH]
    if isinstance(value, Mapping):
        return {
            str(key)[:_MAX_STRING_LENGTH]: _jsonable(item, depth + 1)
            for key, item in value.items()
        }
    if isinstance(value, list | tuple | set | frozenset):
        return [_jsonable(item, depth + 1) for item in value]
    return repr(value)[:_MAX_STRING_LENGTH]


async def record_dead_letter(
    session: AsyncSession,
    *,
    job_name: str,
    job_id: str,
    idempotency_key: str | None,
    args: Sequence[object],
    kwargs: Mapping[str, object],
    attempts: int,
    error: BaseException,
) -> None:
    """Upsert the dead-letter row for a terminally failed job.

    Upsert rather than insert: the same logical job can reach its terminal
    failure again after an operator re-enqueues it, and the dashboard wants one
    row per job with a growing attempt count.
    """
    now = utc_now()
    payload = {"args": _jsonable(list(args)), "kwargs": _jsonable(dict(kwargs))}
    values = {
        "job_name": job_name,
        "job_id": job_id,
        "idempotency_key": idempotency_key,
        "payload": payload,
        "attempts": attempts,
        "error_type": type(error).__name__[:200],
        "error_message": str(error)[:_MAX_ERROR_LENGTH],
        "first_failed_at": now,
        "last_failed_at": now,
    }
    statement = insert(JobDeadLetter).values(**values)
    statement = statement.on_conflict_do_update(
        index_elements=[JobDeadLetter.job_id],
        set_={
            "attempts": JobDeadLetter.attempts + attempts,
            "error_type": statement.excluded.error_type,
            "error_message": statement.excluded.error_message,
            "payload": statement.excluded.payload,
            "last_failed_at": statement.excluded.last_failed_at,
            "resolved_at": None,
            "resolution_note": None,
        },
    )
    await session.execute(statement)


async def record_dead_letter_safely(
    *,
    job_name: str,
    job_id: str,
    idempotency_key: str | None,
    args: Sequence[object],
    kwargs: Mapping[str, object],
    attempts: int,
    error: BaseException,
) -> bool:
    """Write a dead-letter row using the worker runtime's session factory.

    Never raises: the job has already failed, and a failure to record that
    failure must not mask the original error. Returns whether the row landed.
    """
    factory = optional_session_factory()
    if factory is None:
        _LOG.error(
            "Job %s failed terminally but no session factory is configured; "
            "dead-letter row not written",
            job_name,
        )
        return False
    try:
        async with factory() as session:
            await record_dead_letter(
                session,
                job_name=job_name,
                job_id=job_id,
                idempotency_key=idempotency_key,
                args=args,
                kwargs=kwargs,
                attempts=attempts,
                error=error,
            )
            await session.commit()
    except Exception:  # noqa: BLE001 - diagnostics must not raise
        _LOG.exception("Could not write dead-letter row for job %s", job_name)
        return False
    return True
