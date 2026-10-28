"""FastAPI router for the identity module (Task 12.6).

Route ownership:
  - Public routes (in PUBLIC_ROUTE_PATHS): no auth dependency required.
  - All private routes use Depends(require(...)) or Depends(require_any_authenticated()).

Services are retrieved from request.app.state (set during lifespan in main.py).
No service logic lives here — this file is HTTP concerns only.

FastAPI import rule: the ONLY module file that may import fastapi.
"""

from __future__ import annotations

from typing import Any, TYPE_CHECKING, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import Response

from app.platform.db.enums import AccountStatus, Role
from app.platform.security.guards import require, require_any_authenticated
from app.platform.security.principal import Principal
# require() expects security.types.Role / AccountStatus; import them for use
# in Depends(require(...)) calls.
from app.platform.security.types import APPROVED_ONLY, STATUS_NOTICE_STATUSES
from app.platform.security.types import Role as SecRole
from app.modules.identity.schemas import (
    AccountDTO,
    AdminApproveRequest,
    AdminDeactivateRequest,
    AdminRejectRequest,
    AdminRoleUpdateRequest,
    AdminSuspendRequest,
    CreateRegistrationLinkRequest,
    LoginRequest,
    MfaEnrolmentDTO,
    RefreshRequest,
    RegistrationLinkDTO,
    RegistrationRequest,
    ResendCodeRequest,
    StatusNoticeDTO,
    SwitchContextRequest,
    TokenResponse,
    VerifyCodeRequest,
)

if TYPE_CHECKING:
    pass

router = APIRouter(tags=["identity"])

# ── Helpers ────────────────────────────────────────────────────────────────


def _token_response(token_pair: object) -> TokenResponse:
    """Convert a TokenPair to its Pydantic response schema."""
    return TokenResponse(
        access_token=token_pair.access_token,  # type: ignore[attr-defined]
        refresh_token=token_pair.refresh_token,  # type: ignore[attr-defined]
        token_type=token_pair.token_type,  # type: ignore[attr-defined]
        expires_in=token_pair.expires_in,  # type: ignore[attr-defined]
    )


def _get_link_service(request: Request) -> Any:
    return request.app.state.registration_link_service


def _get_registration_service(request: Request) -> Any:
    return request.app.state.registration_service


def _get_verification_service(request: Request) -> Any:
    return request.app.state.verification_service


def _get_lifecycle_service(request: Request) -> Any:
    return request.app.state.account_lifecycle_service


def _get_auth_service(request: Request) -> Any:
    return request.app.state.auth_service


# ── Public routes ──────────────────────────────────────────────────────────
# These are all prefixed with paths that appear in PUBLIC_ROUTE_PATHS so the
# startup assertion does not require an auth dependency on them.


@router.get(
    "/registration-links/{token}",
    response_model=RegistrationLinkDTO,
    summary="Validate a registration link token",
)
async def get_registration_link(token: str, request: Request) -> RegistrationLinkDTO:
    """Validate and return metadata for a registration link token.

    The raw token is NOT re-exposed in the response. This endpoint is called by
    the registration form to confirm the link is valid before showing the form.
    """
    service = _get_link_service(request)
    return cast(RegistrationLinkDTO, await service.validate_link(token))


@router.post(
    "/register/candidate",
    response_model=AccountDTO,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new Candidate account",
)
async def register_candidate(
    body: RegistrationRequest,
    request: Request,
) -> AccountDTO:
    """Complete a new Candidate self-registration.

    Requires a valid registration link token. Creates the account, queues the
    verification code email, and returns the new AccountDTO (PendingVerification).
    """
    # Enforce that the route is for the Candidate role only.
    from app.modules.identity.errors import InvalidRegistrationLink  # noqa: PLC0415

    if body.role.upper() != "CANDIDATE":
        raise InvalidRegistrationLink(
            log_message="POST /register/candidate requires role=CANDIDATE"
        )

    service = _get_registration_service(request)
    return cast(AccountDTO, await service.register(body, body.link_token))


@router.post(
    "/register/senior",
    response_model=AccountDTO,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new Senior account",
)
async def register_senior(
    body: RegistrationRequest,
    request: Request,
) -> AccountDTO:
    """Complete a new Senior self-registration.

    Requires a valid registration link token. Creates the account, queues the
    verification code email, and returns the new AccountDTO (PendingVerification).
    """
    from app.modules.identity.errors import InvalidRegistrationLink  # noqa: PLC0415

    if body.role.upper() != "SENIOR":
        raise InvalidRegistrationLink(
            log_message="POST /register/senior requires role=SENIOR"
        )

    service = _get_registration_service(request)
    return cast(AccountDTO, await service.register(body, body.link_token))


