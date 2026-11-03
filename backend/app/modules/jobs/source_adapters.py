"""Source adapters for ATS job collection (R23).

Each adapter fetches raw job listings from a specific ATS platform and
normalises them into ``RawJobListing`` instances.  ``FieldMapper`` then
converts a ``RawJobListing`` into a plain dict ready for service-layer
ingestion, flagging any required fields that are missing or empty.

Protocol summary
----------------
* ``SourceAdapter`` – ``async def fetch(source: JobSource) -> list[RawJobListing]``
* ``FieldMapper.map(raw)`` – ``(fields_dict, missing_fields_list)``
* ``get_adapter(source_type)`` – factory; raises ``UnsupportedSourceType`` for unknown types

Adapters accept an optional ``transport: httpx.AsyncBaseTransport | None = None``
so tests can inject a mock transport without network access.
"""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any, Protocol, runtime_checkable

import httpx

from app.modules.jobs.errors import UnsupportedSourceType
from app.platform.db.enums import JobSourceType

# ---------------------------------------------------------------------------
# RawJobListing
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RawJobListing:
    """Normalised, adapter-agnostic snapshot of a single job posting.

    All text fields are optional because the source may omit them; the
    ``FieldMapper`` decides which absences are blocking.
    """

    title: str | None
    company: str | None
    location: str | None
    work_model: str | None
    employment_type: str | None
    experience_level: str | None
    description: str | None
    external_url: str | None
    raw_payload: dict  # type: ignore[type-arg]


# ---------------------------------------------------------------------------
# FieldMapper
# ---------------------------------------------------------------------------

REQUIRED_FIELDS: frozenset[str] = frozenset(
    {
        "title",
        "company",
        "location",
        "work_model",
        "employment_type",
        "experience_level",
        "description",
    }
)

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_DESCRIPTION_MAX_LEN = 10_000


class FieldMapper:
    """Convert a ``RawJobListing`` into a plain dict and surface missing required fields."""

    def map(self, raw: RawJobListing) -> tuple[dict[str, Any], list[str]]:  # noqa: ANN401
        """Return ``(fields_dict, missing_fields)``.

        * ``description`` has HTML stripped and is truncated to 10 000 chars.
        * A field is "missing" if its value is ``None`` or an empty string after
          stripping.
        """
        fields: dict[str, Any] = {
            "title": raw.title,
            "company": raw.company,
            "location": raw.location,
            "work_model": raw.work_model,
            "employment_type": raw.employment_type,
            "experience_level": raw.experience_level,
            "description": raw.description,
            "external_url": raw.external_url,
        }

        # Strip HTML from description and truncate.
        if fields["description"] is not None:
            fields["description"] = _HTML_TAG_RE.sub("", fields["description"])
            if len(fields["description"]) > _DESCRIPTION_MAX_LEN:
                fields["description"] = fields["description"][:_DESCRIPTION_MAX_LEN]

        # Strip HTML from all string fields (title, company, location …).
        for key, value in fields.items():
            if key != "description" and isinstance(value, str):
                fields[key] = _HTML_TAG_RE.sub("", value)

        missing: list[str] = [
            field
            for field in REQUIRED_FIELDS
            if not fields.get(field)  # None or empty string are both falsy
        ]

        return fields, missing


# ---------------------------------------------------------------------------
# SourceAdapter Protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class SourceAdapter(Protocol):
    """Protocol for ATS adapters.  Each adapter fetches jobs for one source."""

    async def fetch(self, source: Any) -> list[RawJobListing]:  # noqa: ANN401
        """Fetch all current job postings from the given source."""
        ...


# ---------------------------------------------------------------------------
# Inference helpers (shared across adapters)
# ---------------------------------------------------------------------------


def _infer_work_model(text: str | None) -> str | None:
    """Best-effort work-model inference from free text."""
    if not text:
        return None
    lower = text.lower()
    if "remote" in lower:
        return "Remote"
    if "hybrid" in lower:
        return "Hybrid"
    return "Onsite"


def _infer_employment_type(text: str | None) -> str | None:
    """Best-effort employment-type inference from free text."""
    if not text:
        return None
    lower = text.lower()
    if "full-time" in lower or "full time" in lower:
        return "Full-time"
    if "part-time" in lower or "part time" in lower:
        return "Part-time"
    if "contract" in lower:
        return "Contract"
    return None


