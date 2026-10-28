"""Closing a Job_Description closes its open applications (R7 AC11).

``JobDescriptionService.close`` only set the JD's status: the cascade lived in
``DefaultJobsApi.close_jd_cascade_applications``, which nothing called (and which
reached into the applications repository, past the module boundary). Every
Submitted or Under Review application on a closed role stayed open.

The cascade now runs through ``ApplicationsApi`` on the JD close's own session,
so both commit or roll back together. Everything here runs in one transaction
that is rolled back, so the shared container is left as it was found.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select, text

from app.modules.applications.api import DefaultApplicationsApi
from app.modules.applications.models import Application, ApplicationStatusTransition
from app.modules.jobs.models import JobDescription
from app.modules.jobs.service import JobDescriptionService
from app.platform.db.base import utc_now
from app.platform.db.enums import AccountStatus, ApplicationChannel, ApplicationStatus, JdStatus
from app.platform.security.principal import Principal
from app.platform.security.types import Role

if TYPE_CHECKING:
    import uuid

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

pytestmark = pytest.mark.integration


class _SessionUow:
    """A UoW over a session the test owns: no commit, so the test can roll back."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def __aenter__(self) -> _SessionUow:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.session.flush()


async def _account(session: AsyncSession, email: str, role: str) -> uuid.UUID:
    return (
        await session.execute(
            text(
                "INSERT INTO accounts (email, roles, password_hash) "
                f"VALUES (:email, ARRAY['{role}']::role[], 'x') RETURNING id"
            ),
            {"email": email},
        )
    ).scalar_one()


async def _cv_version(session: AsyncSession, account_id: uuid.UUID) -> uuid.UUID:
    variant_id = (
        await session.execute(
            text("INSERT INTO cv_variants (account_id, name) VALUES (:a, 'cv') RETURNING id"),
            {"a": account_id},
        )
    ).scalar_one()
    return (
        await session.execute(
            text(
                "INSERT INTO cv_versions (variant_id, version_number, object_key, bucket, "
                "sha256_digest, size_bytes, mime_type, original_filename) "
                "VALUES (:v, 1, 'k', 'cvs', '\\x00', 1, 'application/pdf', 'cv.pdf') "
                "RETURNING id"
            ),
            {"v": variant_id},
        )
    ).scalar_one()


async def test_closing_a_jd_closes_its_open_applications(
    pg_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    async with pg_sessionmaker() as session:
        senior_id = await _account(session, "r7ac11-senior@example.test", "SENIOR")
        jd = JobDescription(
            creator_account_id=senior_id,
            title="Backend Engineer",
            company="Hasoub Labs",
            company_norm="hasoub labs",
            status=JdStatus.OPEN,
            published_at=utc_now(),
        )
        session.add(jd)
        await session.flush()

        applications: dict[ApplicationStatus, Application] = {}
        for status in ApplicationStatus:
            candidate_id = await _account(
                session, f"r7ac11-{status.name.lower()}@example.test", "CANDIDATE"
            )
            application = Application(
                candidate_id=candidate_id,
                jd_id=jd.id,
                cv_version_id=await _cv_version(session, candidate_id),
                status=status,
                routed_channel=ApplicationChannel.SENIOR_DASHBOARD,
                submitted_at=utc_now(),
            )
            session.add(application)
            applications[status] = application
        await session.flush()

        service = JobDescriptionService(
            lambda: _SessionUow(session),
            skill_resolver=None,  # type: ignore[arg-type]  # close() resolves no skills
            applications_api=DefaultApplicationsApi(None, identity_api=None),  # type: ignore[arg-type]
        )
        principal = Principal(
            account_id=senior_id,
            roles=frozenset({Role.SENIOR}),
            active_context=Role.SENIOR,
            status=AccountStatus.APPROVED,
            session_id="test",
        )

        closed_jd = await service.close(jd.id, principal)

        assert closed_jd.status == JdStatus.CLOSED
        statuses = {
            before: (
                await session.execute(select(Application.status).where(Application.id == app.id))
            ).scalar_one()
            for before, app in applications.items()
        }
        # R7 AC11: Submitted and Under Review close; the other statuses are untouched.
        assert statuses == {
            ApplicationStatus.SUBMITTED: ApplicationStatus.CLOSED,
            ApplicationStatus.UNDER_REVIEW: ApplicationStatus.CLOSED,
            ApplicationStatus.FORWARDED_TO_RECRUITER: ApplicationStatus.FORWARDED_TO_RECRUITER,
            ApplicationStatus.CLOSED: ApplicationStatus.CLOSED,
        }

        # One history row per cascaded application, with its real previous status.
        transitions = (
            await session.execute(
                select(
                    ApplicationStatusTransition.from_status,
                    ApplicationStatusTransition.to_status,
                    ApplicationStatusTransition.actor_account_id,
                ).where(
                    ApplicationStatusTransition.application_id.in_(
                        [app.id for app in applications.values()]
                    )
                )
            )
        ).all()
        assert sorted(transitions) == sorted(
            [
                ("Submitted", "Closed", senior_id),
                ("Under Review", "Closed", senior_id),
            ]
        )

        await session.rollback()