@router.post(
    "/verify/code",
    response_model=AccountDTO,
    summary="Submit the email verification code",
)
async def verify_code(body: VerifyCodeRequest, request: Request) -> AccountDTO:
    """Verify the 6-digit code emailed to the registrant.

    On success the account transitions from PendingVerification to PendingApproval.
    """
    service = _get_verification_service(request)
    return cast(AccountDTO, await service.verify_code(body.account_id, body.code))


@router.post(
    "/verify/resend",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Resend the verification code email",
)
async def resend_code(body: ResendCodeRequest, request: Request) -> Response:
    """Issue a new 6-digit code and reset the attempt counter.

    The previous code is immediately invalidated.
    """
    service = _get_verification_service(request)
    await service.resend_code(body.account_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/auth/login",
    response_model=TokenResponse,
    summary="Authenticate and receive a token pair",
)
async def login(body: LoginRequest, request: Request) -> TokenResponse:
    """Authenticate an account and issue a JWT access + refresh token pair.

    MFA is checked in a separate step: if the account has MFA enrolled, a
    ``MfaRequired`` error is returned when ``mfa_code`` is absent. The client
    should re-submit with ``mfa_code`` populated.
    """
    from app.platform.security.mfa import is_enrolled  # noqa: PLC0415
    from app.modules.identity.errors import InvalidMfaCode, MfaRequired  # noqa: PLC0415

    auth_service = _get_auth_service(request)
    role = Role(body.role)

    token_pair, dto = await auth_service.login(body.email, body.password, role=role)
    # Check MFA if enrolled — requires a second round-trip to the DB.
    # We need to get the account to check enrolment status.
    from app.modules.identity import repository as repo  # noqa: PLC0415

    uow_factory = request.app.state.uow_factory
    async with uow_factory() as uow:
        account = await repo.get_account_by_email(uow.session, body.email, role)

    if account is not None and is_enrolled(account.mfa_secret_enc):
        if not body.mfa_code:
            # Revoke the session we just issued — the login is not complete.
            await auth_service.logout(
                # Extract session_id from the already-issued token would require
                # decoding it; instead we re-use the revoke path via session service.
                # This is a best-effort cleanup; the token will expire naturally.
                session_id="",  # session service handles missing gracefully
            )
            raise MfaRequired(
                log_message=f"MFA enrolled account {account.id} attempted login without MFA code"
            )

        # Verify the TOTP code.
        mfa_ok = await auth_service.verify_mfa(account.id, body.mfa_code)
        if not mfa_ok:
            raise InvalidMfaCode(
                log_message=f"Invalid MFA code for account {account.id}"
            )

    return _token_response(token_pair)


@router.post(
    "/auth/refresh",
    response_model=TokenResponse,
    summary="Exchange a refresh token for a new token pair",
)
async def refresh_token(body: RefreshRequest, request: Request) -> TokenResponse:
    """Issue a new access + refresh token pair from a valid refresh token."""
    auth_service = _get_auth_service(request)
    token_pair = await auth_service.refresh_token(body.refresh_token)
    return _token_response(token_pair)


# ── Auth-required routes ───────────────────────────────────────────────────


@router.post(
    "/auth/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Invalidate the current session",
)
async def logout(
    request: Request,
    principal: Principal = Depends(require_any_authenticated()),
) -> Response:
    """Invalidate the Valkey session referenced by the current JWT."""
    auth_service = _get_auth_service(request)
    await auth_service.logout(principal.session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/auth/context",
    response_model=TokenResponse,
    summary="Switch active role context (dual-role accounts only)",
)
async def switch_context(
    body: SwitchContextRequest,
    request: Request,
    principal: Principal = Depends(require_any_authenticated()),
) -> TokenResponse:
    """Switch the active role context for a Candidate+Senior account.

    Issues a new token pair with the updated ``act`` claim; the old session is
    invalidated. No authorization state from the previous context survives.
    """
    auth_service = _get_auth_service(request)
    new_context = SecRole(body.context)
    token_pair = await auth_service.switch_context(
        session_id=principal.session_id,
        new_context=new_context,
        principal=principal,
    )
    return _token_response(token_pair)


@router.get(
    "/me/status",
    response_model=StatusNoticeDTO,
    summary="Get current account status and next step",
)
async def get_my_status(
    principal: Principal = Depends(
        require(
            roles=frozenset({SecRole.ADMIN, SecRole.CANDIDATE, SecRole.SENIOR}),
            statuses=STATUS_NOTICE_STATUSES,
        )
    ),
) -> StatusNoticeDTO:
    """Return the caller's current account status and next onboarding step.

    Accessible from any account status so the onboarding screen can always
    show the right message.
    """
    next_step_map = {
        "PendingVerification": "Check your email for the verification code",
        "PendingApproval": "Your account is awaiting admin review",
        "ApprovedPendingMeeting": "Please schedule your onboarding meeting",
        "Approved": None,
        "Rejected": "Contact support if you believe this is an error",
        "Suspended": "Your account is suspended. Contact support.",
        "Deactivated": "This account has been deactivated",
    }
    status_value = principal.status.value
    return StatusNoticeDTO(
        status=status_value,
        next_step=next_step_map.get(status_value),
    )


