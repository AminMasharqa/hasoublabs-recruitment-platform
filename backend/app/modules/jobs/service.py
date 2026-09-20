"""Service layer for the jobs module (R6, Section 17).

Two service classes live here:

* ``JobDescriptionService`` — CRUD and lifecycle (create, update, publish, close).
* ``JdExtractionService`` — Phase-1 heuristic extraction pipeline with SSRF guard.

Neither class imports fastapi; all I/O goes through the repository layer.
"""

from __future__ import annotations

import ipaddress
import re
import socket
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any
from uuid import UUID

from app.modules.jobs import repository as repo
from app.modules.jobs.errors import (
    ExtractionDraftExpired,
    JdAlreadyClosed,
    JdEditForbiddenWhenClosed,
    JdPublishPreconditionFailed,
    SsrfGuardRejected,
)
from app.modules.jobs.schemas import (
    JdAdminListParams,
    JdBrowsePage,
    JdBrowseParams,
    JdCreateRequest,
    JdExtractionDraftDTO,
    JdUpdateRequest,
    JobDescriptionDTO,
)
from app.platform.db.base import utc_now
from app.platform.db.enums import (
    ApplicationChannel,
    JdStatus,
)
from app.platform.errors.base import FieldViolation, ValidationFailed
from app.platform.security.errors import AuthorizationDenied
from app.platform.security.principal import Principal
from app.platform.security.types import Role

if TYPE_CHECKING:
    from app.modules.jobs.models import JobDescription
    from app.modules.profiles.api import ProfilesApi
    from app.modules.profiles.schemas import JdContactabilityInput, SeniorContactDTO
    from app.platform.db.unit_of_work import UnitOfWork
    from app.platform.taxonomy.resolver import SkillResolver


# ── Transition table (R6 AC2–AC4) ─────────────────────────────────────────────

VALID_TRANSITIONS: frozenset[tuple[JdStatus, JdStatus]] = frozenset(
    {
        (JdStatus.DRAFT, JdStatus.OPEN),
        (JdStatus.OPEN, JdStatus.CLOSED),
    }
)


# ── Helpers ────────────────────────────────────────────────────────────────────


def _jd_to_dto(jd: JobDescription, skill_ids: list[UUID]) -> JobDescriptionDTO:
    """Convert a JobDescription ORM instance to a response DTO."""
    return JobDescriptionDTO(
        id=jd.id,
        creator_account_id=jd.creator_account_id,
        title=jd.title,
        company=jd.company,
        location=jd.location,
        work_model=jd.work_model,
        employment_type=jd.employment_type,
        experience_level=jd.experience_level,
        description=jd.description,
        external_url=jd.external_url,
        status=jd.status,
        application_channel=jd.application_channel,
        published_at=jd.published_at,
        closed_at=jd.closed_at,
        required_skill_ids=skill_ids,
        created_at=jd.created_at,
        updated_at=jd.updated_at,
    )


async def _resolve_skill_terms(
    terms: list[str],
    skill_resolver: SkillResolver,
) -> list[UUID]:
    """Resolve a list of skill terms to UUIDs, silently dropping unresolvable ones.

    Terms that resolve with ``skill_id is None`` (flagged-unlinked) are stored
    for Admin review by the SkillResolver but not attached to the JD.
    """
    skill_ids: list[UUID] = []
    seen: set[UUID] = set()
    for term in terms:
        try:
            resolution = await skill_resolver.resolve(term)
            if resolution.skill_id is not None and resolution.skill_id not in seen:
                seen.add(resolution.skill_id)
                skill_ids.append(resolution.skill_id)
        except Exception:  # noqa: BLE001
            # EmptySkillTerm or resolution failure — skip, don't block creation.
            pass
    return skill_ids


# ── SSRF Guard ─────────────────────────────────────────────────────────────────

_PRIVATE_NETWORKS: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fe80::/10"),
    ipaddress.ip_network("fc00::/7"),
]


def _is_private(addr: str) -> bool:
    """Return True if ``addr`` falls in a private/reserved IP range."""
    try:
        ip = ipaddress.ip_address(addr)
        return any(ip in net for net in _PRIVATE_NETWORKS)
    except ValueError:
        return True  # treat unparseable as private


