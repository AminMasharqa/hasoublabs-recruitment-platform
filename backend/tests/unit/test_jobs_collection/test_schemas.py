"""Tests for job collection schemas (Task 4)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.modules.jobs.schemas import FlagResolveRequest, JobSourceCreateRequest
from app.platform.db.enums import JobSourceType

pytestmark = pytest.mark.unit


def test_job_source_create_requires_workday_fields_for_workday() -> None:
    """JobSourceCreateRequest must require workday_tenant and workday_site for WORKDAY type."""
    with pytest.raises(ValidationError):
        JobSourceCreateRequest(
            name="Acme",
            source_type=JobSourceType.WORKDAY,
            slug="acme",
            # missing workday_tenant and workday_site
        )


def test_job_source_create_workday_valid_with_tenant_and_site() -> None:
    """JobSourceCreateRequest is valid when workday fields are supplied for WORKDAY type."""
    req = JobSourceCreateRequest(
        name="Acme",
        source_type=JobSourceType.WORKDAY,
        slug="acme",
        workday_tenant="acme",
        workday_site="Acme_Jobs",
    )
    assert req.workday_tenant == "acme"
    assert req.workday_site == "Acme_Jobs"


def test_job_source_create_poll_interval_minimum() -> None:
    """poll_interval_hours must be >= 1."""
    with pytest.raises(ValidationError):
        JobSourceCreateRequest(
            name="X",
            source_type=JobSourceType.GREENHOUSE,
            slug="x",
            poll_interval_hours=0,
        )


def test_flag_resolve_request_create_jd_requires_jd_data() -> None:
    """FlagResolveRequest must require jd_data when action is 'create_jd'."""
    with pytest.raises(ValidationError):
        FlagResolveRequest(action="create_jd")  # type: ignore[arg-type]
