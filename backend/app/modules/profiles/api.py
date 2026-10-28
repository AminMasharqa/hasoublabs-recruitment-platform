"""ProfilesApi — public interface for cross-module access (Task 15.4).

Other modules must ONLY import from ``api.py`` or ``schemas.py`` in this module.
They must never import from ``models.py``, ``repository.py``, or ``service.py``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from app.modules.profiles.schemas import (
    ApplicantCardDTO,
    Completeness,
    JdContactabilityInput,
    SeniorContactDTO,
)

if TYPE_CHECKING:
    from app.modules.cvs.api import CvsApi
    from app.platform.taxonomy.resolver import SkillResolver


# ── Protocol ──────────────────────────────────────────────────────────────────

try:
    from typing import Protocol, runtime_checkable
except ImportError:  # pragma: no cover
    from typing_extensions import Protocol, runtime_checkable  # type: ignore[assignment]


@runtime_checkable
class ProfilesApi(Protocol):
    """Cross-module interface for profile operations.

    All methods must be awaitable. No implementation detail leaks through
    this interface — callers depend only on this contract.
    """

    async def get_completeness(self, account_id: UUID) -> Completeness:
        """Return the completeness status of a candidate's profile.

        Used by the applications module to gate application submission (R7 AC1).

        Args:
            account_id: The candidate's account UUID.

        Returns:
            A :class:`Completeness` DTO with ``state`` and ``missing_fields``.
        """
        ...

    async def contactable_seniors_for_jd(
        self, jd: JdContactabilityInput
    ) -> list[SeniorContactDTO]:
        """Return all seniors contactable for the given JD (R4A AC4).

        Args:
            jd: Input parameters describing the JD.

        Returns:
            List of :class:`SeniorContactDTO` — never cached.
        """
        ...

    async def candidate_public_card(self, account_id: UUID) -> ApplicantCardDTO:
        """Return the RESTRICTED three-field applicant card for a candidate.

        This is the ONLY profile data a Senior may ever receive about a Candidate.
        The return type is deliberately ``ApplicantCardDTO`` (three fields only)
        — no other profile data is returned or logged.

        Args:
            account_id: The candidate's account UUID.

        Returns:
            An :class:`ApplicantCardDTO` with full_name, applied_role_title, and
            application_status only.
        """
        ...


# ── Default Implementation ────────────────────────────────────────────────────


class DefaultProfilesApi:
    """Concrete implementation of :class:`ProfilesApi`.

    Wired by the application lifespan / DI container and injected into modules
    that need profile data. Never imported by other modules directly — they
    depend on the :class:`ProfilesApi` protocol.

    Args:
        uow_factory: Zero-argument callable returning a new :class:`UnitOfWork`.
        cvs_api: The cross-module CvsApi interface (for CV existence check).
        skill_resolver: Taxonomy skill resolver (for get_completeness context).
    """

    def __init__(
        self,
        uow_factory: Any,
        *,
        cvs_api: CvsApi,
        skill_resolver: SkillResolver | None = None,
    ) -> None:
        self._uow_factory = uow_factory
        self._cvs_api = cvs_api
        self._skill_resolver = skill_resolver

    async def get_completeness(self, account_id: UUID) -> Completeness:
        """Evaluate and return the profile completeness for a candidate.

        Loads the profile with relations, runs CompletenessEvaluator, and
        composes with CV existence check (R4 AC7).

        Args:
            account_id: The candidate's account UUID.

        Returns:
            :class:`Completeness` DTO with state and missing_fields.
        """
        from app.modules.profiles import repository as repo  # noqa: PLC0415
        from app.modules.profiles.service import CompletenessEvaluator  # noqa: PLC0415

        evaluator = CompletenessEvaluator()

        async with self._uow_factory() as uow:
            profile = await repo.get_candidate_profile_with_relations(
                uow.session, account_id
            )

        if profile is None:
            # No profile yet — treat as fully incomplete.
            return Completeness(
                state="Draft",
                missing_fields=["full_name", "email", "phone", "city", "education", "skills", "cv"],
            )

        _, missing = await evaluator._evaluate_application_ready(  # noqa: SLF001
            profile, self._cvs_api
        )
        from app.platform.db.enums import ProfileState  # noqa: PLC0415

        state = ProfileState.COMPLETE.value if not missing else ProfileState.DRAFT.value
        return Completeness(state=state, missing_fields=missing)

    async def contactable_seniors_for_jd(
        self, jd: JdContactabilityInput
    ) -> list[SeniorContactDTO]:
        """Delegate to ContactabilityEvaluator (never cached).

        Args:
            jd: Input parameters describing the JD.

        Returns:
            List of :class:`SeniorContactDTO`.
        """
        from app.modules.profiles.service import ContactabilityEvaluator  # noqa: PLC0415

        evaluator = ContactabilityEvaluator(self._uow_factory)
        return await evaluator.contactable_seniors_for_jd(
            jd_creator_id=jd.jd_creator_id,
            jd_company=jd.jd_company,
            jd_skill_ids=jd.jd_skill_ids,
        )

    async def candidate_public_card(self, account_id: UUID) -> ApplicantCardDTO:
        """Return ONLY the three permitted fields for a candidate (RBAC: Senior view).

        The full_name comes from the candidate's profile. The applied_role_title
        and application_status are placeholders that the applications module must
        supply — this implementation returns the profile's full_name and empty
        sentinel values, so the applications module must compose the final card.

        Note: In a full implementation the applications module would call this via
        ProfilesApi to get the name, and supply the role/status itself. The card
        DTO is defined here to enforce the field restriction at the type level.

        Args:
            account_id: The candidate's account UUID.

        Returns:
            :class:`ApplicantCardDTO` with full_name only resolved from profile.

        Raises:
            AuthorizationDenied: If no profile exists for this account.
        """
        from app.modules.profiles import repository as repo  # noqa: PLC0415

        async with self._uow_factory() as uow:
            profile = await repo.get_candidate_profile(uow.session, account_id)

        if profile is None:
            from app.platform.security.errors import AuthorizationDenied  # noqa: PLC0415

            raise AuthorizationDenied()

        # Return only the restricted fields. applied_role_title and
        # application_status MUST be filled in by the caller (applications module).
        return ApplicantCardDTO(
            full_name=profile.full_name,
            applied_role_title="",      # caller must supply
            application_status="",      # caller must supply
        )


__all__ = ["DefaultProfilesApi", "ProfilesApi"]