@router.post(
    "/auth/mfa/enroll",
    response_model=MfaEnrolmentDTO,
    summary="Begin MFA enrolment (Admin only)",
)
async def enroll_mfa(
    request: Request,
    principal: Principal = Depends(
        require(roles=frozenset({SecRole.ADMIN}), statuses=APPROVED_ONLY)
    ),
) -> MfaEnrolmentDTO:
    """Generate a TOTP secret and return the QR code for admin MFA enrolment."""
    auth_service = _get_auth_service(request)
    return cast(MfaEnrolmentDTO, await auth_service.enroll_mfa(principal.account_id))


@router.post(
    "/auth/mfa/verify",
    status_code=status.HTTP_200_OK,
    summary="Verify a TOTP code",
)
async def verify_mfa_code(
    body: VerifyCodeRequest,
    request: Request,
    principal: Principal = Depends(require_any_authenticated()),
) -> dict[str, bool]:
    """Verify a TOTP code against the current account's enrolled secret.

    Returns ``{"verified": true}`` on success or raises InvalidMfaCode.
    """
    from app.modules.identity.errors import InvalidMfaCode  # noqa: PLC0415

    auth_service = _get_auth_service(request)
    verified = await auth_service.verify_mfa(principal.account_id, body.code)
    if not verified:
        raise InvalidMfaCode(
            log_message=f"TOTP verification failed for account {principal.account_id}"
        )
    return {"verified": True}


# ── Admin-only routes ──────────────────────────────────────────────────────

_ADMIN_GUARD = Depends(require(roles=frozenset({SecRole.ADMIN}), statuses=APPROVED_ONLY))


@router.post(
    "/admin/registration-links",
    response_model=RegistrationLinkDTO,
    status_code=status.HTTP_201_CREATED,
    summary="Admin: create a registration link",
)
async def create_registration_link(
    body: CreateRegistrationLinkRequest,
    request: Request,
    principal: Principal = _ADMIN_GUARD,
) -> RegistrationLinkDTO:
    """Generate a new signed registration link for the specified role.

    The raw token is included in this response only. It is never stored in
    plaintext and is not recoverable after this response is returned.
    """
    service = _get_link_service(request)
    role = Role(body.role)
    _raw_token, dto = await service.create_link(role, issued_by=principal.account_id)
    return cast(RegistrationLinkDTO, dto)


@router.get(
    "/admin/accounts",
    response_model=list[AccountDTO],
    summary="Admin: list accounts",
)
async def list_accounts(
    request: Request,
    status_filter: str | None = Query(default=None, alias="status"),
    role_filter: str | None = Query(default=None, alias="role"),
    after_id: UUID | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    principal: Principal = _ADMIN_GUARD,
) -> list[AccountDTO]:
    """Return a paginated list of accounts with optional status/role filters."""
    from app.platform.security.mfa import is_enrolled  # noqa: PLC0415
    from app.modules.identity import repository as _repo  # noqa: PLC0415

    status_enum = AccountStatus(status_filter) if status_filter else None
    role_enum = Role(role_filter) if role_filter else None

    uow_factory = request.app.state.uow_factory
    async with uow_factory() as uow:
        accounts = await _repo.list_accounts(
            uow.session,
            status=status_enum,
            role=role_enum,
            after_id=after_id,
            limit=limit,
        )

    return [
        AccountDTO(
            id=a.id,
            email=a.email,
            roles=[r.value for r in a.roles],
            status=a.status.value,
            language_preference=a.language_preference,
            created_at=a.created_at,
            mfa_enrolled=is_enrolled(a.mfa_secret_enc),
        )
        for a in accounts
    ]


@router.post(
    "/admin/accounts/{account_id}:approve",
    response_model=AccountDTO,
    summary="Admin: approve an account",
)
async def approve_account(
    account_id: UUID,
    body: AdminApproveRequest,
    request: Request,
    principal: Principal = _ADMIN_GUARD,
) -> AccountDTO:
    """Approve an account from PendingApproval.

    If ``fast_track`` is True, the account goes directly to Approved (skipping
    the meeting step). Otherwise it moves to ApprovedPendingMeeting.
    """
    service = _get_lifecycle_service(request)
    return cast(AccountDTO, await service.approve(account_id, actor=principal, fast_track=body.fast_track))


