"""ApplicationService consumes the JobsApi's ``JobDescriptionDTO``, not a dict.

``ApplicationService`` was written against a provisional dict contract
(``jd_data.get("status")``, ``.get("external_careers_url")``) while
``JobsApi.get_jd`` returns a Pydantic ``JobDescriptionDTO``. Every apply therefore
raised ``AttributeError: 'JobDescriptionDTO' object has no attribute 'get'`` —
``POST /jobs/{id}/applications`` returned 500 for every candidate.

No I/O: the cross-module APIs are stubs, and the two short pre-check units of
work (duplicate application, rate limit) are stubbed at the repository seam.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any
import uuid

import pytest

from app.modules.applications import service as application_service
from app.modules.applications.errors import JdNotOpen
from app.modules.applications.service import ApplicationService
from app.modules.jobs.schemas import JobDescriptionDTO
from app.platform.db.enums import ApplicationChannel, JdStatus
from app.platform.security.principal import Principal
from app.platform.security.types import AccountStatus, Role

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

pytestmark = pytest.mark.unit

_NOW = datetime(2026, 10, 5, 12, 0, tzinfo=UTC)
_CANDIDATE = Principal(
    account_id=uuid.uuid4(),
    roles=frozenset({Role.CANDIDATE}),
    active_context=Role.CANDIDATE,
    status=AccountStatus.APPROVED,
    session_id="session",
)


def _jd(status: JdStatus, channel: ApplicationChannel | None, url: str | None) -> JobDescriptionDTO:
    return JobDescriptionDTO(
        id=uuid.uuid4(),
        creator_account_id=uuid.uuid4(),
        title="Backend Engineer",
        company="Hasoub Labs",
        location=None,
        work_model=None,
        employment_type=None,
        experience_level=None,
        description=None,
        external_url=url,
        status=status,
        application_channel=channel,
        published_at=_NOW,
        closed_at=None,
        required_skill_ids=[],
        created_at=_NOW,
        updated_at=_NOW,
    )


class _JobsApi:
    def __init__(self, jd: JobDescriptionDTO) -> None:
        self.jd = jd

    async def get_jd(self, jd_id: uuid.UUID) -> JobDescriptionDTO:  # noqa: ARG002
        return self.jd


class _ProfilesApi:
    async def get_completeness(self, account_id: uuid.UUID) -> SimpleNamespace:  # noqa: ARG002
        return SimpleNamespace(state="Complete", missing_fields=[])


class _NullUow:
    session = None

    async def __aenter__(self) -> _NullUow:
        return self

    async def __aexit__(self, *_: object) -> None:
        return None


def _service(jd: JobDescriptionDTO) -> ApplicationService:
    return ApplicationService(
        _NullUow,
        profiles_api=_ProfilesApi(),  # type: ignore[arg-type]
        cvs_api=SimpleNamespace(),  # type: ignore[arg-type]
        identity_api=SimpleNamespace(),  # type: ignore[arg-type]
        jobs_api=_JobsApi(jd),  # type: ignore[arg-type]
    )


@pytest.fixture(autouse=True)
def _no_prior_applications(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[None]:
    async def _false(*_: Any, **__: Any) -> bool:
        return False

    async def _zero(*_: Any, **__: Any) -> int:
        return 0

    monkeypatch.setattr(application_service.repo, "has_non_terminal_application", _false)
    monkeypatch.setattr(application_service.repo, "count_candidate_applications_in_window", _zero)
    yield


@pytest.mark.parametrize("status", [JdStatus.DRAFT, JdStatus.CLOSED])
async def test_a_jd_that_is_not_open_is_refused(status: JdStatus) -> None:
    jd = _jd(status, ApplicationChannel.SENIOR_DASHBOARD, None)
    with pytest.raises(JdNotOpen):
        await _service(jd).apply(jd.id, _CANDIDATE)


async def test_external_careers_channel_redirects_to_the_jd_external_url() -> None:
    url = "https://careers.example.com/jobs/42"
    jd = _jd(JdStatus.OPEN, ApplicationChannel.EXTERNAL_CAREERS_URL, url)

    result = await _service(jd).apply(jd.id, _CANDIDATE)

    assert result.channel == ApplicationChannel.EXTERNAL_CAREERS_URL.value
    assert result.application is None
    assert result.redirect_url == url
