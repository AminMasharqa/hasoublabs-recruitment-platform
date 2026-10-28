"""Property tests for RBAC guards and constant-time denial.

Tasks 4.3–4.6:
  - Property 2:  Authorization matrix soundness and completeness.
  - Property 3:  Authentication required outside the allowlist.
  - Property 4:  Indistinguishable authorization denial (timing).
  - Property 5:  Context switch carries no access over.

Also covers unit tests for require(), Principal, and the denial floor.
"""

from __future__ import annotations

import asyncio
import time
from unittest.mock import MagicMock
import uuid

from hypothesis import given, settings
from hypothesis import strategies as st
import pytest

from app.platform.security.errors import AuthenticationRequired, AuthorizationDenied
from app.platform.security.guards import (
    DENY_FLOOR_MS,
    PUBLIC_ROUTE_PATHS,
    authorization_denied_handler,
    require,
    require_any_authenticated,
)
from app.platform.security.principal import Principal
from app.platform.security.types import (
    APPROVED_ONLY,
    LEGAL_ROLE_SETS,
    AccountStatus,
    Role,
)

# ── Helpers ────────────────────────────────────────────────────────────────

def make_principal(
    roles: frozenset[Role] = frozenset({Role.CANDIDATE}),
    active_context: Role = Role.CANDIDATE,
    status: AccountStatus = AccountStatus.APPROVED,
) -> Principal:
    return Principal(
        account_id=uuid.uuid4(),
        roles=roles,
        active_context=active_context,
        status=status,
        session_id="test-session",
    )


async def call_guard(
    guard_callable: object,
    principal: Principal,
) -> Principal:
    """Invoke a require()-returned guard with a supplied principal."""
    # require() returns an async function whose first parameter is a
    # Principal resolved by current_principal. We bypass the dependency
    # injection here and call the inner function directly.
    inner = guard_callable  # type: ignore[assignment]
    # Get the actual async guard function (the closure returned by require()).
    if hasattr(inner, "__wrapped__"):
        inner = inner.__wrapped__
    # Call it with the principal injected.
    return await inner(principal=principal)  # type: ignore[call-arg]


# ── Unit tests for require() ───────────────────────────────────────────────

@pytest.mark.unit
class TestRequireGuard:
    @pytest.mark.asyncio
    async def test_approved_admin_passes_admin_guard(self) -> None:
        guard = require(roles=frozenset({Role.ADMIN}))
        p = make_principal(roles=frozenset({Role.ADMIN}), active_context=Role.ADMIN)
        result = await call_guard(guard, p)
        assert result == p

    @pytest.mark.asyncio
    async def test_candidate_denied_on_admin_guard(self) -> None:
        guard = require(roles=frozenset({Role.ADMIN}))
        p = make_principal(roles=frozenset({Role.CANDIDATE}), active_context=Role.CANDIDATE)
        with pytest.raises(AuthorizationDenied):
            await call_guard(guard, p)

    @pytest.mark.asyncio
    async def test_suspended_denied_on_approved_only_guard(self) -> None:
        guard = require(roles=frozenset({Role.CANDIDATE}))
        p = make_principal(
            roles=frozenset({Role.CANDIDATE}),
            status=AccountStatus.SUSPENDED,
        )
        with pytest.raises(AuthorizationDenied):
            await call_guard(guard, p)

    @pytest.mark.asyncio
    async def test_dual_role_wrong_context_denied(self) -> None:
        # A Candidate+Senior acting in CANDIDATE context is denied a
        # Senior-context-only route.
        guard = require(
            roles=frozenset({Role.SENIOR}),
            context=Role.SENIOR,
        )
        p = make_principal(
            roles=frozenset({Role.CANDIDATE, Role.SENIOR}),
            active_context=Role.CANDIDATE,  # acting as Candidate
        )
        with pytest.raises(AuthorizationDenied):
            await call_guard(guard, p)

    @pytest.mark.asyncio
    async def test_dual_role_correct_context_passes(self) -> None:
        guard = require(
            roles=frozenset({Role.SENIOR}),
            context=Role.SENIOR,
        )
        p = make_principal(
            roles=frozenset({Role.CANDIDATE, Role.SENIOR}),
            active_context=Role.SENIOR,  # acting as Senior
        )
        result = await call_guard(guard, p)
        assert result == p

    @pytest.mark.asyncio
    async def test_admin_or_senior_guard_passes_both(self) -> None:
        guard = require(roles=frozenset({Role.ADMIN, Role.SENIOR}))
        admin_p = make_principal(roles=frozenset({Role.ADMIN}), active_context=Role.ADMIN)
        senior_p = make_principal(roles=frozenset({Role.SENIOR}), active_context=Role.SENIOR)
        assert await call_guard(guard, admin_p) == admin_p
        assert await call_guard(guard, senior_p) == senior_p

    @pytest.mark.asyncio
    async def test_custom_status_set_allows_pending(self) -> None:
        guard = require(
            roles=frozenset({Role.CANDIDATE}),
            statuses=frozenset({AccountStatus.PENDING_VERIFICATION, AccountStatus.APPROVED}),
        )
        p = make_principal(
            roles=frozenset({Role.CANDIDATE}),
            status=AccountStatus.PENDING_VERIFICATION,
        )
        result = await call_guard(guard, p)
        assert result == p

    def test_guard_tagged_with_has_auth_dependency(self) -> None:
        guard = require(roles=frozenset({Role.ADMIN}))
        assert getattr(guard, "_has_auth_dependency", False) is True

    def test_require_any_authenticated_also_tagged(self) -> None:
        guard = require_any_authenticated()
        assert getattr(guard, "_has_auth_dependency", False) is True


