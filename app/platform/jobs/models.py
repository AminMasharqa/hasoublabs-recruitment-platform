"""Dead-letter table for jobs that exhausted their retries.

A queue without a dead-letter store loses failures silently: ARQ drops a job
after its last attempt and only a log line remains. These rows are what the
Admin operations dashboard reads, and what makes "terminal failures land in a
dead-letter table" (design: Background Job Catalog) inspectable.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, UuidPkMixin, utc_now


class JobDeadLetter(Base, UuidPkMixin):
    """One terminally failed background job, keyed by its queue job id."""

    __tablename__ = "job_dead_letters"

    job_name: Mapped[str] = mapped_column(String(100), nullable=False)

    #: Queue job id (``<job_name>:<digest of idempotency key>``). Unique, so a
    #: repeated terminal failure of the same logical job updates one row instead
    #: of flooding the dashboard.
    job_id: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)

    idempotency_key: Mapped[str | None] = mapped_column(Text, default=None)

    #: Sanitized ``{"args": [...], "kwargs": {...}}``. Job arguments are
    #: identifiers by convention — secrets travel through the short-lived secret
    #: store, never through job payloads.
    payload: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)

    attempts: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    error_type: Mapped[str] = mapped_column(String(200), nullable=False)
    error_message: Mapped[str] = mapped_column(Text, nullable=False)

    first_failed_at: Mapped[datetime] = mapped_column(default=utc_now, nullable=False)
    last_failed_at: Mapped[datetime] = mapped_column(default=utc_now, nullable=False)

    resolved_at: Mapped[datetime | None] = mapped_column(default=None)
    resolution_note: Mapped[str | None] = mapped_column(Text, default=None)

    __table_args__ = (
        Index("idx_job_dead_letters_job_name_last_failed_at", "job_name", "last_failed_at"),
        Index(
            "idx_job_dead_letters_unresolved",
            "last_failed_at",
            postgresql_where="resolved_at IS NULL",
        ),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<JobDeadLetter {self.job_name} attempts={self.attempts}>"
