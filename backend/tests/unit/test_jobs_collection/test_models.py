"""Tests for job collection ORM models (R23)."""

from app.modules.jobs.models import JobCollectionRun, JobDescriptionFlag, JobSource


def test_job_source_tablename():
    assert JobSource.__tablename__ == "job_sources"


def test_job_collection_run_tablename():
    assert JobCollectionRun.__tablename__ == "job_collection_runs"


def test_job_description_flag_tablename():
    assert JobDescriptionFlag.__tablename__ == "job_description_flags"


def test_job_source_has_poll_interval_check():
    constraints = {c.name for c in JobSource.__table__.constraints}
    assert "ck_job_sources_poll_interval_hours" in constraints


def test_job_source_unique_type_slug():
    constraints = {c.name for c in JobSource.__table__.constraints}
    assert "uq_job_sources_source_type_slug" in constraints