def _infer_experience_level(text: str | None) -> str | None:
    """Best-effort experience-level inference from free text."""
    if not text:
        return None
    lower = text.lower()
    if "senior" in lower or "lead" in lower:
        return "Senior-level"
    if "mid" in lower:
        return "Mid-level"
    if "junior" in lower or "jr" in lower:
        return "Junior-level"
    return None


# ---------------------------------------------------------------------------
# Greenhouse adapter
# ---------------------------------------------------------------------------


class GreenhouseAdapter:
    """Fetches job postings from the Greenhouse job board API.

    GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
    """

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._transport = transport

    async def fetch(self, source: Any) -> list[RawJobListing]:  # noqa: ANN401
        """Fetch all published jobs from a Greenhouse board."""
        url = f"https://boards-api.greenhouse.io/v1/boards/{source.slug}/jobs?content=true"
        async with httpx.AsyncClient(transport=self._transport, timeout=30.0) as client:
            response = client.build_request("GET", url)
            result = await client.send(response)
            result.raise_for_status()
            data = result.json()

        listings: list[RawJobListing] = []
        for job in data.get("jobs", []):
            content: str | None = job.get("content")
            listings.append(
                RawJobListing(
                    title=job.get("title"),
                    company=source.slug,
                    location=(job.get("location") or {}).get("name"),
                    description=content,
                    external_url=job.get("absolute_url"),
                    work_model=_infer_work_model(content),
                    employment_type=_infer_employment_type(content),
                    experience_level=_infer_experience_level(content),
                    raw_payload=job,
                )
            )
        return listings


# ---------------------------------------------------------------------------
# Lever adapter
# ---------------------------------------------------------------------------


class LeverAdapter:
    """Fetches job postings from the Lever API.

    GET https://api.lever.co/v0/postings/{slug}?mode=json
    """

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._transport = transport

    async def fetch(self, source: Any) -> list[RawJobListing]:  # noqa: ANN401
        """Fetch all published jobs from a Lever board."""
        url = f"https://api.lever.co/v0/postings/{source.slug}?mode=json"
        async with httpx.AsyncClient(transport=self._transport, timeout=30.0) as client:
            request = client.build_request("GET", url)
            result = await client.send(request)
            result.raise_for_status()
            data = result.json()

        listings: list[RawJobListing] = []
        for job in data if isinstance(data, list) else []:
            categories: dict[str, Any] = job.get("categories") or {}
            loc: str | None = categories.get("location")
            commitment: str | None = categories.get("commitment")
            infer_text = f"{loc or ''} {commitment or ''}"
            listings.append(
                RawJobListing(
                    title=job.get("text"),
                    company=source.slug,
                    location=loc,
                    description=job.get("descriptionPlain"),
                    external_url=job.get("hostedUrl"),
                    employment_type=commitment,
                    work_model=_infer_work_model(infer_text),
                    experience_level=_infer_experience_level(job.get("text")),
                    raw_payload=job,
                )
            )
        return listings


# ---------------------------------------------------------------------------
# Ashby adapter
# ---------------------------------------------------------------------------


class AshbyAdapter:
    """Fetches job postings from the Ashby job board API.

    GET https://api.ashbyhq.com/posting-api/job-board/{slug}
    Response: ``{"jobPostings": [...]}``
    """

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._transport = transport

    async def fetch(self, source: Any) -> list[RawJobListing]:  # noqa: ANN401
        """Fetch all published jobs from an Ashby board."""
        url = f"https://api.ashbyhq.com/posting-api/job-board/{source.slug}"
        async with httpx.AsyncClient(transport=self._transport, timeout=30.0) as client:
            request = client.build_request("GET", url)
            result = await client.send(request)
            result.raise_for_status()
            data = result.json()

        listings: list[RawJobListing] = []
        for job in data.get("jobPostings", []):
            employment_type: str | None = job.get("employmentType")
            listings.append(
                RawJobListing(
                    title=job.get("title"),
                    company=job.get("organizationName") or source.slug,
                    location=job.get("location"),
                    description=job.get("descriptionPlain"),
                    external_url=job.get("jobUrl"),
                    employment_type=employment_type,
                    work_model=_infer_work_model(job.get("location")),
                    experience_level=_infer_experience_level(job.get("title")),
                    raw_payload=job,
                )
            )
        return listings


