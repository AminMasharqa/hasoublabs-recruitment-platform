"""Domain service layer for the applications module (R7, Section 18).

Business logic, transaction orchestration, and cross-module calls all live here.
No FastAPI imports. No direct model imports from other modules.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import TYPE_CHECKING, Any
from uuid import UUID

from app.platform.db.base import utc_now
from app.platform.db.enums import ApplicationChannel, ApplicationStatus, JdStatus
from app.platform.errors.base import ConflictingState, PreconditionUnmet, RateLimited
from app.platform.mail.outbox import enqueue_email
from app.platform.mail.templates import EmailTemplate
from app.platform.notifications.models import NotificationType
from app.platform.notifications.service import push, push_many

from app.modules.applications import repository as repo
from app.modules.applications.errors import (
    ApplicationNotReady,
    DuplicateApplication,
    JdNotOpen,
)
from app.modules.applications.schemas import ApplicationDTO, ApplicationResultDTO

if TYPE_CHECKING:
    from app.modules.cvs.api import CvsApi
    from app.modules.identity.api import IdentityApi
    from app.modules.profiles.api import ProfilesApi
    from app.modules.profiles.schemas import ApplicantCardDTO
    from app.platform.security.principal import Principal

_LOG = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _application_to_dto(
    application: Any,
    *,
    jd_title: str = "",
    jd_company: str = "",
) -> ApplicationDTO:
    """Convert an Application ORM row to an ApplicationDTO.

    The denormalised ``jd_title`` and ``jd_company`` fields are supplied by the
    caller because the applications module cannot import the jobs models directly.
    """
    return ApplicationDTO(
        id=application.id,
        candidate_id=application.candidate_id,
        jd_id=application.jd_id,
        cv_version_id=application.cv_version_id,
        status=application.status.value,
        routed_channel=application.routed_channel.value,
        submitted_at=application.submitted_at,
        jd_title=jd_title,
        jd_company=jd_company,
        created_at=application.created_at,
        updated_at=application.updated_at,
    )


# ── ApplicationService ────────────────────────────────────────────────────────


class ApplicationService:
    """Handles application submission and candidate-scoped reads.

    Preconditions enforced by ``apply()`` in order:
    1. JD exists and status = Open              (JdNotOpen)
    2. Candidate is Application-Ready           (ApplicationNotReady, R7 AC1/AC2)
    3. No non-terminal application exists       (DuplicateApplication, R7 AC7)
    4. Rolling 24h rate limit < 20              (RateLimited, R7 AC13)
    """

    RATE_LIMIT_WINDOW_HOURS: int = 24
    RATE_LIMIT_MAX_SUBMISSIONS: int = 20

    def __init__(
        self,
        uow_factory: Any,
        *,
        profiles_api: ProfilesApi,
        cvs_api: CvsApi,
        identity_api: IdentityApi,
        jobs_api: Any,  # Loosely typed to avoid circular imports during Wave C
    ) -> None:
        self._uow_factory = uow_factory
        self._profiles_api = profiles_api
        self._cvs_api = cvs_api
        self._identity_api = identity_api
        self._jobs_api = jobs_api  # JobsApi protocol — will be typed once jobs module lands

    # ── apply() ───────────────────────────────────────────────────────────

    async def apply(
        self,
        jd_id: UUID,
        principal: Principal,
        *,
        cv_variant_id: UUID | None = None,
    ) -> ApplicationResultDTO:
        """Submit an application. Implements R7 AC1–AC13.

        Preconditions are checked outside the UoW transaction so they can use
        separate sessions (completeness check, rate limit). The actual INSERT
        and side-effects (notification, outbox email) run in a single UoW.

        Args:
            jd_id:          The target Job_Description UUID.
            principal:      The authenticated Candidate principal.
            cv_variant_id:  Optional CV variant override; uses primary if None.

        Returns:
            An ApplicationResultDTO with the new ApplicationDTO, or a redirect
            URL for External_Careers_URL channels (R7 AC8).

        Raises:
            JdNotOpen:            JD is not in Open status.
            ApplicationNotReady:  Candidate profile is incomplete or has no CV.
            DuplicateApplication: A non-terminal application already exists.
            RateLimited:          Exceeded 20 submissions in the rolling 24 h window.
        """
        candidate_id = principal.account_id

        # ── Step 1: Verify JD exists and is Open ──────────────────────────
        jd_data = await self._get_jd(jd_id)
        if jd_data is None or jd_data.get("status") != JdStatus.OPEN.value:
            raise JdNotOpen()

        # ── Step 2: Verify Application-Ready ──────────────────────────────
        completeness = await self._profiles_api.get_completeness(candidate_id)
        if completeness.state != "Complete" or completeness.missing_fields:
            raise ApplicationNotReady(missing_fields=completeness.missing_fields)

        # ── Step 3: Check for existing non-terminal application ───────────
        async with self._uow_factory() as pre_check_uow:
            already_applied = await repo.has_non_terminal_application(
                pre_check_uow.session, candidate_id, jd_id
            )
        if already_applied:
            raise DuplicateApplication()

        # ── Step 4: Rolling 24h rate limit ────────────────────────────────
        window_start = utc_now() - timedelta(hours=self.RATE_LIMIT_WINDOW_HOURS)
        async with self._uow_factory() as rl_uow:
            submission_count = await repo.count_candidate_applications_in_window(
                rl_uow.session, candidate_id, window_start=window_start
            )
        if submission_count >= self.RATE_LIMIT_MAX_SUBMISSIONS:
            raise RateLimited(retry_after_seconds=3600, scope="application_submission")

        # ── Step 5-11: Transactional block ────────────────────────────────
        channel_str = jd_data.get("application_channel", ApplicationChannel.SENIOR_DASHBOARD.value)
        try:
            routed_channel = ApplicationChannel(channel_str)
        except ValueError:
            routed_channel = ApplicationChannel.SENIOR_DASHBOARD

        # R7 AC8: External channel → redirect, no Application row
        if routed_channel == ApplicationChannel.EXTERNAL_CAREERS_URL:
            redirect_url = jd_data.get("external_careers_url", "")
            return ApplicationResultDTO(
                channel=routed_channel.value,
                application=None,
                redirect_url=redirect_url,
            )

        # Step 5: Resolve the CV version to record
        cv_ref = await self._cvs_api.resolve_active_version(candidate_id, cv_variant_id)

        # Steps 6-10: All inside one UoW (R7 AC12 — notification + email in same tx)
        jd_title = jd_data.get("title", "")
        jd_company = jd_data.get("company", "")

        # Fetch the candidate's email and language for the outbox email
        candidate_account = await self._identity_api.get_account(candidate_id)
        admin_recipients = await self._identity_api.list_admin_recipients()

        async with self._uow_factory() as uow:
            # Step 7b: CREATE Application row
            application = await repo.create_application(
                uow.session,
                candidate_id=candidate_id,
                jd_id=jd_id,
                cv_version_id=cv_ref.version_id,
                routed_channel=routed_channel,
            )

            # Step 8: Record initial status transition (None → Submitted)
            await repo.record_status_transition(
                uow.session,
                application_id=application.id,
                from_status=None,
                to_status=ApplicationStatus.SUBMITTED,
                actor_account_id=candidate_id,
                reason=None,
            )

            # Step 9: In-app notification → Candidate + Admins (R7 AC12)
            push(
                uow.session,
                recipient_account_id=candidate_id,
                notification_type=NotificationType.APPLICATION_SUBMITTED,
                entity_type="Application",
                entity_id=application.id,
            )
            push_many(
                uow.session,
                recipient_account_ids=[r.account_id for r in admin_recipients],
                notification_type=NotificationType.APPLICATION_SUBMITTED,
                entity_type="Application",
                entity_id=application.id,
            )

            # Step 10: Outbox email → Candidate (R7 AC12)
            await enqueue_email(
                uow.session,
                template=EmailTemplate.APPLICATION_SUBMITTED,
                to_address=candidate_account.email,
                locale=candidate_account.language_preference,
                idempotency_key=f"application-submitted:{application.id}",
                payload={
                    "full_name": candidate_account.email,  # name resolved by profile
                    "job_title": jd_title,
                    "company": jd_company,
                },
                recipient_account_id=candidate_id,
            )

        # Step 11: Return DTO
        dto = _application_to_dto(application, jd_title=jd_title, jd_company=jd_company)
        return ApplicationResultDTO(
            channel=routed_channel.value,
            application=dto,
            redirect_url=None,
        )

    # ── list_mine() ───────────────────────────────────────────────────────

    async def list_mine(
        self,
        principal: Principal,
        *,
        after_id: UUID | None,
        limit: int,
    ) -> list[ApplicationDTO]:
        """Return the authenticated candidate's own applications (R7 AC9).

        JD title and company are fetched per application for display; missing
        JD data degrades gracefully (uses empty strings).
        """
        candidate_id = principal.account_id
        async with self._uow_factory() as uow:
            applications = await repo.list_candidate_applications(
                uow.session,
                candidate_id,
                after_id=after_id,
                limit=limit,
            )

        result: list[ApplicationDTO] = []
        for application in applications:
            jd_data = await self._get_jd(application.jd_id)
            jd_title = jd_data.get("title", "") if jd_data else ""
            jd_company = jd_data.get("company", "") if jd_data else ""
            result.append(
                _application_to_dto(application, jd_title=jd_title, jd_company=jd_company)
            )
        return result

    # ── list_jd_applicants() ──────────────────────────────────────────────

    async def list_jd_applicants(
        self,
        jd_id: UUID,
        principal: Principal,
        *,
        status: ApplicationStatus | None,
        after_id: UUID | None,
        limit: int,
    ) -> list[ApplicantCardDTO]:
        """Return the restricted applicant card list for a JD.

        Access rules:
        - Senior: may only see applicants for their own JDs.
        - Admin: may see applicants for any JD.

        Each card is composed from:
        - ProfilesApi.candidate_public_card() → full_name
        - Application rows → applied_role_title + application_status
        """
        from app.modules.profiles.schemas import ApplicantCardDTO  # noqa: PLC0415
        from app.platform.security.errors import AuthorizationDenied  # noqa: PLC0415
        from app.platform.security.types import Role  # noqa: PLC0415

        # Ownership check for Senior principals
        if principal.active_context == Role.SENIOR:
            jd_data = await self._get_jd(jd_id)
            if jd_data is None:
                raise AuthorizationDenied()
            if str(jd_data.get("creator_account_id", "")) != str(principal.account_id):
                raise AuthorizationDenied()
        elif principal.active_context != Role.ADMIN and Role.ADMIN not in principal.roles:
            raise AuthorizationDenied()

        jd_data = jd_data if principal.active_context == Role.SENIOR else await self._get_jd(jd_id)
        jd_title = jd_data.get("title", "") if jd_data else ""

        async with self._uow_factory() as uow:
            applications = await repo.list_jd_applicants(
                uow.session,
                jd_id,
                status=status,
                after_id=after_id,
                limit=limit,
            )

        cards: list[ApplicantCardDTO] = []
        for application in applications:
            try:
                profile_card = await self._profiles_api.candidate_public_card(
                    application.candidate_id
                )
                card = ApplicantCardDTO(
                    full_name=profile_card.full_name,
                    applied_role_title=jd_title,
                    application_status=application.status.value,
                )
                cards.append(card)
            except Exception:  # noqa: BLE001
                # If a profile is missing, skip the card rather than 500 the whole list.
                _LOG.warning(
                    "applications: skipping applicant card for candidate %s — profile not found",
                    application.candidate_id,
                )
        return cards

    # ── get_application() ─────────────────────────────────────────────────

    async def get_application(
        self,
        application_id: UUID,
        principal: Principal,
    ) -> ApplicationDTO:
        """Return a single application.

        - Candidate: own applications only.
        - Admin: any application.
        """
        from app.platform.security.errors import AuthorizationDenied  # noqa: PLC0415
        from app.platform.security.types import Role  # noqa: PLC0415

        is_admin = Role.ADMIN in principal.roles

        async with self._uow_factory() as uow:
            if is_admin:
                application = await repo.get_application(uow.session, application_id)
            else:
                application = await repo.get_application(
                    uow.session,
                    application_id,
                    candidate_id=principal.account_id,
                )

        if application is None:
            raise AuthorizationDenied()

        jd_data = await self._get_jd(application.jd_id)
        jd_title = jd_data.get("title", "") if jd_data else ""
        jd_company = jd_data.get("company", "") if jd_data else ""
        return _application_to_dto(application, jd_title=jd_title, jd_company=jd_company)

    # ── Internal helpers ──────────────────────────────────────────────────

    async def _get_jd(self, jd_id: UUID) -> dict | None:
        """Fetch JD data via the injected jobs_api.

        Returns a dict with at least: status, title, company, application_channel,
        creator_account_id, external_careers_url (if applicable). Returns None
        if the JD does not exist or the jobs_api is not yet wired.
        """
        if self._jobs_api is None:
            return None
        try:
            return await self._jobs_api.get_jd(jd_id)
        except Exception:  # noqa: BLE001
            return None


# ── ApplicationStatusService ──────────────────────────────────────────────────


class ApplicationStatusService:
    """Admin-only service for updating application status (R7 AC10).

    Also provides the cascade-close operation called by JobDescriptionService
    when a JD is closed (R7 AC11).
    """

    def __init__(
        self,
        uow_factory: Any,
        *,
        identity_api: IdentityApi,
    ) -> None:
        self._uow_factory = uow_factory
        self._identity_api = identity_api

    async def update_status(
        self,
        application_id: UUID,
        new_status: ApplicationStatus,
        *,
        actor: Principal,
        reason: str | None = None,
    ) -> ApplicationDTO:
        """Admin-only status change with full audit trail (R7 AC10, AC14).

        Records the actor and timestamp in a status transition entry and enqueues
        a status-changed notification + email to the candidate.

        Args:
            application_id: The UUID of the application to update.
            new_status:     The target ApplicationStatus.
            actor:          The Admin performing the change (from the guard).
            reason:         Optional human-readable justification.

        Returns:
            Updated ApplicationDTO.

        Raises:
            AuthorizationDenied: If the application does not exist (no 404 leak).
        """
        from app.platform.security.errors import AuthorizationDenied  # noqa: PLC0415

        async with self._uow_factory() as uow:
            application = await repo.get_application(uow.session, application_id)
            if application is None:
                raise AuthorizationDenied()

            previous_status = application.status
            await repo.update_application_status(uow.session, application, new_status)
            await repo.record_status_transition(
                uow.session,
                application_id=application_id,
                from_status=previous_status,
                to_status=new_status,
                actor_account_id=actor.account_id,
                reason=reason,
            )

            # In-app notification → Candidate
            push(
                uow.session,
                recipient_account_id=application.candidate_id,
                notification_type=NotificationType.APPLICATION_STATUS_CHANGED,
                entity_type="Application",
                entity_id=application.id,
            )

            # Outbox email → Candidate
            try:
                candidate_account = await self._identity_api.get_account(
                    application.candidate_id
                )
                await enqueue_email(
                    uow.session,
                    template=EmailTemplate.APPLICATION_STATUS_CHANGED,
                    to_address=candidate_account.email,
                    locale=candidate_account.language_preference,
                    idempotency_key=(
                        f"application-status-changed:{application_id}:{new_status.value}"
                    ),
                    payload={
                        "full_name": candidate_account.email,
                        "job_title": "",  # Caller enriches if needed; we avoid JD lookup
                        "status": new_status.value,
                    },
                    recipient_account_id=application.candidate_id,
                )
            except Exception:  # noqa: BLE001
                # Email failure should not abort the status update.
                _LOG.warning(
                    "applications: failed to enqueue status-changed email for application %s",
                    application_id,
                )

        return ApplicationDTO(
            id=application.id,
            candidate_id=application.candidate_id,
            jd_id=application.jd_id,
            cv_version_id=application.cv_version_id,
            status=new_status.value,
            routed_channel=application.routed_channel.value,
            submitted_at=application.submitted_at,
            created_at=application.created_at,
            updated_at=application.updated_at,
        )

    async def cascade_close_for_jd(self, jd_id: UUID, *, actor_id: UUID) -> int:
        """Close all non-terminal applications when a JD is closed (R7 AC11).

        Should be called inside the same UoW that closes the JD so that the
        cascade is atomic. Because the jobs module calls through ApplicationsApi,
        which opens its own UoW, the atomicity relies on PostgreSQL's
        synchronous commit behaviour within the same request.

        Returns the number of applications that were closed.
        """
        async with self._uow_factory() as uow:
            # Fetch the IDs of non-terminal applications before bulk-updating them
            # so we can insert individual history rows with the correct from_status.
            from sqlalchemy import select  # noqa: PLC0415
            from app.modules.applications.models import Application  # noqa: PLC0415
            from app.platform.db.enums import NON_TERMINAL_APPLICATION_STATUSES  # noqa: PLC0415

            stmt = select(Application.id, Application.status).where(
                Application.jd_id == jd_id,
                Application.status.in_(list(NON_TERMINAL_APPLICATION_STATUSES)),
            )
            result = await uow.session.execute(stmt)
            rows = result.fetchall()

            if not rows:
                return 0

            count = await repo.close_applications_for_jd(uow.session, jd_id)

            for row in rows:
                await repo.record_status_transition(
                    uow.session,
                    application_id=row[0],
                    from_status=row[1],
                    to_status=ApplicationStatus.CLOSED,
                    actor_account_id=actor_id,
                    reason="JD closed — application auto-closed by cascade",
                )

        return count


__all__ = ["ApplicationService", "ApplicationStatusService"]
