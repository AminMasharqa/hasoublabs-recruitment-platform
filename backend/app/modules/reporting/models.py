"""ORM models for the reporting module (R28, R29, Section 21).

The only new table in this module is ``report_exports`` — a job-tracking row
created when an Admin requests an async .xlsx export.  All report *data* comes
from read-only queries against existing tables (accounts, cv_versions,
applications, job_descriptions) rather than from separate aggregate tables, so
no other new models are needed for Phase 1.

``report_exports`` lifecycle:
  pending  → the ARQ job has been enqueued but not yet started.
  running  → the worker picked up the job and is writing the file.
  ready    → the file is in MinIO; a signed download URL is available.
  failed   → the job errored out; ``error_message`` is set.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, UuidPkMixin, UtcTimestampMs, utc_now


class ExportStatus(StrEnum):
    """Lifecycle state of an async report export job."""

    PENDING = "pending"
    RUNNING = "running"
    READY = "ready"
    FAILED = "failed"


_export_status_sa = sa.Enum(
    ExportStatus,
    name="export_status",
    values_callable=lambda e: [m.value for m in e],
)


class ReportExport(Base, UuidPkMixin):
    """Tracks one Admin-requested async data export (R29).

    Columns
    -------
    entity_type     ``"candidates"`` | ``"job_descriptions"`` | ``"applications"``
    status          ``pending`` → ``running`` → ``ready`` | ``failed``
    filters_json    The filter params applied at request time (date_range, jd_id, etc.)
    object_key      MinIO object key — populated when status = ready.
    download_url    Signed, short-lived pre-signed URL — populated when ready.
    expires_at      When the download URL expires.
    requested_by    Account UUID of the Admin who triggered the export.
    error_message   Set on failure.
    created_at      When the export was requested.
    updated_at      Last status update.
    """

    __tablename__ = "report_exports"

    entity_type: Mapped[str] = mapped_column(sa.String(50), nullable=False)
    status: Mapped[ExportStatus] = mapped_column(
        _export_status_sa,
        nullable=False,
        default=ExportStatus.PENDING,
        server_default="pending",
    )
    filters_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    object_key: Mapped[str | None] = mapped_column(sa.String(512), nullable=True)
    download_url: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(UtcTimestampMs, nullable=True)
    requested_by: Mapped[str] = mapped_column(
        sa.String(36), nullable=False
    )  # UUID stored as string (no FK, actor may be deleted)
    error_message: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        UtcTimestampMs, nullable=False, default=utc_now, server_default=sa.func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        UtcTimestampMs, nullable=False, default=utc_now, server_default=sa.func.now()
    )

    __table_args__ = (
        sa.Index("idx_report_exports_requested_by", "requested_by"),
        sa.Index("idx_report_exports_status", "status"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<ReportExport {self.id} entity={self.entity_type} status={self.status}>"


__all__ = ["ExportStatus", "ReportExport"]