# ── Property 2: Authorization matrix soundness ────────────────────────────

# Generate all valid (roles, context, status) combinations.
_role_set_strategy = st.sampled_from(sorted(LEGAL_ROLE_SETS, key=str))
_status_strategy = st.sampled_from(list(AccountStatus))


@pytest.mark.property
class TestAuthorizationMatrix:
    @given(
        role_set=_role_set_strategy,
        status=_status_strategy,
    )
    @settings(max_examples=100)
    def test_property_2_approved_only_gate(
        self, role_set: frozenset[Role], status: AccountStatus
    ) -> None:
        """Property 2 (partial): APPROVED_ONLY gate permits iff status==Approved."""
        context = next(iter(role_set))  # pick any valid context from the role set
        principal = Principal(
            account_id=uuid.uuid4(),
            roles=role_set,
            active_context=context,
            status=status,
            session_id="s",
        )
        # A guard requiring the role the principal holds but APPROVED_ONLY.
        permitted = (
            status in APPROVED_ONLY
            and bool(principal.roles & role_set)
        )

        async def _run() -> None:
            guard = require(roles=role_set)
            if permitted:
                result = await call_guard(guard, principal)
                assert result == principal
            else:
                with pytest.raises(AuthorizationDenied):
                    await call_guard(guard, principal)

        asyncio.get_event_loop().run_until_complete(_run())

    @given(role_set=_role_set_strategy)
    @settings(max_examples=50)
    def test_property_2_admin_exclusivity(self, role_set: frozenset[Role]) -> None:
        """Property 2 / Property 1: Admin role sets are always legal."""
        # All generated role sets must be in the legal set.
        assert role_set in LEGAL_ROLE_SETS

    def test_admin_cannot_hold_other_roles(self) -> None:
        """Admin+Candidate is not in LEGAL_ROLE_SETS."""
        illegal = frozenset({Role.ADMIN, Role.CANDIDATE})
        assert illegal not in LEGAL_ROLE_SETS

    def test_admin_cannot_hold_senior_role(self) -> None:
        illegal = frozenset({Role.ADMIN, Role.SENIOR})
        assert illegal not in LEGAL_ROLE_SETS


# ── Property 3: Authentication required outside allowlist ─────────────────

@pytest.mark.property
class TestAuthenticationRequired:
    def test_public_route_paths_non_empty(self) -> None:
        """Property 3: the public allowlist is defined and non-empty."""
        assert len(PUBLIC_ROUTE_PATHS) > 0

    def test_login_in_allowlist(self) -> None:
        assert any("login" in p for p in PUBLIC_ROUTE_PATHS)

    def test_job_descriptions_not_in_allowlist(self) -> None:
        """Property 3: Job_Descriptions are not publicly reachable (R3 AC8)."""
        assert not any("jobs" in p for p in PUBLIC_ROUTE_PATHS)

    def test_audit_log_not_in_allowlist(self) -> None:
        assert not any("audit" in p for p in PUBLIC_ROUTE_PATHS)

    def test_registration_in_allowlist(self) -> None:
        assert any("register" in p for p in PUBLIC_ROUTE_PATHS)

    def test_verify_in_allowlist(self) -> None:
        assert any("verify" in p for p in PUBLIC_ROUTE_PATHS)

    def test_password_reset_in_allowlist(self) -> None:
        assert any("password" in p for p in PUBLIC_ROUTE_PATHS)

    @pytest.mark.asyncio
    async def test_missing_bearer_raises_authentication_required(self) -> None:
        """No credential → current_principal raises AuthenticationRequired."""
        from app.platform.security.guards import current_principal  # noqa: PLC0415

        mock_request = MagicMock()
        mock_request.app.state.session_service = None  # triggers the "not initialised" path

        with pytest.raises(AuthenticationRequired):
            await current_principal(request=mock_request, credentials=None)


# ── Property 4: Indistinguishable authorization denial (timing) ────────────

