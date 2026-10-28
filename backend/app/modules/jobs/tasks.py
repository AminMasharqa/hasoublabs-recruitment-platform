"""ARQ background tasks for the jobs module (R6, Section 17).

Tasks registered here:
- ``extract_jd_from_url``: fetch a URL, run heuristic extraction, populate
  a JdExtractionDraft (R6 AC1a, AC1b, AC1h).
- ``extract_jd_from_text``: run heuristic extraction on stored text, populate
  a JdExtractionDraft (R6 AC1a, AC1c).
- ``cleanup_stale_drafts``: purge JdExtractionDraft rows past their TTL.
"""

from __future__ import annotations

import logging
from uuid import UUID

from app.platform.jobs.catalog import JobName
from app.platform.jobs.registry import RetryPolicy, task

_LOG = logging.getLogger(__name__)


@task(
    JobName.EXTRACT_JD_FROM_URL,
    retry=RetryPolicy(max_tries=3, base_delay_seconds=30),
    timeout_seconds=60,
)
async def extract_jd_from_url(ctx: dict, *, draft_id: str, url: str, **_kwargs: object) -> dict:
    """Fetch a URL, run heuristic extraction, and populate the draft.

    SSRF guard is applied before fetching. The result is written back to the
    JdExtractionDraft row so the client can poll GET /jobs/extract/{draft_id}.
    """
    from app.platform.db.unit_of_work import UnitOfWork  # noqa: PLC0415
    from app.platform.jobs.runtime import worker_session_factory  # noqa: PLC0415
    from app.modules.jobs import repository as repo  # noqa: PLC0415
    from app.modules.jobs.service import JdExtractionService, _ssrf_guard, _heuristic_extract  # noqa: PLC0415
    from app.platform.errors.base import ValidationFailed  # noqa: PLC0415

    session_factory = worker_session_factory()
    uow_factory = lambda: UnitOfWork(session_factory)  # noqa: E731
    draft_uuid = UUID(draft_id)

    # SSRF guard (runs synchronously in worker — safe)
    try:
        _ssrf_guard(url)
    except ValidationFailed as exc:
        _LOG.warning("extract_jd_from_url: SSRF guard rejected URL %s: %s", url, exc)
        async with uow_factory() as uow:
            draft = await repo.get_extraction_draft(uow.session, draft_uuid)
            if draft:
                await repo.update_extraction_draft(
                    uow.session, draft,
                    extracted_fields={"error": "URL rejected by SSRF guard"},
                    skill_candidates=[],
                )
        return {"status": "rejected", "draft_id": draft_id}

    # Fetch content
    try:
        import httpx  # noqa: PLC0415
        async with httpx.AsyncClient(timeout=10.0, max_redirects=5, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "HasoubLabs-Extractor/1.0"})
            resp.raise_for_status()
            content = resp.text[:10_000]
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("extract_jd_from_url: fetch failed for %s: %s", url, exc)
        async with uow_factory() as uow:
            draft = await repo.get_extraction_draft(uow.session, draft_uuid)
            if draft:
                await repo.update_extraction_draft(
                    uow.session, draft,
                    extracted_fields={"error": f"Fetch failed: {exc}"},
                    skill_candidates=[],
                )
        return {"status": "fetch_failed", "draft_id": draft_id}

    # Heuristic extraction
    extracted = _heuristic_extract(content)
    extracted["_raw_url"] = url

    async with uow_factory() as uow:
        draft = await repo.get_extraction_draft(uow.session, draft_uuid)
        if draft:
            await repo.update_extraction_draft(
                uow.session, draft,
                extracted_fields=extracted,
                skill_candidates=[],
            )

    return {"status": "ready", "draft_id": draft_id, "fields_extracted": list(extracted.keys())}


@task(
    JobName.EXTRACT_JD_FROM_TEXT,
    retry=RetryPolicy(max_tries=3, base_delay_seconds=15),
    timeout_seconds=30,
)
async def extract_jd_from_text(ctx: dict, *, draft_id: str, **_kwargs: object) -> dict:
    """Run heuristic extraction on raw_content already stored in the draft."""
    from app.platform.db.unit_of_work import UnitOfWork  # noqa: PLC0415
    from app.platform.jobs.runtime import worker_session_factory  # noqa: PLC0415
    from app.modules.jobs import repository as repo  # noqa: PLC0415
    from app.modules.jobs.service import _heuristic_extract  # noqa: PLC0415

    session_factory = worker_session_factory()
    uow_factory = lambda: UnitOfWork(session_factory)  # noqa: E731
    draft_uuid = UUID(draft_id)

    async with uow_factory() as uow:
        draft = await repo.get_extraction_draft(uow.session, draft_uuid)
        if draft is None:
            _LOG.warning("extract_jd_from_text: draft %s not found", draft_id)
            return {"status": "not_found", "draft_id": draft_id}

        raw_content = draft.raw_content or ""
        extracted = _heuristic_extract(raw_content)

        await repo.update_extraction_draft(
            uow.session, draft,
            extracted_fields=extracted,
            skill_candidates=[],
        )

    return {"status": "ready", "draft_id": draft_id, "fields_extracted": list(extracted.keys())}
