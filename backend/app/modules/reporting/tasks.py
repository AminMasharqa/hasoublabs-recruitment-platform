"""ARQ background tasks for the reporting module (R28, R29, Section 21).

Tasks registered here:
- ``generate_export``: fetches data, writes a .xlsx file to MinIO using
  XlsxWriter in constant_memory mode, updates the ReportExport row with a
  signed download URL (R29).
- ``refresh_report_rollups``: refreshes the optional report materialized views
  (R28). Reports read live tables today, so this is a no-op until a rollup view
  is introduced — it discovers views from the catalog rather than hard-coding a
  list, so adding one needs no change here.
"""

from __future__ import annotations

import io
import logging
import re
from datetime import datetime, timedelta, UTC
from typing import Final
from uuid import UUID

from app.platform.jobs.catalog import JobName
from app.platform.jobs.registry import RetryPolicy, task

_LOG = logging.getLogger(__name__)

#: Columns and headers per entity type — same as the Admin view (R29 AC4).
_COLUMNS: dict[str, list[str]] = {
    "candidates": ["id", "email", "status", "language_preference", "created_at"],
    "job_descriptions": [
        "id", "title", "company", "location", "status", "employment_type",
        "experience_level", "work_model", "published_at", "closed_at", "created_at",
    ],
    "applications": [
        "id", "candidate_id", "candidate_email", "jd_id", "jd_title", "jd_company",
        "status", "routed_channel", "submitted_at", "created_at",
    ],
}


@task(
    JobName.GENERATE_EXPORT,
    retry=RetryPolicy(max_tries=3, base_delay_seconds=30),
    timeout_seconds=300,  # 5 minutes for large datasets
)
async def generate_export(ctx: dict, *, export_id: str, **_kwargs: object) -> dict:
    """Generate a .xlsx file for the given export job and upload it to MinIO.

    Steps:
    1. Load the ReportExport row and mark it as RUNNING.
    2. Fetch data according to entity_type and stored filters.
    3. Write .xlsx via XlsxWriter in constant_memory mode.
    4. Upload the bytes to MinIO (report-exports bucket).
    5. Generate a signed pre-signed URL (TTL 1 hour).
    6. Mark the row as READY with the download URL.

    On any exception, marks the row as FAILED.
    """
    from app.platform.db.unit_of_work import UnitOfWork  # noqa: PLC0415
    from app.platform.jobs.runtime import worker_session_factory  # noqa: PLC0415
    from app.config import get_settings  # noqa: PLC0415
    from app.modules.reporting import repository as repo  # noqa: PLC0415
    from app.modules.reporting.models import ExportStatus  # noqa: PLC0415

    session_factory = worker_session_factory()
    uow_factory = lambda: UnitOfWork(session_factory)  # noqa: E731
    settings = get_settings()
    export_uuid = UUID(export_id)

    # Step 1: Mark as RUNNING
    async with uow_factory() as uow:
        export = await repo.get_export_job(uow.session, export_uuid)
        if export is None:
            _LOG.error("generate_export: job %s not found", export_id)
            return {"status": "not_found", "export_id": export_id}

        entity_type = export.entity_type
        filters: dict = export.filters_json or {}
        await repo.update_export_status(uow.session, export, ExportStatus.RUNNING)

    try:
        # Parse filters
        date_from: datetime | None = None
        date_to: datetime | None = None
        jd_id: UUID | None = None
        if "date_from" in filters:
            date_from = datetime.fromisoformat(filters["date_from"])
        if "date_to" in filters:
            date_to = datetime.fromisoformat(filters["date_to"])
        if "jd_id" in filters:
            jd_id = UUID(filters["jd_id"])

        # Step 2: Fetch data
        async with uow_factory() as uow:
            if entity_type == "candidates":
                rows = await repo.fetch_candidates_for_export(uow.session)
            elif entity_type == "job_descriptions":
                rows = await repo.fetch_job_descriptions_for_export(uow.session)
            elif entity_type == "applications":
                rows = await repo.fetch_applications_for_export(
                    uow.session, date_from=date_from, date_to=date_to, jd_id=jd_id
                )
            else:
                raise ValueError(f"Unsupported entity type: {entity_type!r}")

        # Step 3: Write .xlsx in constant_memory mode
        xlsx_bytes = _write_xlsx(entity_type, rows)

        # Step 4 & 5: Upload to MinIO and generate pre-signed URL
        object_key, download_url, expires_at = await _upload_and_sign(
            xlsx_bytes=xlsx_bytes,
            entity_type=entity_type,
            export_id=export_id,
            settings=settings,
        )

        # Step 6: Mark as READY
        async with uow_factory() as uow:
            export_row = await repo.get_export_job(uow.session, export_uuid)
            if export_row:
                await repo.update_export_status(
                    uow.session,
                    export_row,
                    ExportStatus.READY,
                    object_key=object_key,
                    download_url=download_url,
                    expires_at=expires_at,
                )

        _LOG.info(
            "generate_export: completed job=%s entity=%s rows=%d",
            export_id, entity_type, len(rows),
        )
        return {"status": "ready", "export_id": export_id, "rows": len(rows)}

    except Exception as exc:  # noqa: BLE001
        _LOG.error("generate_export: failed job=%s: %s", export_id, exc, exc_info=True)
        async with uow_factory() as uow:
            export_row = await repo.get_export_job(uow.session, export_uuid)
            if export_row:
                await repo.update_export_status(
                    uow.session,
                    export_row,
                    ExportStatus.FAILED,
                    error_message=str(exc)[:500],
                )
        raise


