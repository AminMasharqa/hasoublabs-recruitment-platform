"""Service layer for the job collection pipeline (R23).

Responsibilities:
- CRUD for JobSource configurations.
- ``trigger_collect``: creates a run, enqueues the ARQ task and returns the DTO.
- ``collect_source``: the actual collection loop (called by the ARQ task).
- ``list_runs``: paginated run history per source.
- ``list_flags`` / ``resolve_flag``: admin flag review workflow.

Design rules observed:
- Never imports fastapi.
- Every mutating operation runs inside exactly one UnitOfWork (or one per atomic
  sub-operation for the per-listing loop, as documented below).
- Never calls session.commit() or session.rollback() directly.
- ``SYSTEM_ACCOUNT_ID`` is used as the creator when the collection pipeline
  creates JobDescriptions autonomously.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING
import uuid  # noqa: TC003 — used in _SourceSnapshot.__init__ at runtime

from app.modules.jobs import collection_repository as collection_repo
from app.modules.jobs import repository as jobs_repo
from app.modules.jobs.errors import DuplicateSourceUrl, JobSourceNotFound
from app.modules.jobs.schemas import (
    CollectionRunDTO,
    FlagResolveResponse,
    JobDescriptionFlagDTO,
    JobSourceCreateRequest,
    JobSourceDTO,
    JobSourceUpdateRequest,
)
from app.modules.jobs.source_adapters import FieldMapper, get_adapter
from app.platform.db.constants import SYSTEM_ACCOUNT_ID
from app.platform.db.enums import (
    CollectionRunStatus,
    EmploymentType,
    ExperienceLevel,
    JobSourceType,
    WorkModel,
)
from app.platform.jobs.catalog import JobName
from app.platform.security.errors import AuthorizationDenied

if TYPE_CHECKING:
    from collections.abc import Callable
    from contextlib import AbstractAsyncContextManager

    from app.modules.jobs.models import JobCollectionRun
    from app.modules.jobs.schemas import FlagResolveRequest
    from app.platform.db.unit_of_work import UnitOfWork
    from app.platform.jobs.queue import ArqTaskQueue

_LOG = logging.getLogger(__name__)


class JobCollectionService:
    """Service for job source management and the collection pipeline (R23)."""

    def __init__(
        self,
        uow_factory: Callable[[], AbstractAsyncContextManager[UnitOfWork]],
        *,
        task_queue: ArqTaskQueue,
    ) -> None:
        self._uow_factory = uow_factory
        self._task_queue = task_queue

    # ── Source CRUD ───────────────────────────────────────────────────────────

    async def create_source(self, data: JobSourceCreateRequest) -> JobSourceDTO:
        """Create a new job source.

        Raises:
            DuplicateSourceUrl: if a source with the same type and slug already exists.
        """
        async with self._uow_factory() as uow:
            existing = await collection_repo.get_source_by_type_slug(
                uow.session, data.source_type, data.slug
            )
            if existing is not None:
                raise DuplicateSourceUrl()
            source = await collection_repo.create_source(
                uow.session,
                name=data.name,
                source_type=data.source_type,
                slug=data.slug,
                workday_tenant=data.workday_tenant,
                workday_site=data.workday_site,
                poll_interval_hours=data.poll_interval_hours,
            )
            return JobSourceDTO.model_validate(source)

    async def get_source(self, source_id: uuid.UUID) -> JobSourceDTO:
        """Fetch a job source by id.

        Raises:
            JobSourceNotFound: if the source does not exist.
        """
        async with self._uow_factory() as uow:
            source = await collection_repo.get_source(uow.session, source_id)
            if source is None:
                raise JobSourceNotFound()
            return JobSourceDTO.model_validate(source)

    async def list_sources(
        self,
        *,
        enabled_only: bool = False,
        after_id: uuid.UUID | None = None,
        limit: int = 20,
    ) -> list[JobSourceDTO]:
        """Return a paginated list of job sources."""
        async with self._uow_factory() as uow:
            sources = await collection_repo.list_sources(
                uow.session,
                enabled_only=enabled_only,
                after_id=after_id,
                limit=limit,
            )
            return [JobSourceDTO.model_validate(s) for s in sources]

    async def update_source(
        self, source_id: uuid.UUID, data: JobSourceUpdateRequest
    ) -> JobSourceDTO:
        """Update a job source.

        Raises:
            JobSourceNotFound: if the source does not exist.
        """
        async with self._uow_factory() as uow:
            source = await collection_repo.get_source(uow.session, source_id)
            if source is None:
                raise JobSourceNotFound()
            updates = data.model_dump(exclude_none=True)
            if updates:
                await collection_repo.update_source(uow.session, source, **updates)
            return JobSourceDTO.model_validate(source)

    async def delete_source(self, source_id: uuid.UUID) -> None:
        """Delete a job source.

        Raises:
            JobSourceNotFound: if the source does not exist.
        """
        async with self._uow_factory() as uow:
            source = await collection_repo.get_source(uow.session, source_id)
            if source is None:
                raise JobSourceNotFound()
            await collection_repo.delete_source(uow.session, source)

    # ── Collection lifecycle ──────────────────────────────────────────────────

    async def trigger_collect(self, source_id: uuid.UUID) -> CollectionRunDTO:
        """Create a collection run and enqueue the ARQ task.

        The run is created in RUNNING status so the caller immediately sees
        the new run's id.  The ARQ task calls ``collect_source`` with the
        pre-created run_id so both paths share one run row.

        Raises:
            JobSourceNotFound: if the source does not exist.
        """
        async with self._uow_factory() as uow:
            source = await collection_repo.get_source(uow.session, source_id)
            if source is None:
                raise JobSourceNotFound()
            run = await collection_repo.create_run(uow.session, source_id=source_id)
            # Flush to obtain run.id before we enqueue.
            await uow.session.flush()
            run_dto = CollectionRunDTO.model_validate(run)

        # Enqueue after the UoW commits so the task sees the run row.
        await self._task_queue.enqueue(
            JobName.COLLECT_JOBS_FOR_SOURCE,
            idempotency_key=str(run_dto.id),
            source_id=str(source_id),
            run_id=str(run_dto.id),
        )
        return run_dto

    async def collect_source(
        self,
        source_id: uuid.UUID,
        run_id: uuid.UUID | None = None,
    ) -> CollectionRunDTO:
        """Execute the collection loop for one source.

        When ``run_id`` is None the method creates a new run inside the initial
        UoW.  When ``run_id`` is provided (the on-demand path, pre-created by
        ``trigger_collect``) the method loads the existing run.

        Per-listing writes use isolated short-lived UoWs so a single bad listing
        cannot roll back the entire batch.
        """
        # ── 1. Load source and acquire / create the run ───────────────────────
        async with self._uow_factory() as uow:
            source = await collection_repo.get_source(uow.session, source_id)
            if source is None:
                raise JobSourceNotFound()

            run: JobCollectionRun
            if run_id is None:
                run = await collection_repo.create_run(uow.session, source_id=source_id)
                await uow.session.flush()
            else:
                existing_run = await collection_repo.get_run(uow.session, run_id)
                if existing_run is None:
                    # Pre-created run is gone — create a new one defensively.
                    run = await collection_repo.create_run(uow.session, source_id=source_id)
                    await uow.session.flush()
                else:
                    run = existing_run

            current_run_id: uuid.UUID = run.id
            # Take a snapshot of the source fields we need outside this UoW.
            source_snapshot = _SourceSnapshot(
                id=source.id,
                source_type=source.source_type,
                slug=source.slug,
                workday_tenant=source.workday_tenant,
                workday_site=source.workday_site,
            )

        # ── 2. Fetch listings from the adapter ────────────────────────────────
        adapter = get_adapter(source_snapshot.source_type)
        try:
            listings = await adapter.fetch(source_snapshot)
        except Exception as exc:  # noqa: BLE001
            _LOG.warning(
                "collect_source: adapter.fetch failed for source %s: %s",
                source_id,
                exc,
            )
            async with self._uow_factory() as fail_uow:
                fail_run = await collection_repo.get_run(fail_uow.session, current_run_id)
                if fail_run is not None:
                    await collection_repo.finish_run(
                        fail_uow.session,
                        fail_run,
                        status=CollectionRunStatus.FAILED,
                        jobs_fetched=0,
                        jobs_created=0,
                        jobs_skipped=0,
                        jobs_flagged=0,
                        error_detail=str(exc),
                    )
                    return CollectionRunDTO.model_validate(fail_run)
            # If get_run also fails, re-raise to let the caller handle it.
            raise  # pragma: no cover

        # ── 3. Process each listing ───────────────────────────────────────────
        jobs_fetched = len(listings)
        jobs_created = 0
        jobs_skipped = 0
        jobs_flagged = 0
        mapper = FieldMapper()

        for listing in listings:
            # 3a. Duplicate-URL check — short-lived UoW.
            if listing.external_url:
                async with self._uow_factory() as check_uow:
                    already_exists = await collection_repo.external_url_exists(
                        check_uow.session, listing.external_url
                    )
                if already_exists:
                    jobs_skipped += 1
                    continue

            # 3b. Map fields.
            mapped_fields, missing_fields = mapper.map(listing)

            if missing_fields:
                # 3c. Flag incomplete listing.
                async with self._uow_factory() as flag_uow:
                    await collection_repo.create_flag(
                        flag_uow.session,
                        source_id=source_id,
                        run_id=current_run_id,
                        external_url=listing.external_url or "",
                        raw_payload=listing.raw_payload,
                        missing_fields=missing_fields,
                    )
                jobs_flagged += 1
            else:
                # 3d. Create Draft JD.
                async with self._uow_factory() as jd_uow:
                    raw_wm = mapped_fields.get("work_model")
                    raw_et = mapped_fields.get("employment_type")
                    raw_el = mapped_fields.get("experience_level")
                    raw_loc = mapped_fields.get("location")
                    raw_desc = mapped_fields.get("description")
                    raw_url = mapped_fields.get("external_url")
                    await jobs_repo.create_jd(
                        jd_uow.session,
                        creator_account_id=SYSTEM_ACCOUNT_ID,
                        title=str(mapped_fields["title"]),
                        company=str(mapped_fields["company"]),
                        location=str(raw_loc) if raw_loc is not None else None,
                        work_model=_coerce_work_model(
                            str(raw_wm) if raw_wm is not None else None
                        ),
                        employment_type=_coerce_employment_type(
                            str(raw_et) if raw_et is not None else None
                        ),
                        experience_level=_coerce_experience_level(
                            str(raw_el) if raw_el is not None else None
                        ),
                        description=str(raw_desc) if raw_desc is not None else None,
                        external_url=str(raw_url) if raw_url is not None else None,
                        application_channel=None,
                    )
                jobs_created += 1

        # ── 4. Finish run ─────────────────────────────────────────────────────
        async with self._uow_factory() as finish_uow:
            finish_run = await collection_repo.get_run(finish_uow.session, current_run_id)
            if finish_run is not None:
                await collection_repo.finish_run(
                    finish_uow.session,
                    finish_run,
                    status=CollectionRunStatus.COMPLETED,
                    jobs_fetched=jobs_fetched,
                    jobs_created=jobs_created,
                    jobs_skipped=jobs_skipped,
                    jobs_flagged=jobs_flagged,
                    error_detail=None,
                )
                return CollectionRunDTO.model_validate(finish_run)

        # Defensive fallback — finish_run was not found (should not happen).
        _LOG.error(  # pragma: no cover
            "collect_source: run %s not found when finishing", current_run_id
        )
        raise RuntimeError(f"Run {current_run_id} not found when finishing")  # pragma: no cover

    # ── Run history ───────────────────────────────────────────────────────────

    async def list_runs(
        self,
        source_id: uuid.UUID,
        *,
        after_id: uuid.UUID | None = None,
        limit: int = 20,
    ) -> list[CollectionRunDTO]:
        """Return paginated collection runs for a source."""
        async with self._uow_factory() as uow:
            runs = await collection_repo.list_runs(
                uow.session,
                source_id,
                after_id=after_id,
                limit=limit,
            )
            return [CollectionRunDTO.model_validate(r) for r in runs]

    # ── Flag review ───────────────────────────────────────────────────────────

    async def list_flags(
        self,
        *,
        resolved: bool = False,
        after_id: uuid.UUID | None = None,
        limit: int = 20,
    ) -> list[JobDescriptionFlagDTO]:
        """Return paginated flagged job descriptions."""
        async with self._uow_factory() as uow:
            flags = await collection_repo.list_flags(
                uow.session,
                resolved=resolved,
                after_id=after_id,
                limit=limit,
            )
            return [JobDescriptionFlagDTO.model_validate(f) for f in flags]

    async def resolve_flag(
        self,
        flag_id: uuid.UUID,
        data: FlagResolveRequest,
        resolver_account_id: uuid.UUID,
    ) -> FlagResolveResponse:
        """Resolve a flagged job description.

        If ``action == "create_jd"``, a Draft JD is created within the same
        UoW as the flag resolution, so both succeed or fail atomically.
        If ``action == "dismiss"``, only the flag is marked resolved.

        Raises:
            AuthorizationDenied: if the flag does not exist.
        """
        async with self._uow_factory() as uow:
            flag = await collection_repo.get_flag(uow.session, flag_id)
            if flag is None:
                raise AuthorizationDenied()

            jd_id: uuid.UUID | None = None

            if data.action == "create_jd" and data.jd_data is not None:
                jd = await jobs_repo.create_jd(
                    uow.session,
                    creator_account_id=resolver_account_id,
                    title=data.jd_data.title,
                    company=data.jd_data.company,
                    location=data.jd_data.location,
                    work_model=data.jd_data.work_model,
                    employment_type=data.jd_data.employment_type,
                    experience_level=data.jd_data.experience_level,
                    description=data.jd_data.description,
                    external_url=data.jd_data.external_url,
                    application_channel=data.jd_data.application_channel,
                )
                jd_id = jd.id

            await collection_repo.resolve_flag(
                uow.session, flag, resolved_by=resolver_account_id
            )

        return FlagResolveResponse(
            flag_id=flag_id,
            status="resolved",
            job_description_id=jd_id,
        )


# ── Helpers ───────────────────────────────────────────────────────────────────


class _SourceSnapshot:
    """Lightweight snapshot of JobSource fields needed outside the initial UoW.

    The ORM object is detached once the UoW closes; we capture only what the
    adapter and downstream code need so we never touch an expired instance.
    """

    __slots__ = (
        "id",
        "source_type",
        "slug",
        "workday_tenant",
        "workday_site",
    )

    def __init__(
        self,
        *,
        id: uuid.UUID,  # noqa: A002
        source_type: JobSourceType,
        slug: str,
        workday_tenant: str | None,
        workday_site: str | None,
    ) -> None:
        self.id = id
        self.source_type = source_type
        self.slug = slug
        self.workday_tenant = workday_tenant
        self.workday_site = workday_site


def _coerce_work_model(value: str | None) -> WorkModel | None:
    """Try to coerce a string into a WorkModel enum; return None on failure."""
    if value is None:
        return None
    try:
        return WorkModel(value)
    except ValueError:
        return None


def _coerce_employment_type(value: str | None) -> EmploymentType | None:
    """Try to coerce a string into an EmploymentType enum; return None on failure."""
    if value is None:
        return None
    try:
        return EmploymentType(value)
    except ValueError:
        return None


def _coerce_experience_level(value: str | None) -> ExperienceLevel | None:
    """Try to coerce a string into an ExperienceLevel enum; return None on failure."""
    if value is None:
        return None
    try:
        return ExperienceLevel(value)
    except ValueError:
        return None


__all__ = ["JobCollectionService"]
