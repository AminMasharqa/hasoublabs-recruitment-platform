import uuid

from app.platform.db.constants import SYSTEM_ACCOUNT_ID
from app.platform.db.enums import CollectionRunStatus, JobSourceType
from app.platform.jobs.catalog import SCHEDULES_BY_JOB, JobName


def test_system_account_id_is_fixed_uuid() -> None:
    assert SYSTEM_ACCOUNT_ID == uuid.UUID("00000000-0000-0000-0000-000000000001")


def test_job_source_type_values() -> None:
    assert set(JobSourceType) == {
        "greenhouse",
        "lever",
        "ashby",
        "workable",
        "smartrecruiters",
        "recruitee",
        "workday",
    }


def test_collection_run_status_values() -> None:
    assert set(CollectionRunStatus) == {"running", "completed", "failed"}


def test_collect_jobs_for_source_in_job_name() -> None:
    assert JobName.COLLECT_JOBS_FOR_SOURCE == "collect_jobs_for_source"


def test_dispatch_job_collection_in_job_name() -> None:
    assert JobName.DISPATCH_JOB_COLLECTION == "dispatch_job_collection"


def test_dispatch_job_collection_schedule_interval() -> None:
    # The 6-hour schedule is on the dispatcher, not on the per-source task.
    # The dispatcher fans out to individual COLLECT_JOBS_FOR_SOURCE tasks.
    schedule = SCHEDULES_BY_JOB[JobName.DISPATCH_JOB_COLLECTION]
    assert schedule.interval_seconds == 21600  # 6 hours


def test_collect_jobs_for_source_is_not_scheduled() -> None:
    # COLLECT_JOBS_FOR_SOURCE is enqueued by code (dispatcher or trigger_collect),
    # not by the scheduler directly — it cannot be scheduled because it requires
    # source_id and run_id kwargs that the scheduler cannot supply.
    from app.platform.jobs.catalog import SCHEDULES_BY_JOB  # noqa: PLC0415

    assert JobName.COLLECT_JOBS_FOR_SOURCE not in SCHEDULES_BY_JOB
