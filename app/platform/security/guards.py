"""RBAC authorization guards and constant-time denial path.

Tasks 4.1 and 4.2 — Requirements: 3.1–3.8, 3.10–3.11, 1.5, 1.21.
Property tests: 2 (auth matrix), 3 (allowlist), 4 (timing), 5 (context switch).

Design invariants enforced here:
  1. Permissions derive SOLELY from role set + active context + status.
     Zero per-user overrides (R3 AC1).
  2. AuthorizationDenied is the ONLY error raised for both "not permitted"
     and "resource does not exist" (R3 AC6). No 404 leaks ownership info.
  3. The denial handler enforces a fixed-latency floor (DENY_FLOOR_MS).
     No jitter. Jitter is defeated by averaging; a floor is not (R3 AC6).
  4. Every route must declare a guard or be in PUBLIC_ROUTE_PATHS.
     Enforced by: (a) Semgrep CI rule, (b) boot-time startup assertion.
  5. Context switching issues a new token pair and rotates the session.
     No state from the prior context survives (R3 AC10).
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import TYPE_CHECKING

from fastapi import Depends, FastAPI, Request
from fastapi.responses import ORJSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.platform.security.errors import AuthenticationRequired, AuthorizationDenied

if TYPE_CHECKING:
    from collections.abc import Callable
from app.platform.security.principal import Principal
from app.platform.security.types import APPROVED_ONLY, AccountStatus, Role

logger = logging.getLogger(__name__)

# ── Public route allowlist ─────────────────────────────────────────────────
# Routes that are exempt from the authorization-dependency requirement (R3 AC8).
# Matched as prefix against route.path.
# Job_Descriptions are explicitly NOT in this list (R3 AC8).
PUBLIC_ROUTE_PATHS: frozenset[str] = frozenset(
    {
        "/health",
        "/api/v1/auth/login",
        "/api/v1/auth/refresh",
        "/api/v1/auth/password-reset",
        "/api/v1/register",           # registration form; link validation
        "/api/v1/verify",             # verification code entry
        "/api/v1/registration-links", # Admin-generated link fetch (public token)
    }
)

# ── Bearer token extractor ─────────────────────────────────────────────────
_bearer = HTTPBearer(auto_error=False)


# ── current_principal dependency ───────────────────────────────────────────

async def current_principal(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> Principal:
    """FastAPI dependency that resolves the authenticated principal.

    Validates the Bearer JWT, looks up the Valkey session, extends the
    sliding TTL, and returns a frozen Principal.

    Raises:
        AuthenticationRequired: if no valid credential is present.
    """
    if credentials is None or not credentials.credentials:
        raise AuthenticationRequired("No authorization credential provided")

    # SessionService is stored on app.state (set up during lifespan).
    session_service = getattr(request.app.state, "session_service", None)
    if session_service is None:
        # Should never happen in production — guards the startup path.
        raise AuthenticationRequired("Session service not initialised")

    payload = await session_service.validate_access_token(credentials.credentials)

    account_id_str: str = payload.get("sub", "")
    session_id: str = payload.get("session_id", "")
    act: str = payload.get("act", "")
    roles_raw: list[str] = payload.get("roles", [])

    if not account_id_str or not session_id or not act or not roles_raw:
        raise AuthenticationRequired("Token is missing required claims")

    try:
        import uuid  # noqa: PLC0415
        account_id = uuid.UUID(account_id_str)
        active_context = Role(act)
        roles = frozenset(Role(r) for r in roles_raw)
    except (ValueError, KeyError) as exc:
        raise AuthenticationRequired(f"Token contains invalid claims: {exc}") from exc

    # The authoritative account status comes from the Valkey session record
    # (loaded and refreshed by validate_access_token).
    # We need the status to enforce the APPROVED_ONLY gate.
    # session_service exposes a helper to retrieve the current session data.
    session_data = await session_service._load_session(session_id)  # noqa: SLF001
    if session_data is None:
        raise AuthenticationRequired("Session not found")

    try:
        status = AccountStatus(session_data["status"])
    except (KeyError, ValueError) as exc:
        raise AuthenticationRequired(f"Session has invalid status: {exc}") from exc

    return Principal(
        account_id=account_id,
        roles=roles,
        active_context=active_context,
        status=status,
        session_id=session_id,
    )


# ── require() guard factory ────────────────────────────────────────────────

def require(
    *,
    roles: frozenset[Role],
    context: Role | None = None,
    statuses: frozenset[AccountStatus] = APPROVED_ONLY,
) -> Callable[..., object]:
    """Return a FastAPI dependency guard that enforces RBAC (R3 AC1).

    Permission is granted if and only if ALL three conditions hold:
      1. principal.status is in `statuses`
      2. principal.roles ∩ roles is non-empty
      3. if `context` is specified, principal.active_context == context

    On failure, raises AuthorizationDenied (never 404, never a message that
    leaks whether the resource exists — R3 AC6).

    Args:
        roles:    Set of roles that may access the route.
        context:  Optional exact active-context requirement. Use when a route
                  should only be accessible while acting as a specific role
                  (e.g. Candidates may only submit under Candidate context).
        statuses: Required account status set. Defaults to APPROVED_ONLY.
                  Override for routes accessible to pending/suspended accounts
                  (e.g. the status-notice screen).

    Usage:
        # Admin-only
        @router.get("/admin/accounts")
        async def list_accounts(
            principal: Principal = Depends(require(roles=frozenset({Role.ADMIN})))
        ): ...

        # Candidate context only
        @router.post("/me/cv-variants")
        async def create_cv_variant(
            principal: Principal = Depends(
                require(roles=frozenset({Role.CANDIDATE}), context=Role.CANDIDATE)
            )
        ): ...

        # Admin or Senior (Senior sees only own applicants; filtered in service)
        @router.get("/jobs/{jd_id}/applicants")
        async def list_applicants(
            principal: Principal = Depends(
                require(roles=frozenset({Role.ADMIN, Role.SENIOR}))
            )
        ): ...
    """

    async def _guard(
        principal: Principal = Depends(current_principal),
    ) -> Principal:
        ok = (
            principal.status in statuses
            and bool(principal.roles & roles)
            and (context is None or principal.active_context is context)
        )
        if not ok:
            raise AuthorizationDenied()
        # Mark that this dependency was satisfied (used by startup assertion).
        return principal

    # Tag the inner function so the startup assertion can detect it.
    _guard._has_auth_dependency = True  # type: ignore[attr-defined]
    return _guard


# ── Status-notice guard (R3 AC11, R1 AC21) ────────────────────────────────
# All authenticated accounts may reach the status-notice screen regardless
# of their account status.
def require_any_authenticated() -> Callable[..., object]:
    """Guard that accepts any account with a valid session, regardless of status."""

    async def _guard(
        principal: Principal = Depends(current_principal),
    ) -> Principal:
        # current_principal already validates JWT + session liveness.
        # No additional status check here.
        return principal

    _guard._has_auth_dependency = True  # type: ignore[attr-defined]
    return _guard


# ── Constant-time denial handler ──────────────────────────────────────────
# This is registered on the FastAPI app in main.py.
# It is defined here so it lives next to the floor constant it uses.

DENY_FLOOR_MS: float = 120.0  # milliseconds; tuned above p99 of fastest path


async def authorization_denied_handler(
    request: Request, exc: AuthorizationDenied  # noqa: ARG001
) -> ORJSONResponse:
    """Byte-identical 403 response with fixed-latency floor (R3 AC6).

    Mechanism 3 of 3 for constant-time denial:
      - Mechanism 1 (guard order): guards run before handler — no row lookup.
      - Mechanism 2 (single type): only AuthorizationDenied is ever raised.
      - Mechanism 3 (timing floor): pad responses slower than DENY_FLOOR_MS.

    No jitter is added. Averaging samples defeats jitter; a floor is not
    defeatable by averaging (design.md §Constant-Time Authorization Denial).
    """
    from fastapi.responses import ORJSONResponse  # noqa: PLC0415 — already imported at top

    elapsed_ms = (time.monotonic() - request.state.start_time) * 1000
    if elapsed_ms < DENY_FLOOR_MS:
        await asyncio.sleep((DENY_FLOOR_MS - elapsed_ms) / 1000)

    # Log the denial for audit (R3 AC9) — the audit module will persist this.
    # We fire-and-forget into a background task so the response is not delayed.
    _schedule_denial_audit(request, exc)

    return ORJSONResponse(
        status_code=403,
        content={
            "error": "not_authorized",
            "message": _get_denial_message(request),
            "request_id": getattr(request.state, "request_id", None),
        },
    )


async def authentication_required_handler(
    request: Request, exc: AuthenticationRequired  # noqa: ARG001
) -> ORJSONResponse:
    """401 response for missing or invalid credentials."""
    from fastapi.responses import ORJSONResponse  # noqa: PLC0415

    return ORJSONResponse(
        status_code=401,
        content={
            "error": "authentication_required",
            "message": _get_auth_required_message(request),
            "request_id": getattr(request.state, "request_id", None),
        },
        headers={"WWW-Authenticate": "Bearer"},
    )


# ── Startup assertion ──────────────────────────────────────────────────────

def assert_all_routes_have_auth(app: FastAPI) -> None:
    """Fail startup if any non-public route lacks an authorization dependency.

    This is the runtime complement to the Semgrep static check.
    Called during the FastAPI lifespan startup event.

    In development, logs a warning for each unguarded route.
    In production, raises RuntimeError immediately.
    """
    from app.config import get_settings  # noqa: PLC0415

    settings = get_settings()
    unguarded: list[str] = []

    for route in app.routes:
        path: str | None = getattr(route, "path", None)
        if path is None:
            continue

        # Skip routes that are explicitly in the public allowlist.
        if any(path.startswith(p) for p in PUBLIC_ROUTE_PATHS):
            continue

        # Only check routes that have HTTP methods (API operations).
        methods: set[str] | None = getattr(route, "methods", None)
        if not methods:
            continue

        # Check if any dependency in the route's dependency tree is an
        # auth guard (tagged with _has_auth_dependency).
        dependant = getattr(route, "dependant", None)
        if dependant is None:
            unguarded.append(f"{path} {sorted(methods)}")
            continue

        if not _route_has_auth_dependency(dependant):
            unguarded.append(f"{path} {sorted(methods)}")

    if unguarded:
        msg = (
            "Boot-time authorization assertion FAILED.\n"
            "The following routes lack an authorization dependency:\n"
            + "\n".join(f"  - {r}" for r in unguarded)
            + "\nAdd `Depends(require(...))` or add the route to PUBLIC_ROUTE_PATHS."
        )
        if settings.is_production:
            raise RuntimeError(msg)
        logger.warning(msg)


def _route_has_auth_dependency(dependant: object) -> bool:
    """Recursively check if a route's dependency tree contains an auth guard."""
    for dep in getattr(dependant, "dependencies", []):
        call = getattr(dep, "call", None)
        if call is not None and getattr(call, "_has_auth_dependency", False):
            return True
        sub_dependant = getattr(dep, "dependant", None)
        if sub_dependant and _route_has_auth_dependency(sub_dependant):
            return True
    return False


