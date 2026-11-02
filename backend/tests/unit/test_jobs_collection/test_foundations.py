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


def test_collect_jobs_schedule_interval() -> None:
    schedule = SCHEDULES_BY_JOB[JobName.COLLECT_JOBS_FOR_SOURCE]
    assert schedule.interval_seconds == 21600  # 6 hours
