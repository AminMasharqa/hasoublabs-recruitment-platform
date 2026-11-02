"""Tests for source adapters and FieldMapper (R23 Task 5)."""

import json

import httpx
import pytest

from app.modules.jobs.source_adapters import (
    FieldMapper,
    GreenhouseAdapter,
    LeverAdapter,
    RawJobListing,
    WorkdayAdapter,
    get_adapter,
)
from app.platform.db.enums import JobSourceType

# ── FieldMapper ───────────────────────────────────────────────────────────────


def test_field_mapper_complete_listing_has_no_missing_fields() -> None:
    raw = RawJobListing(
        title="Engineer",
        company="Acme",
        location="TLV",
        work_model="Remote",
        employment_type="Full-time",
        experience_level="Mid-level",
        description="Some job",
        external_url="https://x.com",
        raw_payload={},
    )
    mapper = FieldMapper()
    fields, missing = mapper.map(raw)
    assert missing == []
    assert fields["title"] == "Engineer"


def test_field_mapper_missing_work_model_flagged() -> None:
    raw = RawJobListing(
        title="Engineer",
        company="Acme",
        location="TLV",
        work_model=None,
        employment_type="Full-time",
        experience_level="Mid-level",
        description="Some job",
        external_url="https://x.com",
        raw_payload={},
    )
    mapper = FieldMapper()
    _, missing = mapper.map(raw)
    assert "work_model" in missing


def test_field_mapper_strips_html_from_description() -> None:
    raw = RawJobListing(
        title="Eng",
        company="X",
        location="TLV",
        work_model="Onsite",
        employment_type="Full-time",
        experience_level="Lead",
        description="<p>Hello <b>world</b></p>",
        external_url="https://x.com",
        raw_payload={},
    )
    mapper = FieldMapper()
    fields, _ = mapper.map(raw)
    assert "<p>" not in fields["description"]
    assert "Hello world" in fields["description"]


def test_field_mapper_truncates_description_to_10000_chars() -> None:
    raw = RawJobListing(
        title="Eng",
        company="X",
        location="TLV",
        work_model="Remote",
        employment_type="Contract",
        experience_level="Junior-level",
        description="x" * 11_000,
        external_url="https://x.com",
        raw_payload={},
    )
    mapper = FieldMapper()
    fields, _ = mapper.map(raw)
    assert len(fields["description"]) <= 10_000


# ── Greenhouse adapter ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_greenhouse_adapter_parses_jobs() -> None:
    payload = {
        "jobs": [
            {
                "title": "SWE",
                "location": {"name": "Tel Aviv"},
                "absolute_url": "https://boards.greenhouse.io/acme/jobs/1",
                "metadata": None,
                "content": "Full-time Senior remote position description",
            }
        ]
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    transport = httpx.MockTransport(handler)
    adapter = GreenhouseAdapter(transport=transport)

    from unittest.mock import MagicMock

    source = MagicMock()
    source.slug = "acme"
    listings = await adapter.fetch(source)
    assert len(listings) == 1
    assert listings[0].title == "SWE"
    assert listings[0].external_url == "https://boards.greenhouse.io/acme/jobs/1"


# ── Workday pagination ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_workday_adapter_paginates_all_pages() -> None:
    call_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        body = json.loads(request.content)
        offset = body.get("offset", 0)
        if offset == 0:
            return httpx.Response(
                200,
                json={
                    "total": 25,
                    "jobPostings": [
                        {
                            "title": f"Job {i}",
                            "externalPath": f"/job/{i}",
                            "locationsText": "TLV",
                            "postedOn": "2026-01-01",
                        }
                        for i in range(20)
                    ],
                },
            )
        return httpx.Response(
            200,
            json={
                "total": 25,
                "jobPostings": [
                    {
                        "title": f"Job {i}",
                        "externalPath": f"/job/{i}",
                        "locationsText": "TLV",
                        "postedOn": "2026-01-01",
                    }
                    for i in range(20, 25)
                ],
            },
        )

    transport = httpx.MockTransport(handler)
    adapter = WorkdayAdapter(transport=transport)

    from unittest.mock import MagicMock

    source = MagicMock()
    source.workday_tenant = "acme"
    source.workday_site = "Acme_Jobs"
    source.slug = "wd5"
    listings = await adapter.fetch(source)
    assert len(listings) == 25
    assert call_count == 2


# ── Factory ───────────────────────────────────────────────────────────────────


def test_get_adapter_returns_correct_type() -> None:

    adapter = get_adapter(JobSourceType.LEVER)
    assert isinstance(adapter, LeverAdapter)