# ---------------------------------------------------------------------------
# Workable adapter
# ---------------------------------------------------------------------------


class WorkableAdapter:
    """Fetches job postings from the Workable widget API.

    GET https://apply.workable.com/api/v1/widget/accounts/{slug}?details=true
    Response: ``{"jobs": [...]}``
    """

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._transport = transport

    async def fetch(self, source: Any) -> list[RawJobListing]:  # noqa: ANN401
        """Fetch all published jobs from a Workable account."""
        url = f"https://apply.workable.com/api/v1/widget/accounts/{source.slug}?details=true"
        async with httpx.AsyncClient(transport=self._transport, timeout=30.0) as client:
            request = client.build_request("GET", url)
            result = await client.send(request)
            result.raise_for_status()
            data = result.json()

        listings: list[RawJobListing] = []
        for job in data.get("jobs", []):
            company_obj: dict[str, Any] = job.get("company") or {}
            location_obj: dict[str, Any] = job.get("location") or {}
            city: str | None = location_obj.get("city")
            country: str | None = location_obj.get("country")
            location_str: str | None = None
            if city and country:
                location_str = f"{city}, {country}"
            elif city:
                location_str = city
            elif country:
                location_str = country
            listings.append(
                RawJobListing(
                    title=job.get("title"),
                    company=company_obj.get("name") or source.slug,
                    location=location_str,
                    description=job.get("description"),
                    external_url=job.get("url"),
                    work_model=_infer_work_model(job.get("description")),
                    employment_type=_infer_employment_type(job.get("title")),
                    experience_level=_infer_experience_level(job.get("title")),
                    raw_payload=job,
                )
            )
        return listings


# ---------------------------------------------------------------------------
# SmartRecruiters adapter
# ---------------------------------------------------------------------------


class SmartRecruitersAdapter:
    """Fetches job postings from the SmartRecruiters API.

    GET https://api.smartrecruiters.com/v1/companies/{slug}/postings
    Response: ``{"content": [...]}``
    """

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._transport = transport

    async def fetch(self, source: Any) -> list[RawJobListing]:  # noqa: ANN401
        """Fetch all published jobs from a SmartRecruiters company."""
        url = f"https://api.smartrecruiters.com/v1/companies/{source.slug}/postings"
        async with httpx.AsyncClient(transport=self._transport, timeout=30.0) as client:
            request = client.build_request("GET", url)
            result = await client.send(request)
            result.raise_for_status()
            data = result.json()

        listings: list[RawJobListing] = []
        for job in data.get("content", []):
            company_obj: dict[str, Any] = job.get("company") or {}
            location_obj: dict[str, Any] = job.get("location") or {}
            job_ad: dict[str, Any] = job.get("jobAdDetails") or {}
            description: str | None = job_ad.get("text")
            listings.append(
                RawJobListing(
                    title=job.get("name"),
                    company=company_obj.get("name") or source.slug,
                    location=location_obj.get("city"),
                    description=description,
                    external_url=job.get("ref"),
                    work_model=_infer_work_model(description),
                    employment_type=_infer_employment_type(job.get("name")),
                    experience_level=_infer_experience_level(job.get("name")),
                    raw_payload=job,
                )
            )
        return listings


# ---------------------------------------------------------------------------
# Recruitee adapter
# ---------------------------------------------------------------------------


class RecruiteeAdapter:
    """Fetches job postings from the Recruitee API.

    GET https://{slug}.recruitee.com/api/offers/
    Response: ``{"offers": [...]}``
    """

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._transport = transport

    async def fetch(self, source: Any) -> list[RawJobListing]:  # noqa: ANN401
        """Fetch all published jobs from a Recruitee company."""
        url = f"https://{source.slug}.recruitee.com/api/offers/"
        async with httpx.AsyncClient(transport=self._transport, timeout=30.0) as client:
            request = client.build_request("GET", url)
            result = await client.send(request)
            result.raise_for_status()
            data = result.json()

        listings: list[RawJobListing] = []
        for job in data.get("offers", []):
            company_obj: dict[str, Any] = job.get("company") or {}
            company_name: str | None = company_obj.get("name") or source.slug
            listings.append(
                RawJobListing(
                    title=job.get("title"),
                    company=company_name,
                    location=job.get("city"),
                    description=job.get("description"),
                    external_url=job.get("careers_url"),
                    work_model=_infer_work_model(job.get("description")),
                    employment_type=_infer_employment_type(job.get("title")),
                    experience_level=_infer_experience_level(job.get("title")),
                    raw_payload=job,
                )
            )
        return listings