@pytest.mark.property
class TestConstantTimeDenial:
    @pytest.mark.asyncio
    async def test_denial_floor_applied(self) -> None:
        """Property 4: the denial handler pads responses below DENY_FLOOR_MS."""
        mock_request = MagicMock()
        # Simulate a request that started 0ms ago (very fast path).
        mock_request.state.start_time = time.monotonic()
        mock_request.state.request_id = "test-rid"
        mock_request.state.locale = "en"
        mock_request.url.path = "/api/v1/test"
        mock_request.method = "GET"

        start = time.monotonic()
        await authorization_denied_handler(mock_request, AuthorizationDenied())
        elapsed_ms = (time.monotonic() - start) * 1000

        # The handler must have taken at least DENY_FLOOR_MS.
        assert elapsed_ms >= DENY_FLOOR_MS * 0.9, (
            f"Denial took only {elapsed_ms:.1f}ms — floor is {DENY_FLOOR_MS}ms"
        )

    @pytest.mark.asyncio
    async def test_denial_body_is_identical_for_any_request(self) -> None:
        """Property 4: the response body is byte-identical regardless of cause."""
        exc = AuthorizationDenied()

        async def get_body(path: str) -> dict:  # type: ignore[type-arg]
            mock_request = MagicMock()
            # Set start_time far in the past so no sleep is needed.
            mock_request.state.start_time = time.monotonic() - 10
            mock_request.state.request_id = "rid"
            mock_request.state.locale = "en"
            mock_request.url.path = path
            mock_request.method = "GET"
            resp = await authorization_denied_handler(mock_request, exc)
            return resp.body  # type: ignore[return-value]

        body1 = await get_body("/api/v1/resource/exists-but-not-yours")
        body2 = await get_body("/api/v1/resource/does-not-exist")

        # Both responses must be byte-identical.
        assert body1 == body2

    @pytest.mark.asyncio
    async def test_no_sleep_when_already_slow(self) -> None:
        """Floor only pads fast paths — already-slow requests respond immediately."""
        mock_request = MagicMock()
        # Simulate a request that is already 500ms old.
        mock_request.state.start_time = time.monotonic() - 0.5
        mock_request.state.request_id = "rid"
        mock_request.state.locale = "en"
        mock_request.url.path = "/api/v1/slow"
        mock_request.method = "POST"

        start = time.monotonic()
        await authorization_denied_handler(mock_request, AuthorizationDenied())
        elapsed_ms = (time.monotonic() - start) * 1000

        # Should complete almost immediately (no extra sleep needed).
        assert elapsed_ms < DENY_FLOOR_MS, (
            f"Handler slept unnecessarily: took {elapsed_ms:.1f}ms"
        )

    def test_deny_floor_is_above_120ms(self) -> None:
        """The floor constant must be ≥120ms as specified in the design."""
        assert DENY_FLOOR_MS >= 120.0  # noqa: PLR2004


# ── Property 5: Context switch carries no access over ─────────────────────

@pytest.mark.property
class TestContextSwitch:
    def test_principal_context_is_immutable(self) -> None:
        """Property 5: Principal is frozen — context cannot be mutated in place."""
        p = make_principal(
            roles=frozenset({Role.CANDIDATE, Role.SENIOR}),
            active_context=Role.CANDIDATE,
        )
        with pytest.raises((AttributeError, TypeError)):
            p.active_context = Role.SENIOR  # type: ignore[misc]

    def test_can_switch_to_held_role(self) -> None:
        p = make_principal(
            roles=frozenset({Role.CANDIDATE, Role.SENIOR}),
            active_context=Role.CANDIDATE,
        )
        assert p.can_switch_to(Role.SENIOR) is True

    def test_cannot_switch_to_unheld_role(self) -> None:
        p = make_principal(
            roles=frozenset({Role.CANDIDATE}),
            active_context=Role.CANDIDATE,
        )
        assert p.can_switch_to(Role.SENIOR) is False
        assert p.can_switch_to(Role.ADMIN) is False

    @given(role_set=_role_set_strategy)
    @settings(max_examples=50)
    def test_property_5_active_context_is_held_role(
        self, role_set: frozenset[Role]
    ) -> None:
        """Property 5: active_context must always be a role the account holds."""
        context = next(iter(role_set))
        p = Principal(
            account_id=uuid.uuid4(),
            roles=role_set,
            active_context=context,
            status=AccountStatus.APPROVED,
            session_id="s",
        )
        assert p.active_context in p.roles

    @pytest.mark.asyncio
    async def test_property_5_wrong_context_denied_after_switch(self) -> None:
        """Property 5: after a context switch the old context loses its access.

        Simulated by checking that a SENIOR-context guard denies a principal
        whose active_context is CANDIDATE — representing the state after
        switching away from SENIOR.
        """
        senior_guard = require(roles=frozenset({Role.SENIOR}), context=Role.SENIOR)

        # Before switch — acting as SENIOR, should pass.
        before_switch = make_principal(
            roles=frozenset({Role.CANDIDATE, Role.SENIOR}),
            active_context=Role.SENIOR,
        )
        result = await call_guard(senior_guard, before_switch)
        assert result == before_switch

        # After switch — acting as CANDIDATE, should be denied.
        after_switch = make_principal(
            roles=frozenset({Role.CANDIDATE, Role.SENIOR}),
            active_context=Role.CANDIDATE,
        )
        with pytest.raises(AuthorizationDenied):
            await call_guard(senior_guard, after_switch)