def _ssrf_guard(url: str) -> None:
    """Raise ValidationFailed if the URL resolves to a private/reserved address.

    Rejects: loopback (127.0.0.0/8, ::1), link-local (169.254.0.0/16,
    fe80::/10), private (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
    fc00::/7), CGNAT (100.64.0.0/10), and cloud metadata (169.254.169.254).

    This function calls ``socket.getaddrinfo()`` synchronously. It must only be
    called from the ARQ worker context, never from the request path.

    Args:
        url: The raw URL string from the extraction request.

    Raises:
        ValidationFailed: If the URL scheme is not http/https, the hostname
            cannot be resolved, or any resolved address is private/reserved.
    """
    from urllib.parse import urlparse  # noqa: PLC0415

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValidationFailed(
            fields=[FieldViolation(path="url", code="invalid_scheme")]
        )
    hostname = parsed.hostname
    if not hostname:
        raise ValidationFailed(
            fields=[FieldViolation(path="url", code="missing_hostname")]
        )
    try:
        results = socket.getaddrinfo(hostname, None)
    except OSError:
        raise ValidationFailed(
            fields=[FieldViolation(path="url", code="dns_resolution_failed")]
        )
    for result in results:
        addr = result[4][0]
        if _is_private(addr):
            raise ValidationFailed(
                fields=[FieldViolation(path="url", code="private_address_rejected")]
            )


# ── JobDescriptionService ─────────────────────────────────────────────────────