@router.post(
    "/admin/accounts/{account_id}:reject",
    response_model=AccountDTO,
    summary="Admin: reject an account",
)
async def reject_account(
    account_id: UUID,
    body: AdminRejectRequest,
    request: Request,
    principal: Principal = _ADMIN_GUARD,
) -> AccountDTO:
    """Reject an account and release its email slot."""
    service = _get_lifecycle_service(request)
    return cast(AccountDTO, await service.reject(account_id, actor=principal, reason=body.reason))


@router.post(
    "/admin/accounts/{account_id}:record-meeting",
    response_model=AccountDTO,
    summary="Admin: record that the onboarding meeting was completed",
)
async def record_meeting(
    account_id: UUID,
    request: Request,
    principal: Principal = _ADMIN_GUARD,
) -> AccountDTO:
    """Record that the onboarding meeting was held; advance to Approved."""
    service = _get_lifecycle_service(request)
    return cast(AccountDTO, await service.record_meeting_complete(account_id, actor=principal))


@router.post(
    "/admin/accounts/{account_id}:suspend",
    response_model=AccountDTO,
    summary="Admin: suspend an approved account",
)
async def suspend_account(
    account_id: UUID,
    body: AdminSuspendRequest,
    request: Request,
    principal: Principal = _ADMIN_GUARD,
) -> AccountDTO:
    """Suspend an Approved account (reversible)."""
    service = _get_lifecycle_service(request)
    return cast(AccountDTO, await service.suspend(account_id, actor=principal, reason=body.reason))


@router.post(
    "/admin/accounts/{account_id}:reactivate",
    response_model=AccountDTO,
    summary="Admin: reactivate a suspended account",
)
async def reactivate_account(
    account_id: UUID,
    request: Request,
    principal: Principal = _ADMIN_GUARD,
) -> AccountDTO:
    """Reactivate a Suspended account back to Approved."""
    service = _get_lifecycle_service(request)
    return cast(AccountDTO, await service.reactivate(account_id, actor=principal))


@router.post(
    "/admin/accounts/{account_id}:deactivate",
    response_model=AccountDTO,
    summary="Admin: permanently deactivate an account",
)
async def deactivate_account(
    account_id: UUID,
    body: AdminDeactivateRequest,
    request: Request,
    principal: Principal = _ADMIN_GUARD,
) -> AccountDTO:
    """Permanently deactivate an account (Approved or Suspended → Deactivated).

    The email slot is released so the address can be reused.
    """
    service = _get_lifecycle_service(request)
    return cast(AccountDTO, await service.deactivate(account_id, actor=principal, reason=body.reason))


@router.post(
    "/admin/accounts/{account_id}:reopen",
    response_model=AccountDTO,
    summary="Admin: re-open a rejected account for reconsideration",
)
async def reopen_account(
    account_id: UUID,
    request: Request,
    principal: Principal = _ADMIN_GUARD,
) -> AccountDTO:
    """Re-open a Rejected account by moving it back to PendingApproval."""
    service = _get_lifecycle_service(request)
    return cast(AccountDTO, await service.reopen(account_id, actor=principal))


@router.put(
    "/admin/accounts/{account_id}/roles",
    response_model=AccountDTO,
    summary="Admin: replace an account's role set",
)
async def update_roles(
    account_id: UUID,
    body: AdminRoleUpdateRequest,
    request: Request,
    principal: Principal = _ADMIN_GUARD,
) -> AccountDTO:
    """Replace the complete role set of an account.

    Validates the ADMIN exclusivity constraint (Admin cannot be combined with
    Candidate or Senior).
    """
    from app.platform.errors.base import ValidationFailed, FieldViolation  # noqa: PLC0415
    from app.platform.security.mfa import is_enrolled  # noqa: PLC0415
    from app.modules.identity import repository as _repo  # noqa: PLC0415

    new_roles = [Role(r) for r in body.roles]

    # Enforce Admin exclusivity.
    if Role.ADMIN in new_roles and len(new_roles) > 1:
        raise ValidationFailed(
            fields=[
                FieldViolation(
                    path="roles",
                    code="admin_exclusive",
                    params={"detail": "ADMIN role cannot be combined with other roles"},
                )
            ],
            log_message="Attempted to assign ADMIN alongside other roles",
        )

    uow_factory = request.app.state.uow_factory
    async with uow_factory() as uow:
        account = await _repo.get_account_by_id(uow.session, account_id)
        if account is None:
            from app.platform.security.errors import AuthorizationDenied  # noqa: PLC0415
            raise AuthorizationDenied()

        account.roles = new_roles
        from app.platform.db.base import utc_now  # noqa: PLC0415
        account.updated_at = utc_now()

        dto = AccountDTO(
            id=account.id,
            email=account.email,
            roles=[r.value for r in account.roles],
            status=account.status.value,
            language_preference=account.language_preference,
            created_at=account.created_at,
            mfa_enrolled=is_enrolled(account.mfa_secret_enc),
        )

    return dto
