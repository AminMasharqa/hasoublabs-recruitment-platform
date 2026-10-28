"""Platform security package — public re-exports.

Domain modules import from here, not from sub-modules directly.
"""

from app.platform.security.errors import AuthenticationRequired, AuthorizationDenied
from app.platform.security.guards import (
    DENY_FLOOR_MS,
    PUBLIC_ROUTE_PATHS,
    assert_all_routes_have_auth,
    current_principal,
    require,
    require_any_authenticated,
)
from app.platform.security.mfa import generate_secret, is_enrolled, verify_code
from app.platform.security.password import (
    PasswordPolicyViolation,
    hash_password,
    needs_rehash,
    validate_password_policy,
    verify_password,
)
from app.platform.security.principal import SYSTEM_PRINCIPAL, Principal
from app.platform.security.tokens import SessionService, TokenPair
from app.platform.security.types import (
    APPROVED_ONLY,
    LEGAL_ROLE_SETS,
    STATUS_NOTICE_STATUSES,
    AccountStatus,
    Role,
)

__all__ = [
    # Types
    "Role",
    "AccountStatus",
    "APPROVED_ONLY",
    "STATUS_NOTICE_STATUSES",
    "LEGAL_ROLE_SETS",
    # Principal
    "Principal",
    "SYSTEM_PRINCIPAL",
    # Guards
    "require",
    "require_any_authenticated",
    "current_principal",
    "PUBLIC_ROUTE_PATHS",
    "DENY_FLOOR_MS",
    "assert_all_routes_have_auth",
    # Errors
    "AuthorizationDenied",
    "AuthenticationRequired",
    # Password
    "hash_password",
    "verify_password",
    "needs_rehash",
    "validate_password_policy",
    "PasswordPolicyViolation",
    # Sessions / JWT
    "SessionService",
    "TokenPair",
    # MFA
    "generate_secret",
    "verify_code",
    "is_enrolled",
]