class JobDescriptionService:
    """Domain service for Job Description CRUD and lifecycle management (R6)."""

    def __init__(
        self,
        uow_factory: Any,
        *,
        skill_resolver: SkillResolver,
    ) -> None:
        self._uow_factory = uow_factory
        self._skill_resolver = skill_resolver

    # ── Internal helpers ───────────────────────────────────────────────────────

    def _assert_not_closed(self, jd: JobDescription) -> None:
        """Raise JdEditForbiddenWhenClosed if the JD is in CLOSED status."""
        if jd.status == JdStatus.CLOSED:
            raise JdEditForbiddenWhenClosed()

    def _assert_caller_owns_or_is_admin(
        self, jd: JobDescription, principal: Principal
    ) -> None:
        """Raise AuthorizationDenied if the caller is not the owner or an Admin."""
        if principal.is_admin:
            return
        if jd.creator_account_id != principal.account_id:
            raise AuthorizationDenied()

    async def _fetch_jd_or_deny(
        self,
        session: Any,
        jd_id: UUID,
        *,
        creator_id: UUID | None = None,
    ) -> JobDescription:
        """Fetch a JD or raise AuthorizationDenied (never 404)."""
        jd = await repo.get_jd(session, jd_id, creator_id=creator_id)
        if jd is None:
            raise AuthorizationDenied()
        return jd

    async def _load_jd_dto(self, session: Any, jd: JobDescription) -> JobDescriptionDTO:
        skill_ids = await repo.get_jd_skill_ids(session, jd.id)
        return _jd_to_dto(jd, skill_ids)

    # ── Public interface ───────────────────────────────────────────────────────

    async def create(
        self, principal: Principal, data: JdCreateRequest
    ) -> JobDescriptionDTO:
        """Create a new Job Description in DRAFT status.

        Args:
            principal: The authenticated caller (Senior or Admin).
            data: The creation request body.

        Returns:
            The newly created JobDescriptionDTO.
        """
        # Resolve skill terms before opening the transaction.
        skill_ids = await _resolve_skill_terms(
            data.required_skill_terms, self._skill_resolver
        )

        async with self._uow_factory() as uow:
            jd = await repo.create_jd(
                uow.session,
                creator_account_id=principal.account_id,
                title=data.title,
                company=data.company,
                location=data.location,
                work_model=data.work_model,
                employment_type=data.employment_type,
                experience_level=data.experience_level,
                description=data.description,
                external_url=data.external_url,
                application_channel=data.application_channel,
            )
            if skill_ids:
                await repo.set_jd_required_skills(uow.session, jd.id, skill_ids)
            dto = await self._load_jd_dto(uow.session, jd)
        return dto

    async def get(self, jd_id: UUID, principal: Principal) -> JobDescriptionDTO:
        """Fetch a Job Description, enforcing per-role visibility rules.

        - Admin: sees all statuses.
        - Senior: sees own JDs (any status) and Open JDs from anyone.
        - Candidate: sees only Open JDs.

        Raises AuthorizationDenied for any access the principal is not
        entitled to (never reveals existence).

        Args:
            jd_id: The Job Description UUID.
            principal: The authenticated caller.

        Returns:
            The JobDescriptionDTO.

        Raises:
            AuthorizationDenied: If the JD does not exist or the caller lacks
                permission to view it.
        """
        async with self._uow_factory() as uow:
            jd = await repo.get_jd(uow.session, jd_id)

            if jd is None:
                raise AuthorizationDenied()

            # Admin sees everything.
            if principal.is_admin:
                pass
            # Senior sees own JDs OR any Open JD.
            elif principal.acting_as(Role.SENIOR):
                if (
                    jd.creator_account_id != principal.account_id
                    and jd.status != JdStatus.OPEN
                ):
                    raise AuthorizationDenied()
            # Candidate (or Senior acting as Candidate) sees only Open.
            else:
                if jd.status != JdStatus.OPEN:
                    raise AuthorizationDenied()

            dto = await self._load_jd_dto(uow.session, jd)
        return dto

    async def update(
        self,
        jd_id: UUID,
        principal: Principal,
        data: JdUpdateRequest,
    ) -> JobDescriptionDTO:
        """Patch a Job Description.

        Only the creator or an Admin may update. The JD must be in DRAFT or
        OPEN status (editing a CLOSED JD raises JdEditForbiddenWhenClosed).

        Args:
            jd_id: Target JD UUID.
            principal: Authenticated caller.
            data: Fields to update (only supplied fields are applied).

        Returns:
            The updated JobDescriptionDTO.

        Raises:
            AuthorizationDenied: Caller not owner/Admin or JD not found.
            JdEditForbiddenWhenClosed: JD is already closed.
        """
        updates: dict[str, Any] = {}
        new_skill_terms: list[str] | None = None

        for field, value in data.model_dump(exclude_unset=True).items():
            if field == "required_skill_terms":
                new_skill_terms = value
            else:
                updates[field] = value

        # Resolve new skills outside the transaction if supplied.
        new_skill_ids: list[UUID] | None = None
        if new_skill_terms is not None:
            new_skill_ids = await _resolve_skill_terms(
                new_skill_terms, self._skill_resolver
            )

        async with self._uow_factory() as uow:
            jd = await self._fetch_jd_or_deny(uow.session, jd_id)
            self._assert_caller_owns_or_is_admin(jd, principal)
            self._assert_not_closed(jd)

            if updates:
                await repo.update_jd_fields(uow.session, jd, **updates)
            if new_skill_ids is not None:
                await repo.set_jd_required_skills(uow.session, jd.id, new_skill_ids)

            dto = await self._load_jd_dto(uow.session, jd)
        return dto

    async def publish(
        self, jd_id: UUID, principal: Principal
    ) -> JobDescriptionDTO:
        """Transition a Job Description from DRAFT to OPEN.

        Validates that the External_Careers_URL is present when the application
        channel is EXTERNAL_CAREERS_URL (R6 AC16).

        Args:
            jd_id: Target JD UUID.
            principal: Authenticated caller.

        Returns:
            The updated JobDescriptionDTO.

        Raises:
            AuthorizationDenied: Caller not owner/Admin or JD not found.
            JdPublishPreconditionFailed: Transition is invalid or preconditions unmet.
            JdAlreadyClosed: JD is already closed.
        """
        async with self._uow_factory() as uow:
            jd = await self._fetch_jd_or_deny(uow.session, jd_id)
            self._assert_caller_owns_or_is_admin(jd, principal)

            if jd.status == JdStatus.CLOSED:
                raise JdAlreadyClosed()

            if (jd.status, JdStatus.OPEN) not in VALID_TRANSITIONS:
                raise JdPublishPreconditionFailed(
                    unmet=["status_must_be_draft"],
                    log_message=f"Invalid transition {jd.status} → Open",
                )

            # Validate External_Careers_URL precondition (R6 AC16).
            unmet: list[str] = []
            if (
                jd.application_channel == ApplicationChannel.EXTERNAL_CAREERS_URL
                and not jd.external_url
            ):
                unmet.append("external_url_required_for_external_channel")

            if unmet:
                raise JdPublishPreconditionFailed(unmet=unmet)

            await repo.set_jd_status(
                uow.session,
                jd,
                JdStatus.OPEN,
                published_at=utc_now(),
            )
            dto = await self._load_jd_dto(uow.session, jd)
        return dto

    async def close(
        self, jd_id: UUID, principal: Principal
    ) -> JobDescriptionDTO:
        """Transition a Job Description from OPEN to CLOSED.

        Sets ``closed_at`` to now. Cascading application closure is the
        caller's responsibility (ApplicationService) and must happen within
        the same transaction for atomicity.

        Args:
            jd_id: Target JD UUID.
            principal: Authenticated caller.

        Returns:
            The updated JobDescriptionDTO.

        Raises:
            AuthorizationDenied: Caller not owner/Admin or JD not found.
            JdAlreadyClosed: JD is already closed.
            JdPublishPreconditionFailed: Invalid transition (e.g. DRAFT → CLOSED).
        """
        async with self._uow_factory() as uow:
            jd = await self._fetch_jd_or_deny(uow.session, jd_id)
            self._assert_caller_owns_or_is_admin(jd, principal)

            if jd.status == JdStatus.CLOSED:
                raise JdAlreadyClosed()

            if (jd.status, JdStatus.CLOSED) not in VALID_TRANSITIONS:
                raise JdPublishPreconditionFailed(
                    unmet=["status_must_be_open"],
                    log_message=f"Invalid transition {jd.status} → Closed",
                )

            await repo.set_jd_status(
                uow.session,
                jd,
                JdStatus.CLOSED,
                closed_at=utc_now(),
            )
            dto = await self._load_jd_dto(uow.session, jd)
        return dto

    async def set_application_channel(
        self,
        jd_id: UUID,
        principal: Principal,
        channel: ApplicationChannel,
    ) -> JobDescriptionDTO:
        """Set the application channel on a DRAFT or OPEN JD.

        Args:
            jd_id: Target JD UUID.
            principal: Authenticated caller.
            channel: The new application channel.

        Returns:
            The updated JobDescriptionDTO.

        Raises:
            AuthorizationDenied: Caller not owner/Admin or JD not found.
            JdEditForbiddenWhenClosed: JD is already closed.
        """
        async with self._uow_factory() as uow:
            jd = await self._fetch_jd_or_deny(uow.session, jd_id)
            self._assert_caller_owns_or_is_admin(jd, principal)
            self._assert_not_closed(jd)
            await repo.set_jd_application_channel(uow.session, jd, channel)
            dto = await self._load_jd_dto(uow.session, jd)
        return dto

    async def browse(
        self, principal: Principal, params: JdBrowseParams
    ) -> JdBrowsePage:
        """Return a paginated list of Open Job Descriptions.

        Accessible by any authenticated account in APPROVED status.

        Args:
            principal: Authenticated caller (unused beyond the guard in router).
            params: Filters and cursor parameters.

        Returns:
            A JdBrowsePage with items and pagination metadata.
        """
        async with self._uow_factory() as uow:
            rows = await repo.list_open_jds(
                uow.session,
                search=params.search,
                skills=params.skills,
                location=params.location,
                work_model=params.work_model,
                employment_type=params.employment_type,
                experience_level=params.experience_level,
                after_published_at=params.after_published_at,
                after_id=params.after_id,
                limit=params.limit,
            )
            has_next = len(rows) > params.limit
            rows = rows[: params.limit]

            dtos: list[JobDescriptionDTO] = []
            for jd in rows:
                skill_ids = await repo.get_jd_skill_ids(uow.session, jd.id)
                dtos.append(_jd_to_dto(jd, skill_ids))

        next_cursor: str | None = None
        if has_next and dtos:
            last = dtos[-1]
            # Cursor encodes published_at and id for the next page.
            import base64, json  # noqa: PLC0415, E401
            cursor_data = {
                "after_published_at": last.published_at.isoformat() if last.published_at else None,
                "after_id": str(last.id),
            }
            next_cursor = base64.urlsafe_b64encode(
                json.dumps(cursor_data).encode()
            ).decode().rstrip("=")

        return JdBrowsePage(items=dtos, has_next=has_next, next_cursor=next_cursor)

    async def list_for_admin(self, params: JdAdminListParams) -> JdBrowsePage:
        """Return a paginated list of all Job Descriptions for Admin.

        Args:
            params: Filter and pagination parameters.

        Returns:
            A JdBrowsePage.
        """
        async with self._uow_factory() as uow:
            rows = await repo.list_jds_for_admin(
                uow.session,
                status=params.status,
                after_id=params.after_id,
                limit=params.limit,
            )
            has_next = len(rows) > params.limit
            rows = rows[: params.limit]
            dtos: list[JobDescriptionDTO] = []
            for jd in rows:
                skill_ids = await repo.get_jd_skill_ids(uow.session, jd.id)
                dtos.append(_jd_to_dto(jd, skill_ids))

        return JdBrowsePage(items=dtos, has_next=has_next, next_cursor=None)

    async def list_for_senior(
        self, senior_id: UUID, params: JdAdminListParams
    ) -> JdBrowsePage:
        """Return a paginated list of Job Descriptions owned by a Senior.

        Args:
            senior_id: The Senior's account UUID.
            params: Pagination parameters.

        Returns:
            A JdBrowsePage.
        """
        async with self._uow_factory() as uow:
            rows = await repo.list_jds_for_senior(
                uow.session,
                senior_id,
                after_id=params.after_id,
                limit=params.limit,
            )
            has_next = len(rows) > params.limit
            rows = rows[: params.limit]
            dtos: list[JobDescriptionDTO] = []
            for jd in rows:
                skill_ids = await repo.get_jd_skill_ids(uow.session, jd.id)
                dtos.append(_jd_to_dto(jd, skill_ids))

        return JdBrowsePage(items=dtos, has_next=has_next, next_cursor=None)

    async def get_contactable_seniors(
        self,
        jd_id: UUID,
        principal: Principal,
        profiles_api: ProfilesApi,
    ) -> list[SeniorContactDTO]:
        """Return a list of Seniors contactable for the given JD.

        Loads the JD, builds the JdContactabilityInput, and delegates to
        ProfilesApi.contactable_seniors_for_jd.

        Args:
            jd_id: The JD UUID.
            principal: The authenticated caller.
            profiles_api: The cross-module ProfilesApi interface.

        Returns:
            List of SeniorContactDTO.

        Raises:
            AuthorizationDenied: JD not found or caller has no access.
        """
        from app.modules.profiles.schemas import JdContactabilityInput  # noqa: PLC0415

        async with self._uow_factory() as uow:
            jd = await self._fetch_jd_or_deny(uow.session, jd_id)
            skill_ids = await repo.get_jd_skill_ids(uow.session, jd.id)

        jd_input = JdContactabilityInput(
            jd_creator_id=jd.creator_account_id,
            jd_company=jd.company,
            jd_skill_ids=skill_ids,
        )
        return await profiles_api.contactable_seniors_for_jd(jd_input)


