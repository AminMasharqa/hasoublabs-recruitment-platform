"""Profiles service layer — domain logic and transaction orchestration (Task 15.3).

Three service components:

* :class:`CompletenessEvaluator` — pure in-memory predicate (R4 AC6, AC7).
* :class:`CandidateProfileService` — get/create/update with validation (R4).
* :class:`SeniorProfileService` — get/create/update with validation (R4A).
* :class:`ContactabilityEvaluator` — contactable-seniors query (R4A AC4).
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse
from uuid import UUID

from app.modules.profiles import repository as repo
from app.modules.profiles.errors import (
    ContactPreferenceInvalid,
    FieldViolation,
    ProfileValidationFailed,
    SkillLimitExceeded,
)
from app.modules.profiles.models import CandidateProfile, SeniorProfile
from app.modules.profiles.schemas import (
    CandidateProfileDTO,
    CandidateProfileUpdateRequest,
    Completeness,
    EducationEntryDTO,
    LanguageEntryDTO,
    SeniorContactDTO,
    SeniorProfileDTO,
    SeniorProfileUpdateRequest,
    SkillEntryDTO,
    WorkExperienceDTO,
)
from app.platform.db.base import utc_now
from app.platform.db.enums import ContactChannelPref, ProfileState
from app.platform.db.unit_of_work import UnitOfWork

if TYPE_CHECKING:
    from app.modules.cvs.api import CvsApi
    from app.platform.taxonomy.resolver import SkillResolver

_LOG = logging.getLogger(__name__)

# ── Completeness Evaluator ────────────────────────────────────────────────────


class CompletenessEvaluator:
    """Single total predicate for profile completeness (R4 AC6).

    Called everywhere completeness is needed. The ``evaluate`` method is pure,
    synchronous, and has no I/O — it operates on an already-loaded
    ``CandidateProfile`` ORM object.

    ``is_application_ready`` extends the check with a CV-existence lookup (R4 AC7).
    """

    def evaluate(self, profile: CandidateProfile) -> Completeness:
        """Evaluate completeness from the in-memory profile object.

        All required fields must be present and non-empty for ``state=Complete``.
        Returns the current state and the list of missing field names (empty list
        when complete).

        Complete conditions (all of the below):
        - full_name non-empty
        - email non-empty
        - phone non-empty
        - city non-empty
        - at least 1 education entry
        - at least 1 skill
        """
        missing: list[str] = []

        if not profile.full_name or not profile.full_name.strip():
            missing.append("full_name")
        if not profile.email or not profile.email.strip():
            missing.append("email")
        if not profile.phone or not profile.phone.strip():
            missing.append("phone")
        if not profile.city or not profile.city.strip():
            missing.append("city")

        # These rely on the relations being loaded; the service always passes a
        # fully hydrated profile.
        education_loaded = profile.education if profile.education is not None else []
        skills_loaded = profile.skills if profile.skills is not None else []

        if not education_loaded:
            missing.append("education")
        if not skills_loaded:
            missing.append("skills")

        state = ProfileState.COMPLETE if not missing else ProfileState.DRAFT
        return Completeness(state=state.value, missing_fields=missing)

    async def is_application_ready(
        self,
        account_id: UUID,
        cvs_api: CvsApi,
    ) -> tuple[bool, list[str]]:
        """Extend evaluate() with a CV existence check (R4 AC7).

        Returns:
            ``(ready, missing_fields)`` where ``ready`` is True only when the
            profile is Complete *and* the account has at least one CV version.
        """
        # Completeness requires a hydrated profile — the caller must ensure the
        # profile exists. We cannot load it here without a session; this method
        # is intended to be called from DefaultProfilesApi which already holds
        # the profile.
        raise NotImplementedError(
            "Call DefaultProfilesApi.get_completeness for the full check; "
            "is_application_ready requires a loaded profile object — use "
            "_evaluate_application_ready instead."
        )

    async def _evaluate_application_ready(
        self,
        profile: CandidateProfile,
        cvs_api: CvsApi,
    ) -> tuple[bool, list[str]]:
        """Internal variant that takes the already-loaded profile.

        Args:
            profile: Fully loaded ``CandidateProfile`` ORM object.
            cvs_api: The CvsApi cross-module interface.

        Returns:
            ``(ready, missing_fields)`` — True only when Complete *and* has a CV.
        """
        completeness = self.evaluate(profile)
        missing = list(completeness.missing_fields)

        has_cv = await cvs_api.has_any_version(profile.account_id)
        if not has_cv:
            missing.append("cv")

        ready = not missing
        return ready, missing


# ── DTO Builders ──────────────────────────────────────────────────────────────


def _build_candidate_dto(
    profile: CandidateProfile,
    skill_names: dict[UUID, str],
) -> CandidateProfileDTO:
    """Build a CandidateProfileDTO from a hydrated ORM object.

    Args:
        profile: Fully loaded profile (relations must be accessible).
        skill_names: Mapping from skill_id → canonical skill name for display.
    """
    education_dtos = [
        EducationEntryDTO.model_validate(e) for e in (profile.education or [])
    ]
    work_dtos = [
        WorkExperienceDTO.model_validate(w) for w in (profile.work_experience or [])
    ]
    skill_dtos = [
        SkillEntryDTO(
            skill_id=s.skill_id,
            name=skill_names.get(s.skill_id, ""),
            years_experience=s.years_experience,
        )
        for s in (profile.skills or [])
    ]
    lang_dtos = [
        LanguageEntryDTO.model_validate(lg) for lg in (profile.languages or [])
    ]

    return CandidateProfileDTO(
        id=profile.id,
        account_id=profile.account_id,
        full_name=profile.full_name,
        email=profile.email,
        phone=profile.phone,
        city=profile.city,
        summary=profile.summary,
        linkedin_url=profile.linkedin_url,
        state=profile.state,
        education=education_dtos,
        work_experience=work_dtos,
        skills=skill_dtos,
        languages=lang_dtos,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


async def _load_skill_names(
    session: Any,  # AsyncSession
    skill_ids: list[UUID],
) -> dict[UUID, str]:
    """Fetch canonical skill names for a list of skill UUIDs.

    Returns an empty dict when there are no skill_ids.
    """
    if not skill_ids:
        return {}

    from sqlalchemy import select as sa_select  # noqa: PLC0415
    from app.platform.taxonomy.models import Skill  # noqa: PLC0415

    result = await session.execute(
        sa_select(Skill.id, Skill.normalized_name).where(Skill.id.in_(skill_ids))
    )
    return {row.id: row.normalized_name for row in result}


def _build_senior_dto(
    profile: SeniorProfile,
    skill_names: dict[UUID, str],
) -> SeniorProfileDTO:
    """Build a SeniorProfileDTO from a hydrated ORM object."""
    expertise_names = [
        skill_names.get(se.skill_id, "")
        for se in (profile.expertise_skills or [])
    ]
    return SeniorProfileDTO(
        id=profile.id,
        account_id=profile.account_id,
        full_name=profile.full_name,
        company_affiliation=profile.company_affiliation,
        job_title=profile.job_title,
        contact_channel_pref=profile.contact_channel_pref,
        contact_scope_pref=profile.contact_scope_pref,
        expertise_skills=expertise_names,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


# ── Validation helpers ────────────────────────────────────────────────────────


def _validate_e164_phone(value: str) -> bool:
    """Return True if ``value`` is a valid E.164 phone number."""
    try:
        import phonenumbers  # noqa: PLC0415

        parsed = phonenumbers.parse(value)
        return phonenumbers.is_valid_number(parsed)
    except Exception:  # noqa: BLE001
        return False


def _validate_linkedin_url(url: str) -> bool:
    """Return True if ``url`` is an https URL."""
    parsed = urlparse(url)
    return parsed.scheme == "https" and bool(parsed.netloc)


async def _check_email_domain_dns(domain: str, timeout: float = 5.0) -> bool:
    """Best-effort DNS MX/A record check for the email domain (R4 implicit).

    Returns True if the domain resolves or if the lookup times out / errors
    (DNS failure is non-fatal by design — we never block registration on it).
    """
    import socket  # noqa: PLC0415

    try:
        loop = asyncio.get_event_loop()
        await asyncio.wait_for(
            loop.run_in_executor(None, socket.getaddrinfo, domain, None),
            timeout=timeout,
        )
        return True
    except asyncio.TimeoutError:
        _LOG.debug("DNS check timed out for domain %s", domain)
        return True  # best-effort: don't block on timeout
    except OSError:
        return False


# ── Candidate Profile Service ─────────────────────────────────────────────────


class CandidateProfileService:
    """Orchestrates candidate profile CRUD with full validation (R4).

    Args:
        uow_factory: Zero-argument callable that returns a new :class:`UnitOfWork`.
        skill_resolver: The :class:`SkillResolver` instance for taxonomy lookups.
        dns_cache_ttl_seconds: Positive-result DNS cache TTL (currently unused;
            reserved for a Valkey-backed implementation).
    """

    def __init__(
        self,
        uow_factory: Any,
        *,
        skill_resolver: SkillResolver,
        dns_cache_ttl_seconds: int = 86400,
    ) -> None:
        self._uow_factory = uow_factory
        self._skill_resolver = skill_resolver
        self._dns_cache_ttl = dns_cache_ttl_seconds
        self._evaluator = CompletenessEvaluator()

    async def get_or_create(self, account_id: UUID) -> CandidateProfileDTO:
        """Return the candidate's profile, creating an empty one if needed.

        Args:
            account_id: The candidate's account UUID.

        Returns:
            The hydrated :class:`CandidateProfileDTO`.
        """
        async with self._uow_factory() as uow:
            profile = await repo.get_candidate_profile_with_relations(
                uow.session, account_id
            )
            if profile is None:
                await repo.create_candidate_profile(
                    uow.session, account_id, full_name=""
                )
                # Flush to get the profile ID before returning.
                await uow.session.flush()
                # Reload with empty relations.
                profile = await repo.get_candidate_profile_with_relations(
                    uow.session, account_id
                )
            assert profile is not None  # always set by get_or_create path
            skill_ids = [s.skill_id for s in (profile.skills or [])]
            skill_names = await _load_skill_names(uow.session, skill_ids)
        return _build_candidate_dto(profile, skill_names)

    async def update(
        self, account_id: UUID, data: CandidateProfileUpdateRequest
    ) -> CandidateProfileDTO:
        """Validate and apply an update to the candidate's profile.

        Validation rules (all checked before any write):
        1. RFC 5322 email (via ``email-validator``) if provided.
        2. E.164 phone via ``phonenumbers`` if provided.
        3. HTTPS LinkedIn URL if provided.
        4. DNS resolvability of email domain (best-effort, 5 s timeout).
        5. Cross-field: education end_year >= start_year.
        6. Cross-field: work experience end_date >= start_date.

        All skills are resolved via SkillResolver before writing.

        After a successful write, completeness is re-evaluated and
        ``profile.state`` is updated atomically.

        Args:
            account_id: The candidate's account UUID.
            data: The update payload.

        Returns:
            The updated :class:`CandidateProfileDTO`.

        Raises:
            ProfileValidationFailed: If any validation rule fails. Contains the
                complete list of ``FieldViolation`` items.
            SkillLimitExceeded: If more than 20 skills are submitted.
        """
        violations: list[FieldViolation] = []

        # --- Scalar field validation ---
        if data.email is not None:
            try:
                from email_validator import validate_email  # noqa: PLC0415

                validate_email(data.email, check_deliverability=False)
                # DNS check is best-effort; we do it here but never reject on it.
                parsed_domain = data.email.split("@")[-1]
                await _check_email_domain_dns(parsed_domain, timeout=5.0)
            except Exception:  # noqa: BLE001
                violations.append(
                    FieldViolation(path="email", code="invalid_email_format")
                )

        if data.phone is not None and not _validate_e164_phone(data.phone):
            violations.append(
                FieldViolation(path="phone", code="invalid_e164_phone")
            )

        if data.linkedin_url is not None and not _validate_linkedin_url(data.linkedin_url):
            violations.append(
                FieldViolation(path="linkedin_url", code="invalid_https_url")
            )

        # --- Cross-field education validation ---
        if data.education is not None:
            for idx, edu in enumerate(data.education):
                if edu.end_year is not None and edu.end_year < edu.start_year:
                    violations.append(
                        FieldViolation(
                            path=f"education[{idx}].end_year",
                            code="end_before_start",
                            params={"start_year": edu.start_year, "end_year": edu.end_year},
                        )
                    )

        # --- Cross-field work experience validation ---
        if data.work_experience is not None:
            for idx, exp in enumerate(data.work_experience):
                if exp.end_date is not None and exp.end_date < exp.start_date:
                    violations.append(
                        FieldViolation(
                            path=f"work_experience[{idx}].end_date",
                            code="end_before_start",
                            params={
                                "start_date": str(exp.start_date),
                                "end_date": str(exp.end_date),
                            },
                        )
                    )

        # --- Skill count limit ---
        if data.skills is not None and len(data.skills) > 20:
            raise SkillLimitExceeded(
                log_message=f"Candidate {account_id} submitted {len(data.skills)} skills (max 20)"
            )

        if violations:
            raise ProfileValidationFailed(fields=violations)

        # --- Resolve skills before touching the DB ---
        resolved_skill_ids_years: list[tuple[UUID, int | None]] = []
        if data.skills is not None:
            for entry in data.skills:
                resolution = await self._skill_resolver.resolve(entry.term)
                if resolution.skill_id is not None:
                    resolved_skill_ids_years.append(
                        (resolution.skill_id, entry.years_experience)
                    )

        # --- Write (all-or-nothing inside the UoW) ---
        async with self._uow_factory() as uow:
            profile = await repo.get_candidate_profile_with_relations(
                uow.session, account_id
            )
            if profile is None:
                profile = await repo.create_candidate_profile(
                    uow.session, account_id, full_name=data.full_name or ""
                )
                await uow.session.flush()
                profile = await repo.get_candidate_profile_with_relations(
                    uow.session, account_id
                )
            assert profile is not None  # always set by the create path above

            # Apply scalar updates.
            scalar_updates: dict[str, object] = {}
            for field_name in ("full_name", "email", "phone", "city", "summary", "linkedin_url"):
                value = getattr(data, field_name)
                if value is not None:
                    scalar_updates[field_name] = value

            if scalar_updates:
                await repo.update_candidate_profile(uow.session, profile, **scalar_updates)

            # Replace child collections when provided.
            if data.education is not None:
                edu_dicts = [
                    {
                        "institution": e.institution,
                        "degree": e.degree,
                        "field_of_study": e.field_of_study,
                        "enrolment_status": e.enrolment_status,
                        "start_year": e.start_year,
                        "end_year": e.end_year,
                    }
                    for e in data.education
                ]
                await repo.replace_education(uow.session, profile.id, account_id, edu_dicts)

            if data.work_experience is not None:
                exp_dicts = [
                    {
                        "company": e.company,
                        "title": e.title,
                        "start_date": e.start_date,
                        "end_date": e.end_date,
                        "description": e.description,
                    }
                    for e in data.work_experience
                ]
                await repo.replace_work_experience(
                    uow.session, profile.id, account_id, exp_dicts
                )

            if data.skills is not None:
                await repo.replace_skills(
                    uow.session, profile.id, account_id, resolved_skill_ids_years
                )

            if data.languages is not None:
                lang_dicts = [
                    {"language_code": lg.language_code, "proficiency": lg.proficiency}
                    for lg in data.languages
                ]
                await repo.replace_languages(uow.session, profile.id, account_id, lang_dicts)

            # Re-evaluate completeness on the freshly mutated profile.
            profile = await repo.get_candidate_profile_with_relations(
                uow.session, account_id
            )
            assert profile is not None  # cannot disappear within the same transaction
            completeness = self._evaluator.evaluate(profile)
            from app.platform.db.enums import ProfileState as _PS  # noqa: PLC0415

            new_state = (
                _PS.COMPLETE if completeness.state == _PS.COMPLETE.value else _PS.DRAFT
            )
            if profile.state != new_state:
                await repo.update_candidate_profile(
                    uow.session, profile, state=new_state
                )

            skill_ids = [s.skill_id for s in (profile.skills or [])]
            skill_names = await _load_skill_names(uow.session, skill_ids)

        return _build_candidate_dto(profile, skill_names)

    async def get_for_admin(self, account_id: UUID) -> CandidateProfileDTO:
        """Load any candidate's profile for Admin inspection.

        Args:
            account_id: The candidate's account UUID.

        Returns:
            The fully hydrated :class:`CandidateProfileDTO`.
        """
        async with self._uow_factory() as uow:
            profile = await repo.get_candidate_profile_with_relations(
                uow.session, account_id
            )
            if profile is None:
                from app.platform.security.errors import AuthorizationDenied  # noqa: PLC0415

                raise AuthorizationDenied()
            skill_ids = [s.skill_id for s in (profile.skills or [])]
            skill_names = await _load_skill_names(uow.session, skill_ids)
        return _build_candidate_dto(profile, skill_names)


# ── Senior Profile Service ────────────────────────────────────────────────────


class SeniorProfileService:
    """Orchestrates senior profile CRUD with validation (R4A).

    Args:
        uow_factory: Zero-argument callable that returns a new :class:`UnitOfWork`.
        skill_resolver: The :class:`SkillResolver` instance for taxonomy lookups.
    """

    def __init__(
        self,
        uow_factory: Any,
        *,
        skill_resolver: SkillResolver,
    ) -> None:
        self._uow_factory = uow_factory
        self._skill_resolver = skill_resolver

    async def get_or_create(self, account_id: UUID) -> SeniorProfileDTO:
        """Return the senior's profile, creating an empty one if needed.

        Args:
            account_id: The senior's account UUID.

        Returns:
            The :class:`SeniorProfileDTO`.
        """
        async with self._uow_factory() as uow:
            profile = await repo.get_senior_profile(uow.session, account_id)
            if profile is None:
                await repo.create_senior_profile(
                    uow.session, account_id, full_name=""
                )
                await uow.session.flush()
                profile = await repo.get_senior_profile(uow.session, account_id)
            assert profile is not None  # always set by the create path
            skill_ids = [se.skill_id for se in (profile.expertise_skills or [])]
            skill_names = await _load_skill_names(uow.session, skill_ids)
        return _build_senior_dto(profile, skill_names)

    async def update(
        self, account_id: UUID, data: SeniorProfileUpdateRequest
    ) -> SeniorProfileDTO:
        """Validate and apply an update to the senior's profile.

        Validation rules:
        1. If ``contact_channel_pref`` != 'None', ``contact_scope_pref`` is required.
        2. If ``contact_channel_pref`` != 'None', ``company_affiliation`` is required.
        3. 1-10 expertise skills allowed.

        Args:
            account_id: The senior's account UUID.
            data: The update payload.

        Returns:
            The updated :class:`SeniorProfileDTO`.

        Raises:
            ContactPreferenceInvalid: If the contact-preference combination is invalid.
        """
        violations: list[FieldViolation] = []

        effective_channel = data.contact_channel_pref
        effective_scope = data.contact_scope_pref
        effective_company = data.company_affiliation

        # For validation, we need the current profile state when only some fields change.
        # We do a preliminary load inside its own read context, then write.
        async with self._uow_factory() as uow:
            current = await repo.get_senior_profile(uow.session, account_id)

        if current is not None:
            if effective_channel is None:
                effective_channel = current.contact_channel_pref
            if effective_scope is None:
                effective_scope = current.contact_scope_pref
            if effective_company is None:
                effective_company = current.company_affiliation

        channel_requires_scope = (
            effective_channel is not None
            and effective_channel != ContactChannelPref.NONE
        )
        if channel_requires_scope and effective_scope is None:
            violations.append(
                FieldViolation(
                    path="contact_scope_pref",
                    code="required_when_contactable",
                )
            )
        if channel_requires_scope and not effective_company:
            violations.append(
                FieldViolation(
                    path="company_affiliation",
                    code="required_when_contactable",
                )
            )

        if data.expertise_skills is not None:
            if not (1 <= len(data.expertise_skills) <= 10):
                violations.append(
                    FieldViolation(
                        path="expertise_skills",
                        code="count_out_of_range",
                        params={"min": 1, "max": 10},
                    )
                )

        if violations:
            raise ContactPreferenceInvalid(fields=violations)

        # Resolve expertise skills.
        resolved_skill_ids: list[UUID] = []
        if data.expertise_skills is not None:
            for term in data.expertise_skills:
                resolution = await self._skill_resolver.resolve(term)
                if resolution.skill_id is not None:
                    resolved_skill_ids.append(resolution.skill_id)

        async with self._uow_factory() as uow:
            profile = await repo.get_senior_profile(uow.session, account_id)
            if profile is None:
                await repo.create_senior_profile(
                    uow.session, account_id, full_name=data.full_name or ""
                )
                await uow.session.flush()
                profile = await repo.get_senior_profile(uow.session, account_id)
            assert profile is not None  # always set by the create path
            scalar_updates: dict[str, object] = {}
            for field_name in (
                "full_name",
                "company_affiliation",
                "job_title",
                "contact_channel_pref",
                "contact_scope_pref",
            ):
                value = getattr(data, field_name)
                if value is not None:
                    scalar_updates[field_name] = value

            if scalar_updates:
                await repo.update_senior_profile(uow.session, profile, **scalar_updates)

            if data.expertise_skills is not None:
                await repo.replace_senior_expertise_skills(
                    uow.session, account_id, resolved_skill_ids
                )
                reloaded = await repo.get_senior_profile(uow.session, account_id)
                if reloaded is not None:
                    profile = reloaded

            skill_ids = [se.skill_id for se in (profile.expertise_skills or [])]
            skill_names = await _load_skill_names(uow.session, skill_ids)

        return _build_senior_dto(profile, skill_names)

    async def get_for_admin(self, account_id: UUID) -> SeniorProfileDTO:
        """Load any senior's profile for Admin inspection.

        Args:
            account_id: The senior's account UUID.

        Returns:
            The :class:`SeniorProfileDTO`.
        """
        async with self._uow_factory() as uow:
            profile = await repo.get_senior_profile(uow.session, account_id)
            if profile is None:
                from app.platform.security.errors import AuthorizationDenied  # noqa: PLC0415

                raise AuthorizationDenied()
            skill_ids = [se.skill_id for se in (profile.expertise_skills or [])]
            skill_names = await _load_skill_names(uow.session, skill_ids)
        return _build_senior_dto(profile, skill_names)


# ── Contactability Evaluator ──────────────────────────────────────────────────


class ContactabilityEvaluator:
    """Evaluates which seniors are contactable for a given JD (R4A AC4).

    The result is never cached — every call executes the SQL predicate fresh.

    Args:
        uow_factory: Zero-argument callable returning a new :class:`UnitOfWork`.
    """

    def __init__(self, uow_factory: Any) -> None:
        self._uow_factory = uow_factory

    async def contactable_seniors_for_jd(
        self,
        jd_creator_id: UUID,
        jd_company: str,
        jd_skill_ids: list[UUID],
    ) -> list[SeniorContactDTO]:
        """Return all seniors contactable for the given JD.

        Args:
            jd_creator_id: The account_id of the Senior who created the JD.
            jd_company: The company name from the JD (used for SameCompany scope).
            jd_skill_ids: Canonical skill UUIDs associated with the JD.

        Returns:
            List of :class:`SeniorContactDTO` — never cached.
        """
        async with self._uow_factory() as uow:
            pairs = await repo.contactable_seniors_for_jd(
                uow.session,
                jd_creator_id=jd_creator_id,
                jd_company_norm=jd_company,
                jd_skill_ids=jd_skill_ids,
            )

        return [
            SeniorContactDTO(
                account_id=profile.account_id,
                full_name=profile.full_name,
                contact_channel_pref=profile.contact_channel_pref.value,
            )
            for profile, _email in pairs
        ]
