"""Security-layer error types.

Only two error types are raised by the security layer and exposed as HTTP
responses:
  - AuthenticationRequired (401) – no valid session / JWT.
  - AuthorizationDenied (403)    – session exists but permission denied.

AuthorizationDenied is intentionally the ONLY error for BOTH
"not authorized" AND "resource does not exist" (R3 AC6). This prevents
existence side-channels: a caller who doesn't own a resource and a caller
who references a non-existent ID both get the same 403 byte-for-byte response
after the same minimum latency floor.
"""

from __future__ import annotations


class SecurityError(Exception):
    """Base for all security-layer errors."""


class AuthenticationRequired(SecurityError):  # noqa: N818
    """No valid authentication credential was present.

    HTTP 401. Raised when:
    - The Authorization header is absent or malformed.
    - The JWT signature is invalid.
    - The JWT is expired.
    - The session referenced by session_id is not found in Valkey.
    """


class AuthorizationDenied(SecurityError):  # noqa: N818
    """The principal lacks permission for the requested resource/action.

    HTTP 403. Raised for BOTH "not authorized" and "resource does not exist"
    on authorization-relevant resources (R3 AC6). The handler emits a
    byte-identical body in both cases. Do not raise a 404 variant separately.
    """