# ── Heuristic extraction helpers ───────────────────────────────────────────────

_TITLE_RE = re.compile(r"(?i)(?:job\s*title|position|role)\s*[:\-]\s*([^\n]+)")
_COMPANY_RE = re.compile(r"(?i)(?:company|employer|organization)\s*[:\-]\s*([^\n]+)")
_LOCATION_RE = re.compile(r"(?i)(?:location|city|office)\s*[:\-]\s*([^\n]+)")
_EMPLOYMENT_TYPE_RE = re.compile(
    r"(?i)\b(full[\-\s]?time|part[\-\s]?time|contract|freelance|internship)\b"
)
_WORK_MODEL_RE = re.compile(r"(?i)\b(remote|hybrid|on[\-\s]?site|onsite)\b")
_EXPERIENCE_RE = re.compile(
    r"(?i)\b(junior|mid[\-\s]?level|senior[\-\s]?level|lead|entry[\-\s]?level)\b"
)


def _heuristic_extract(text: str) -> dict[str, Any]:
    """Extract structured fields from free-form JD text using regex heuristics.

    This is the Phase-1 extractor. Phase 2 will replace this with the AI_Engine.

    Args:
        text: Raw job description text.

    Returns:
        Dict of extracted field names to values (only keys with matches).
    """
    fields: dict[str, Any] = {}

    m = _TITLE_RE.search(text)
    if m:
        fields["title"] = m.group(1).strip()

    m = _COMPANY_RE.search(text)
    if m:
        fields["company"] = m.group(1).strip()

    m = _LOCATION_RE.search(text)
    if m:
        fields["location"] = m.group(1).strip()

    m = _EMPLOYMENT_TYPE_RE.search(text)
    if m:
        raw = m.group(1).lower().replace("-", "").replace(" ", "")
        mapping = {
            "fulltime": "Full-time",
            "parttime": "Part-time",
            "contract": "Contract",
            "freelance": "Freelance",
            "internship": "Internship",
        }
        fields["employment_type"] = mapping.get(raw)

    m = _WORK_MODEL_RE.search(text)
    if m:
        raw = m.group(1).lower().replace("-", "").replace(" ", "")
        mapping = {"remote": "Remote", "hybrid": "Hybrid", "onsite": "Onsite"}
        fields["work_model"] = mapping.get(raw)

    m = _EXPERIENCE_RE.search(text)
    if m:
        raw = m.group(1).lower().replace("-", "").replace(" ", "")
        mapping = {
            "junior": "Junior-level",
            "midlevel": "Mid-level",
            "seniorlevel": "Senior-level",
            "lead": "Lead",
            "entrylevel": "Junior-level",
        }
        fields["experience_level"] = mapping.get(raw)

    return fields