# ── Internal helpers ───────────────────────────────────────────────────────

def _get_denial_message(request: Request) -> str:
    """Return a localized denial message. Falls back to English."""
    # i18n will be wired by Amin (Section 5). Until then, return English.
    locale = getattr(request.state, "locale", "en")
    messages = {
        "ar": "غير مصرح بالوصول",
        "he": "אין הרשאה",
        "en": "You are not authorized to perform this action",
    }
    return messages.get(locale, messages["en"])


def _get_auth_required_message(request: Request) -> str:
    locale = getattr(request.state, "locale", "en")
    messages = {
        "ar": "المصادقة مطلوبة",
        "he": "נדרשת אימות",
        "en": "Authentication required",
    }
    return messages.get(locale, messages["en"])


def _schedule_denial_audit(request: Request, exc: AuthorizationDenied) -> None:
    """Schedule an audit-log entry for the denial (R3 AC9).

    Written on a separate connection so it never joins the request transaction.
    The audit module (Salma, Section 9) will provide the full implementation.
    Until then, log to the application logger as a placeholder.
    """
    actor_id = getattr(getattr(request.state, "principal", None), "account_id", None)
    path = request.url.path
    method = request.method
    request_id = getattr(request.state, "request_id", "unknown")
    logger.info(
        "Authorization denied | actor=%s method=%s path=%s request_id=%s",
        actor_id,
        method,
        path,
        request_id,
    )