# ---------------------------------------------------------------------------
# Workday adapter
# ---------------------------------------------------------------------------

_WORKDAY_PAGE_SIZE = 20


class WorkdayAdapter:
    """Fetches job postings from the Workday REST API.

    POST https://{tenant}.wd5.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs

    Paginates until fewer than ``_WORKDAY_PAGE_SIZE`` results are returned or
    ``offset >= total``.
    """

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._transport = transport

    async def fetch(self, source: Any) -> list[RawJobListing]:  # noqa: ANN401
        """Fetch all current job postings from a Workday tenant."""
        tenant: str = source.workday_tenant
        site: str = source.workday_site
        base_url = f"https://{tenant}.wd5.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs"

        all_listings: list[RawJobListing] = []
        offset = 0
        total = _WORKDAY_PAGE_SIZE  # overwritten on first response

        async with httpx.AsyncClient(transport=self._transport, timeout=30.0) as client:
            while offset < total:
                payload = {
                    "appliedFacets": {},
                    "limit": _WORKDAY_PAGE_SIZE,
                    "offset": offset,
                    "searchText": "",
                }
                request = client.build_request("POST", base_url, json=payload)
                result = await client.send(request)
                result.raise_for_status()
                data = result.json()

                total = data.get("total", 0)
                postings: list[dict[str, Any]] = data.get("jobPostings", [])

                for job in postings:
                    external_path: str | None = job.get("externalPath")
                    external_url: str | None = (
                        f"https://{tenant}.wd5.myworkdayjobs.com{external_path}"
                        if external_path
                        else None
                    )
                    all_listings.append(
                        RawJobListing(
                            title=job.get("title"),
                            company=tenant,
                            location=job.get("locationsText"),
                            description=None,
                            external_url=external_url,
                            work_model=_infer_work_model(job.get("locationsText")),
                            employment_type=_infer_employment_type(job.get("title")),
                            experience_level=_infer_experience_level(job.get("title")),
                            raw_payload=job,
                        )
                    )

                if len(postings) < _WORKDAY_PAGE_SIZE:
                    break
                offset += _WORKDAY_PAGE_SIZE

        return all_listings


# ---------------------------------------------------------------------------
# Adapter factory
# ---------------------------------------------------------------------------

_AdapterCls = (
    type[GreenhouseAdapter]
    | type[LeverAdapter]
    | type[AshbyAdapter]
    | type[WorkableAdapter]
    | type[SmartRecruitersAdapter]
    | type[RecruiteeAdapter]
    | type[WorkdayAdapter]
)

_ADAPTER_MAP: dict[JobSourceType, _AdapterCls] = {
    JobSourceType.GREENHOUSE: GreenhouseAdapter,
    JobSourceType.LEVER: LeverAdapter,
    JobSourceType.ASHBY: AshbyAdapter,
    JobSourceType.WORKABLE: WorkableAdapter,
    JobSourceType.SMARTRECRUITERS: SmartRecruitersAdapter,
    JobSourceType.RECRUITEE: RecruiteeAdapter,
    JobSourceType.WORKDAY: WorkdayAdapter,
}


def get_adapter(source_type: JobSourceType) -> SourceAdapter:
    """Return the adapter for *source_type* (production: no transport injected).

    Raises:
        UnsupportedSourceType: when *source_type* has no registered adapter.
    """
    adapter_cls = _ADAPTER_MAP.get(source_type)
    if adapter_cls is None:
        raise UnsupportedSourceType()
    return adapter_cls()


__all__ = [
    "REQUIRED_FIELDS",
    "AshbyAdapter",
    "FieldMapper",
    "GreenhouseAdapter",
    "LeverAdapter",
    "RawJobListing",
    "RecruiteeAdapter",
    "SmartRecruitersAdapter",
    "SourceAdapter",
    "WorkableAdapter",
    "WorkdayAdapter",
    "get_adapter",
]