# ── JdExtractionService ────────────────────────────────────────────────────────


class JdExtractionService:
    """Phase-1 JD extraction pipeline (R6 AC1a–1h).

    Extraction is asynchronous: the caller gets a draft ID immediately, then
    polls GET /jobs/extract/{draft_id} until ``status == 'ready'``. The worker
    (ARQ job) populates ``extracted_fields`` and ``skill_candidates``.
    """

    DRAFT_TTL_HOURS: int = 24
    MAX_TEXT_LENGTH: int = 10_000

    def __init__(
        self,
        uow_factory: Any,
        *,
        skill_resolver: SkillResolver,
    ) -> None:
        self._uow_factory = uow_factory
        self._skill_resolver = skill_resolver

    def _expires_at(self) -> datetime:
        return datetime.now(UTC) + timedelta(hours=self.DRAFT_TTL_HOURS)

    def _draft_status(self, draft: Any) -> str:
        """Return 'ready' when the worker has populated extracted_fields."""
        return "ready" if draft.extracted_fields else "pending"

    @staticmethod
    def _ssrf_guard(url: str) -> None:
        """Public entry point for the SSRF guard (called from worker context)."""
        _ssrf_guard(url)

    async def submit_url_extraction(
        self, url: str, principal: Principal
    ) -> JdExtractionDraftDTO:
        """Submit a URL for async extraction.

        Creates a stub draft immediately and enqueues the ``extract_jd_from_url``
        ARQ task. The SSRF guard is run by the worker before fetching the URL.

        Args:
            url: The public URL of a job posting page.
            principal: The authenticated caller.

        Returns:
            A draft DTO in ``pending`` status.
        """
        if len(url) > 500:
            raise ValidationFailed(
                fields=[FieldViolation(path="url", code="max_length_exceeded")]
            )

        async with self._uow_factory() as uow:
            draft = await repo.create_extraction_draft(
                uow.session,
                creator_account_id=principal.account_id,
                source="url",
                source_url=url,
                raw_content=None,
                extracted_fields={},
                skill_candidates=[],
                expires_at=self._expires_at(),
            )
            dto = self._to_dto(draft)
        return dto

    async def submit_text_extraction(
        self, raw_text: str, principal: Principal
    ) -> JdExtractionDraftDTO:
        """Submit raw text for async extraction.

        Trims to MAX_TEXT_LENGTH, creates a stub draft, and enqueues the
        ``extract_jd_from_text`` ARQ task.

        Args:
            raw_text: The pasted or uploaded job description text.
            principal: The authenticated caller.

        Returns:
            A draft DTO in ``pending`` status.
        """
        trimmed = raw_text[: self.MAX_TEXT_LENGTH]

        async with self._uow_factory() as uow:
            draft = await repo.create_extraction_draft(
                uow.session,
                creator_account_id=principal.account_id,
                source="text",
                source_url=None,
                raw_content=trimmed,
                extracted_fields={},
                skill_candidates=[],
                expires_at=self._expires_at(),
            )
            dto = self._to_dto(draft)
        return dto

    async def get_draft(
        self, draft_id: UUID, principal: Principal
    ) -> JdExtractionDraftDTO:
        """Fetch an extraction draft by id.

        Only the creator or an Admin may poll a draft.

        Args:
            draft_id: The draft UUID.
            principal: The authenticated caller.

        Returns:
            The current draft DTO.

        Raises:
            AuthorizationDenied: Draft not found or caller not the owner.
        """
        creator_id = None if principal.is_admin else principal.account_id

        async with self._uow_factory() as uow:
            draft = await repo.get_extraction_draft(
                uow.session, draft_id, creator_id=creator_id
            )
            if draft is None:
                raise AuthorizationDenied()
            dto = self._to_dto(draft)
        return dto

    async def confirm_draft(
        self,
        draft_id: UUID,
        principal: Principal,
        data: JdCreateRequest,
    ) -> JobDescriptionDTO:
        """Confirm an extraction draft into a real Job Description.

        Validates all fields (full R6 AC1 validation), creates the JD in DRAFT
        status, then deletes the extraction draft.

        Args:
            draft_id: The draft to confirm.
            principal: The authenticated caller.
            data: The fully populated JD creation data (caller fills gaps from draft).

        Returns:
            The newly created JobDescriptionDTO.

        Raises:
            AuthorizationDenied: Draft not found or not owned by caller.
            ExtractionDraftExpired: Draft has passed its TTL.
        """
        creator_id = None if principal.is_admin else principal.account_id

        # Resolve skills before opening the transaction.
        skill_ids = await _resolve_skill_terms(
            data.required_skill_terms, self._skill_resolver
        )

        async with self._uow_factory() as uow:
            draft = await repo.get_extraction_draft(
                uow.session, draft_id, creator_id=creator_id
            )
            if draft is None:
                raise AuthorizationDenied()
            if draft.expires_at < datetime.now(UTC):
                raise ExtractionDraftExpired()

            jd = await repo.create_jd(
                uow.session,
                creator_account_id=principal.account_id,
                title=data.title,
                company=data.company,
                location=data.location,
                work_model=data.work_model,
                employment_type=data.employment_type,
                experience_level=data.experience_level,
                description=data.description,
                external_url=data.external_url,
                application_channel=data.application_channel,
            )
            if skill_ids:
                await repo.set_jd_required_skills(uow.session, jd.id, skill_ids)
            await repo.delete_extraction_draft(uow.session, draft)
            dto = await JobDescriptionService(
                self._uow_factory, skill_resolver=self._skill_resolver
            )._load_jd_dto(uow.session, jd)
        return dto

    def _to_dto(self, draft: Any) -> JdExtractionDraftDTO:
        return JdExtractionDraftDTO(
            id=draft.id,
            source=draft.source,
            status=self._draft_status(draft),
            extracted_fields=draft.extracted_fields or {},
            skill_candidates=draft.skill_candidates or [],
            created_at=draft.created_at,
            expires_at=draft.expires_at,
        )


__all__ = [
    "JdExtractionService",
    "JobDescriptionService",
    "_heuristic_extract",
    "_ssrf_guard",
]