#: Postgres identifiers may hold anything when quoted, but a rollup view we are
#: willing to refresh is plain ASCII. The names come from ``pg_matviews``, not
#: from a request, so this is a belt-and-braces guard on interpolated DDL.
_SAFE_IDENTIFIER: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9_]+$")


@task(
    JobName.REFRESH_REPORT_ROLLUPS,
    retry=RetryPolicy(max_tries=2, base_delay_seconds=60),
    timeout_seconds=600,
)
async def refresh_report_rollups(ctx: dict, **_kwargs: object) -> dict:  # noqa: ARG001
    """Refresh every materialized view in the application schema (R28).

    The design lists report rollups as *optional* materialized views: the Admin
    report endpoints aggregate live tables, and a rollup is introduced only if a
    report outgrows that. So this job is a catalog sweep rather than a fixed list
    — it refreshes whatever exists and reports zero when nothing does.

    ``CONCURRENTLY`` is deliberately not used: it cannot run inside a
    transaction block and requires a unique index on the view. A plain refresh
    takes an exclusive lock on a view no request path reads yet.
    """
    from sqlalchemy import text  # noqa: PLC0415

    from app.platform.jobs.runtime import worker_session_factory  # noqa: PLC0415

    session_factory = worker_session_factory()

    async with session_factory() as session:
        rows = (
            await session.execute(
                text(
                    "SELECT schemaname, matviewname FROM pg_matviews"
                    " WHERE schemaname = current_schema()"
                    " ORDER BY matviewname"
                )
            )
        ).all()

        refreshed: list[str] = []
        skipped: list[str] = []
        for schema, view in rows:
            if not (_SAFE_IDENTIFIER.match(schema) and _SAFE_IDENTIFIER.match(view)):
                _LOG.warning("refresh_report_rollups: skipping unsafe name %r.%r", schema, view)
                skipped.append(f"{schema}.{view}")
                continue
            await session.execute(text(f'REFRESH MATERIALIZED VIEW "{schema}"."{view}"'))
            refreshed.append(view)

        await session.commit()

    if refreshed:
        _LOG.info("refresh_report_rollups: refreshed %s", ", ".join(refreshed))
    return {"status": "ok", "refreshed": refreshed, "skipped": skipped}


def _write_xlsx(entity_type: str, rows: list[dict]) -> bytes:
    """Write rows to a .xlsx file using XlsxWriter in constant_memory mode.

    Returns the file contents as bytes.
    """
    import xlsxwriter  # noqa: PLC0415

    columns = _COLUMNS.get(entity_type, list(rows[0].keys()) if rows else [])

    output = io.BytesIO()
    workbook = xlsxwriter.Workbook(output, {"constant_memory": True, "in_memory": True})
    worksheet = workbook.add_worksheet(entity_type[:31])  # Excel sheet name ≤ 31 chars

    # Header row
    header_fmt = workbook.add_format({"bold": True})
    for col_idx, col_name in enumerate(columns):
        worksheet.write(0, col_idx, col_name, header_fmt)

    # Data rows
    for row_idx, row in enumerate(rows, start=1):
        for col_idx, col_name in enumerate(columns):
            value = row.get(col_name, "")
            worksheet.write(row_idx, col_idx, value)

    workbook.close()
    return output.getvalue()


async def _upload_and_sign(
    *,
    xlsx_bytes: bytes,
    entity_type: str,
    export_id: str,
    settings: object,
) -> tuple[str, str, datetime]:
    """Upload .xlsx bytes to MinIO and return (object_key, download_url, expires_at)."""
    import asyncio  # noqa: PLC0415
    from minio import Minio  # noqa: PLC0415
    from minio.commonconfig import CopySource  # noqa: PLC0415
    import io as _io  # noqa: PLC0415

    object_key = f"exports/{entity_type}/{export_id}.xlsx"
    bucket = "report-exports"
    ttl_seconds = 3600  # 1 hour

    # Build MinIO client inline (we can't inject object_store easily into an ARQ task)
    endpoint: str = getattr(settings, "minio_endpoint", "localhost:9000")
    access_key: str = getattr(settings, "minio_access_key", "")
    secret_key: str = getattr(settings, "minio_secret_key", "")
    secure: bool = getattr(settings, "minio_secure", False)

    def _sync_upload() -> str:
        """Synchronous MinIO upload — run in thread executor."""
        client = Minio(endpoint, access_key=access_key, secret_key=secret_key, secure=secure)
        # Ensure bucket exists
        if not client.bucket_exists(bucket):
            client.make_bucket(bucket)
        # Upload
        data_stream = _io.BytesIO(xlsx_bytes)
        client.put_object(
            bucket, object_key, data_stream, length=len(xlsx_bytes),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        # Pre-signed URL
        url = client.presigned_get_object(bucket, object_key, expires=timedelta(seconds=ttl_seconds))
        return url

    loop = asyncio.get_event_loop()
    download_url = await loop.run_in_executor(None, _sync_upload)
    expires_at = datetime.now(UTC).replace(tzinfo=None) + timedelta(seconds=ttl_seconds)
    return object_key, download_url, expires_at
