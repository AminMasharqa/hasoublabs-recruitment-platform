"""Unit tests for JobCollectionService (Task 7, R23)."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
import uuid

import pytest

from app.modules.jobs.collection_service import JobCollectionService
from app.modules.jobs.source_adapters import RawJobListing

# ── Helpers ────────────────────────────────────────────────────────────────────


def _make_mock_uow() -> MagicMock:
    """Return a UoW mock that works as an async context manager."""
    uow = MagicMock()
    uow.session = MagicMock()
    return uow


def _uow_factory_for(uow: MagicMock):  # type: ignore[return]
    """Return a callable that always yields the given UoW mock."""

    @asynccontextmanager
    async def _factory():  # type: ignore[return]
        yield uow

    return _factory


def _multi_uow_factory(uow_list: list[MagicMock]):  # type: ignore[return]
    """Return a callable that yields UoW mocks in sequence from ``uow_list``.

    Each ``async with _factory()`` call pops the first item.  Tests that need
    more than one UoW (the per-listing loop) should build a list long enough
    to cover every ``async with self._uow_factory()`` call in the method.
    """
    pool = list(uow_list)

    @asynccontextmanager
    async def _factory():  # type: ignore[return]
        yield pool.pop(0)

    return _factory


def _make_task_queue() -> MagicMock:
    queue = MagicMock()
    queue.enqueue = AsyncMock(return_value="job-id")
    return queue


# ── collect_source: successful full mapping → creates Draft JD ────────────────


@pytest.mark.asyncio
async def test_collect_creates_draft_jd_for_complete_listing() -> None:
    """A complete listing (all required fields present) should create a JD."""
    source_id = uuid.uuid4()
    run_id = uuid.uuid4()

    listing = RawJobListing(
        title="SWE",
        company="Acme",
        location="TLV",
        work_model="Remote",
        employment_type="Full-time",
        experience_level="Mid-level",
        description="A great job with lots of detail",
        external_url="https://boards.greenhouse.io/acme/jobs/1",
        raw_payload={},
    )

    # Build mock source and run ORM objects.
    mock_source = MagicMock()
    mock_source.id = source_id
    mock_source.source_type = "greenhouse"
    mock_source.slug = "acme"
    mock_source.workday_tenant = None
    mock_source.workday_site = None

    mock_run = MagicMock()
    mock_run.id = run_id
    mock_run.source_id = source_id

    # UoW pool: init UoW, check_url UoW, create_jd UoW, finish UoW.
    uow_init = _make_mock_uow()
    uow_check = _make_mock_uow()
    uow_jd = _make_mock_uow()
    uow_finish = _make_mock_uow()
    uow_finish_run = MagicMock()
    uow_finish_run.id = run_id
    uow_finish_run.source_id = source_id

    factory = _multi_uow_factory([uow_init, uow_check, uow_jd, uow_finish])

    with (
        patch(
            "app.modules.jobs.collection_service.collection_repo"
        ) as mock_collection_repo,
        patch("app.modules.jobs.collection_service.jobs_repo") as mock_jobs_repo,
        patch("app.modules.jobs.collection_service.get_adapter") as mock_get_adapter,
    ):
        # init UoW: get_source → source; create_run → run
        mock_collection_repo.get_source = AsyncMock(return_value=mock_source)
        mock_collection_repo.create_run = AsyncMock(return_value=mock_run)
        uow_init.session.flush = AsyncMock()

        # adapter
        mock_adapter = MagicMock()
        mock_adapter.fetch = AsyncMock(return_value=[listing])
        mock_get_adapter.return_value = mock_adapter

        # check UoW: external_url_exists → False
        mock_collection_repo.external_url_exists = AsyncMock(return_value=False)

        # jd UoW: create_jd
        mock_jd = MagicMock()
        mock_jd.id = uuid.uuid4()
        mock_jobs_repo.create_jd = AsyncMock(return_value=mock_jd)

        # finish UoW: get_run → finish_run; get_source → update last_polled_at
        mock_collection_repo.get_run = AsyncMock(return_value=uow_finish_run)
        mock_collection_repo.finish_run = AsyncMock()
        mock_collection_repo.update_source = AsyncMock()

        from app.platform.db.enums import CollectionRunStatus

        uow_finish_run.status = CollectionRunStatus.COMPLETED
        uow_finish_run.finished_at = None
        uow_finish_run.jobs_fetched = 1
        uow_finish_run.jobs_created = 1
        uow_finish_run.jobs_skipped = 0
        uow_finish_run.jobs_flagged = 0
        uow_finish_run.error_detail = None
        uow_finish_run.started_at = MagicMock()

        svc = JobCollectionService(factory, task_queue=_make_task_queue())
        result = await svc.collect_source(source_id)

    # create_jd must be called once with SYSTEM_ACCOUNT_ID.
    from app.platform.db.constants import SYSTEM_ACCOUNT_ID

    mock_jobs_repo.create_jd.assert_called_once()
    call_kwargs = mock_jobs_repo.create_jd.call_args.kwargs
    assert call_kwargs["creator_account_id"] == SYSTEM_ACCOUNT_ID
    assert result is not None


# ── collect_source: incomplete listing → creates flag ─────────────────────────


@pytest.mark.asyncio
async def test_collect_creates_flag_for_incomplete_listing() -> None:
    """A listing with a missing required field must be flagged; no JD created."""
    source_id = uuid.uuid4()
    run_id = uuid.uuid4()

    listing = RawJobListing(
        title="SWE",
        company="Acme",
        location="TLV",
        work_model=None,  # missing required field
        employment_type="Full-time",
        experience_level="Mid-level",
        description="Some job",
        external_url="https://boards.greenhouse.io/acme/jobs/2",
        raw_payload={"raw": True},
    )

    mock_source = MagicMock()
    mock_source.id = source_id
    mock_source.source_type = "greenhouse"
    mock_source.slug = "acme"
    mock_source.workday_tenant = None
    mock_source.workday_site = None

    mock_run = MagicMock()
    mock_run.id = run_id
    mock_run.source_id = source_id

    uow_init = _make_mock_uow()
    uow_check = _make_mock_uow()
    uow_flag = _make_mock_uow()
    uow_finish = _make_mock_uow()

    factory = _multi_uow_factory([uow_init, uow_check, uow_flag, uow_finish])

    with (
        patch(
            "app.modules.jobs.collection_service.collection_repo"
        ) as mock_collection_repo,
        patch("app.modules.jobs.collection_service.jobs_repo") as mock_jobs_repo,
        patch("app.modules.jobs.collection_service.get_adapter") as mock_get_adapter,
    ):
        mock_collection_repo.get_source = AsyncMock(return_value=mock_source)
        mock_collection_repo.create_run = AsyncMock(return_value=mock_run)
        uow_init.session.flush = AsyncMock()

        mock_adapter = MagicMock()
        mock_adapter.fetch = AsyncMock(return_value=[listing])
        mock_get_adapter.return_value = mock_adapter

        mock_collection_repo.external_url_exists = AsyncMock(return_value=False)
        mock_flag = MagicMock()
        mock_collection_repo.create_flag = AsyncMock(return_value=mock_flag)
        mock_jobs_repo.create_jd = AsyncMock()

        mock_finish_run = MagicMock()
        mock_finish_run.id = run_id
        mock_finish_run.source_id = source_id
        from app.platform.db.enums import CollectionRunStatus

        mock_finish_run.status = CollectionRunStatus.COMPLETED
        mock_finish_run.finished_at = None
        mock_finish_run.jobs_fetched = 1
        mock_finish_run.jobs_created = 0
        mock_finish_run.jobs_skipped = 0
        mock_finish_run.jobs_flagged = 1
        mock_finish_run.error_detail = None
        mock_finish_run.started_at = MagicMock()
        mock_collection_repo.get_run = AsyncMock(return_value=mock_finish_run)
        mock_collection_repo.finish_run = AsyncMock()
        mock_collection_repo.update_source = AsyncMock()

        svc = JobCollectionService(factory, task_queue=_make_task_queue())
        await svc.collect_source(source_id)

    # create_flag must be called with missing_fields including "work_model".
    mock_collection_repo.create_flag.assert_called_once()
    call_kwargs = mock_collection_repo.create_flag.call_args.kwargs
    assert "work_model" in call_kwargs["missing_fields"]

    # create_jd must NOT be called.
    mock_jobs_repo.create_jd.assert_not_called()


# ── collect_source: duplicate external_url → skip ─────────────────────────────


@pytest.mark.asyncio
async def test_collect_skips_duplicate_external_url() -> None:
    """When external_url_exists returns True, neither create_jd nor create_flag is called."""
    source_id = uuid.uuid4()
    run_id = uuid.uuid4()

    listing = RawJobListing(
        title="SWE",
        company="Acme",
        location="TLV",
        work_model="Remote",
        employment_type="Full-time",
        experience_level="Mid-level",
        description="Existing job",
        external_url="https://boards.greenhouse.io/acme/jobs/existing",
        raw_payload={},
    )

    mock_source = MagicMock()
    mock_source.id = source_id
    mock_source.source_type = "greenhouse"
    mock_source.slug = "acme"
    mock_source.workday_tenant = None
    mock_source.workday_site = None

    mock_run = MagicMock()
    mock_run.id = run_id
    mock_run.source_id = source_id

    uow_init = _make_mock_uow()
    uow_check = _make_mock_uow()
    uow_finish = _make_mock_uow()

    factory = _multi_uow_factory([uow_init, uow_check, uow_finish])

    with (
        patch(
            "app.modules.jobs.collection_service.collection_repo"
        ) as mock_collection_repo,
        patch("app.modules.jobs.collection_service.jobs_repo") as mock_jobs_repo,
        patch("app.modules.jobs.collection_service.get_adapter") as mock_get_adapter,
    ):
        mock_collection_repo.get_source = AsyncMock(return_value=mock_source)
        mock_collection_repo.create_run = AsyncMock(return_value=mock_run)
        uow_init.session.flush = AsyncMock()

        mock_adapter = MagicMock()
        mock_adapter.fetch = AsyncMock(return_value=[listing])
        mock_get_adapter.return_value = mock_adapter

        # URL already exists.
        mock_collection_repo.external_url_exists = AsyncMock(return_value=True)
        mock_collection_repo.create_flag = AsyncMock()
        mock_jobs_repo.create_jd = AsyncMock()

        mock_finish_run = MagicMock()
        mock_finish_run.id = run_id
        mock_finish_run.source_id = source_id
        from app.platform.db.enums import CollectionRunStatus

        mock_finish_run.status = CollectionRunStatus.COMPLETED
        mock_finish_run.finished_at = None
        mock_finish_run.jobs_fetched = 1
        mock_finish_run.jobs_created = 0
        mock_finish_run.jobs_skipped = 1
        mock_finish_run.jobs_flagged = 0
        mock_finish_run.error_detail = None
        mock_finish_run.started_at = MagicMock()
        mock_collection_repo.get_run = AsyncMock(return_value=mock_finish_run)
        mock_collection_repo.finish_run = AsyncMock()
        mock_collection_repo.update_source = AsyncMock()

        svc = JobCollectionService(factory, task_queue=_make_task_queue())
        await svc.collect_source(source_id)

    mock_jobs_repo.create_jd.assert_not_called()
    mock_collection_repo.create_flag.assert_not_called()


# ── create_source: duplicate type+slug raises DuplicateSourceUrl ──────────────


@pytest.mark.asyncio
async def test_create_source_raises_on_duplicate_type_slug() -> None:
    """get_source_by_type_slug returning an existing source raises DuplicateSourceUrl."""
    from app.modules.jobs.errors import DuplicateSourceUrl
    from app.modules.jobs.schemas import JobSourceCreateRequest
    from app.platform.db.enums import JobSourceType

    existing_source = MagicMock()
    uow = _make_mock_uow()
    factory = _uow_factory_for(uow)

    with patch(
        "app.modules.jobs.collection_service.collection_repo"
    ) as mock_collection_repo:
        mock_collection_repo.get_source_by_type_slug = AsyncMock(
            return_value=existing_source
        )

        svc = JobCollectionService(factory, task_queue=_make_task_queue())
        request = JobSourceCreateRequest(
            name="Acme Jobs",
            source_type=JobSourceType.GREENHOUSE,
            slug="acme",
            poll_interval_hours=6,
        )

        with pytest.raises(DuplicateSourceUrl):
            await svc.create_source(request)


# ── collect_source: run counters ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_collect_source_run_counters_are_correct() -> None:
    """3 listings (1 complete, 1 incomplete, 1 duplicate) → correct finish_run counters."""
    source_id = uuid.uuid4()
    run_id = uuid.uuid4()

    listing_complete = RawJobListing(
        title="SWE",
        company="Acme",
        location="TLV",
        work_model="Remote",
        employment_type="Full-time",
        experience_level="Mid-level",
        description="Complete listing",
        external_url="https://boards.greenhouse.io/acme/jobs/1",
        raw_payload={},
    )
    listing_incomplete = RawJobListing(
        title="PM",
        company="Acme",
        location="TLV",
        work_model=None,  # missing
        employment_type="Full-time",
        experience_level="Senior-level",
        description="Incomplete listing",
        external_url="https://boards.greenhouse.io/acme/jobs/2",
        raw_payload={"pm": True},
    )
    listing_duplicate = RawJobListing(
        title="QA",
        company="Acme",
        location="TLV",
        work_model="Hybrid",
        employment_type="Contract",
        experience_level="Junior-level",
        description="Duplicate listing",
        external_url="https://boards.greenhouse.io/acme/jobs/dup",
        raw_payload={},
    )

    mock_source = MagicMock()
    mock_source.id = source_id
    mock_source.source_type = "greenhouse"
    mock_source.slug = "acme"
    mock_source.workday_tenant = None
    mock_source.workday_site = None

    mock_run = MagicMock()
    mock_run.id = run_id
    mock_run.source_id = source_id

    # UoW pool: init, check1 (not dup), create_jd, check2 (not dup), create_flag,
    # check3 (dup), finish.
    uow_init = _make_mock_uow()
    uow_check1 = _make_mock_uow()
    uow_jd = _make_mock_uow()
    uow_check2 = _make_mock_uow()
    uow_flag = _make_mock_uow()
    uow_check3 = _make_mock_uow()
    uow_finish = _make_mock_uow()

    factory = _multi_uow_factory(
        [uow_init, uow_check1, uow_jd, uow_check2, uow_flag, uow_check3, uow_finish]
    )

    # Track external_url_exists calls to return different values per call.
    url_exists_responses = [False, False, True]
    url_exists_call_count = 0

    async def _url_exists(session: Any, url: str) -> bool:
        nonlocal url_exists_call_count
        result = url_exists_responses[url_exists_call_count]
        url_exists_call_count += 1
        return result

    with (
        patch(
            "app.modules.jobs.collection_service.collection_repo"
        ) as mock_collection_repo,
        patch("app.modules.jobs.collection_service.jobs_repo") as mock_jobs_repo,
        patch("app.modules.jobs.collection_service.get_adapter") as mock_get_adapter,
    ):
        mock_collection_repo.get_source = AsyncMock(return_value=mock_source)
        mock_collection_repo.create_run = AsyncMock(return_value=mock_run)
        uow_init.session.flush = AsyncMock()

        mock_adapter = MagicMock()
        mock_adapter.fetch = AsyncMock(
            return_value=[listing_complete, listing_incomplete, listing_duplicate]
        )
        mock_get_adapter.return_value = mock_adapter

        mock_collection_repo.external_url_exists = AsyncMock(side_effect=_url_exists)
        mock_collection_repo.create_flag = AsyncMock(return_value=MagicMock())
        mock_jobs_repo.create_jd = AsyncMock(return_value=MagicMock())

        mock_finish_run = MagicMock()
        mock_finish_run.id = run_id
        mock_finish_run.source_id = source_id
        from app.platform.db.enums import CollectionRunStatus

        mock_finish_run.status = CollectionRunStatus.COMPLETED
        mock_finish_run.finished_at = None
        mock_finish_run.jobs_fetched = 3
        mock_finish_run.jobs_created = 1
        mock_finish_run.jobs_skipped = 1
        mock_finish_run.jobs_flagged = 1
        mock_finish_run.error_detail = None
        mock_finish_run.started_at = MagicMock()
        mock_collection_repo.get_run = AsyncMock(return_value=mock_finish_run)
        mock_collection_repo.finish_run = AsyncMock()
        mock_collection_repo.update_source = AsyncMock()

        svc = JobCollectionService(factory, task_queue=_make_task_queue())
        await svc.collect_source(source_id)

    # Assert finish_run was called with correct counters.
    mock_collection_repo.finish_run.assert_called_once()
    call_kwargs = mock_collection_repo.finish_run.call_args.kwargs
    assert call_kwargs["jobs_fetched"] == 3
    assert call_kwargs["jobs_created"] == 1
    assert call_kwargs["jobs_flagged"] == 1
    assert call_kwargs["jobs_skipped"] == 1
    assert call_kwargs["status"] == CollectionRunStatus.COMPLETED


# ── concurrent dedup by external_url ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_concurrent_collect_dedup_by_external_url() -> None:
    """Second collection call sees external_url_exists=True and skips without creating a JD."""
    source_id = uuid.uuid4()
    run_id = uuid.uuid4()

    listing = RawJobListing(
        title="SWE",
        company="Acme",
        location="TLV",
        work_model="Remote",
        employment_type="Full-time",
        experience_level="Mid-level",
        description="Dedup target",
        external_url="https://boards.greenhouse.io/acme/jobs/dedup",
        raw_payload={},
    )

    mock_source = MagicMock()
    mock_source.id = source_id
    mock_source.source_type = "greenhouse"
    mock_source.slug = "acme"
    mock_source.workday_tenant = None
    mock_source.workday_site = None

    mock_run = MagicMock()
    mock_run.id = run_id
    mock_run.source_id = source_id

    # Second call: URL already present.
    uow_init = _make_mock_uow()
    uow_check = _make_mock_uow()
    uow_finish = _make_mock_uow()

    factory = _multi_uow_factory([uow_init, uow_check, uow_finish])

    with (
        patch(
            "app.modules.jobs.collection_service.collection_repo"
        ) as mock_collection_repo,
        patch("app.modules.jobs.collection_service.jobs_repo") as mock_jobs_repo,
        patch("app.modules.jobs.collection_service.get_adapter") as mock_get_adapter,
    ):
        mock_collection_repo.get_source = AsyncMock(return_value=mock_source)
        mock_collection_repo.create_run = AsyncMock(return_value=mock_run)
        uow_init.session.flush = AsyncMock()

        mock_adapter = MagicMock()
        mock_adapter.fetch = AsyncMock(return_value=[listing])
        mock_get_adapter.return_value = mock_adapter

        # URL is already in the DB (another worker won the race).
        mock_collection_repo.external_url_exists = AsyncMock(return_value=True)
        mock_jobs_repo.create_jd = AsyncMock()
        mock_collection_repo.create_flag = AsyncMock()

        mock_finish_run = MagicMock()
        mock_finish_run.id = run_id
        mock_finish_run.source_id = source_id
        from app.platform.db.enums import CollectionRunStatus

        mock_finish_run.status = CollectionRunStatus.COMPLETED
        mock_finish_run.finished_at = None
        mock_finish_run.jobs_fetched = 1
        mock_finish_run.jobs_created = 0
        mock_finish_run.jobs_skipped = 1
        mock_finish_run.jobs_flagged = 0
        mock_finish_run.error_detail = None
        mock_finish_run.started_at = MagicMock()
        mock_collection_repo.get_run = AsyncMock(return_value=mock_finish_run)
        mock_collection_repo.finish_run = AsyncMock()
        mock_collection_repo.update_source = AsyncMock()

        svc = JobCollectionService(factory, task_queue=_make_task_queue())
        await svc.collect_source(source_id)

    mock_jobs_repo.create_jd.assert_not_called()
    mock_collection_repo.create_flag.assert_not_called()

    mock_collection_repo.finish_run.assert_called_once()
    call_kwargs = mock_collection_repo.finish_run.call_args.kwargs
    assert call_kwargs["jobs_skipped"] == 1
    assert call_kwargs["jobs_created"] == 0
