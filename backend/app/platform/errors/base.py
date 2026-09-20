"""The platform error taxonomy behind the one error envelope.

Every class here maps to exactly one row of the design's "Error Classes and
Mapping" table: a stable machine key, an HTTP status, a localizable message key,
and whether a client may retry. Handlers never inspect anything else, so adding
an error class is a one-line change with no handler edit.

``AuthorizationDenied`` is deliberately **not** defined here. It is the single
denial type owned by Section 4 (RBAC, Karim) because it needs the fixed-latency
response path; it subclasses :class:`PlatformError` so the envelope stays
identical, and FastAPI's most-specific-handler-wins lookup routes it to the
constant-time handler rather than to the generic one.

The class names come straight from the design's error table (``ValidationFailed``,
``PreconditionUnmet``, …) rather than carrying an ``Error`` suffix, so the code
and the specification read the same; ``N818`` is waived for this module.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, ClassVar

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence


@dataclass(frozen=True, slots=True)
class FieldViolation:
    """One field-level violation.

    Args:
        path: JSON-pointer-style path into the request body, e.g.
            ``education[2].graduation_year``, so a form library can attach the
            message to the right input.
        code: Stable machine sub-code, e.g. ``end_before_start``. Localized via
            the ``error.field.<code>`` message key when one exists.
        params: Interpolation parameters for the localized message.
    """

    path: str
    code: str
    params: Mapping[str, Any] = field(default_factory=dict)

    @property
    def message_key(self) -> str:
        return f"error.field.{self.code}"


class PlatformError(Exception):
    """Base class for every error rendered through the one error envelope."""

    error_key: ClassVar[str] = "internal_server_error"
    status_code: ClassVar[int] = 500
    message_key: ClassVar[str] = "error.internal_server_error"
    retryable: ClassVar[bool] = False

    def __init__(
        self,
        *,
        fields: Sequence[FieldViolation] | None = None,
        params: Mapping[str, Any] | None = None,
        details: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
        log_message: str | None = None,
    ) -> None:
        """Create the error.

        Args:
            fields: Field-level violations. Always the *complete* set — the
                requirements say "each"/"every" violated field, never the first.
            params: Interpolation parameters for the top-level message.
            details: Extra machine-readable context safe to disclose to the
                caller. Never put PII or resource-existence hints here.
            headers: Response headers the error implies, e.g. ``Retry-After``.
            log_message: Operator-facing detail. Logged, never serialized.
        """
        self.fields: tuple[FieldViolation, ...] = tuple(fields or ())
        self.params: dict[str, Any] = dict(params or {})
        self.details: dict[str, Any] = dict(details or {})
        self.headers: dict[str, str] = dict(headers or {})
        self.log_message = log_message
        super().__init__(log_message or self.error_key)


class ValidationFailed(PlatformError):  # noqa: N818 - name fixed by the design
    """422 — one or more submitted fields are invalid. Lists every violation."""

    error_key = "validation_failed"
    status_code = 422
    message_key = "error.validation_failed"


class AuthenticationRequired(PlatformError):  # noqa: N818 - name fixed by the design
    """401 — no valid credentials. Never hints whether the account exists."""

    error_key = "authentication_required"
    status_code = 401
    message_key = "error.authentication_required"


class AccountNotApproved(PlatformError):  # noqa: N818 - name fixed by the design
    """403 — authenticated but not yet through onboarding.

    Carries the current status and next step because the onboarding screens need
    them (R1 AC12, AC14, AC21). This is the *only* 403 that discloses state, and
    it discloses the caller's own state, never another resource's existence.
    """

    error_key = "account_not_approved"
    status_code = 403
    message_key = "error.account_not_approved"

    def __init__(
        self,
        *,
        status: str,
        next_step: str | None = None,
        log_message: str | None = None,
    ) -> None:
        details: dict[str, Any] = {"status": status}
        if next_step is not None:
            details["next_step"] = next_step
        super().__init__(details=details, log_message=log_message)


class IllegalTransition(PlatformError):  # noqa: N818 - name fixed by the design
    """409 — the command is not in the state machine's transition table."""

    error_key = "illegal_transition"
    status_code = 409
    message_key = "error.illegal_transition"

    def __init__(
        self,
        *,
        entity: str,
        from_state: str,
        to_state: str,
        log_message: str | None = None,
    ) -> None:
        super().__init__(
            details={"entity": entity, "from": from_state, "to": to_state},
            log_message=log_message,
        )


class ConflictingState(PlatformError):  # noqa: N818 - name fixed by the design
    """409 — duplicate email per role, duplicate variant name, duplicate application."""

    error_key = "conflicting_state"
    status_code = 409
    message_key = "error.conflicting_state"


class PreconditionUnmet(PlatformError):  # noqa: N818 - name fixed by the design
    """422 — the action's preconditions are not met; always names the unmet set."""

    error_key = "precondition_unmet"
    status_code = 422
    message_key = "error.precondition_unmet"

    def __init__(
        self,
        *,
        unmet: Sequence[str],
        fields: Sequence[FieldViolation] | None = None,
        log_message: str | None = None,
    ) -> None:
        super().__init__(
            fields=fields,
            details={"unmet": list(unmet)},
            log_message=log_message,
        )


class RateLimited(PlatformError):  # noqa: N818 - name fixed by the design
    """429 — a rate limit was exceeded; always sets ``Retry-After``."""

    error_key = "rate_limited"
    status_code = 429
    message_key = "error.rate_limited"
    retryable = True

    def __init__(
        self,
        *,
        retry_after_seconds: int,
        scope: str | None = None,
        log_message: str | None = None,
    ) -> None:
        retry_after = max(1, int(retry_after_seconds))
        details: dict[str, Any] = {"retry_after_seconds": retry_after}
        if scope is not None:
            details["scope"] = scope
        super().__init__(
            headers={"Retry-After": str(retry_after)},
            details=details,
            log_message=log_message,
        )


class CodeEntryLocked(PlatformError):  # noqa: N818 - name fixed by the design
    """423 — five consecutive incorrect codes; only a new code unlocks it (R2 AC8)."""

    error_key = "code_entry_locked"
    status_code = 423
    message_key = "error.code_entry_locked"


class IntegrityViolation(PlatformError):  # noqa: N818 - name fixed by the design
    """500 — checksum or audit-chain mismatch. Always raises an Admin alert."""

    error_key = "integrity_violation"
    status_code = 500
    message_key = "error.integrity_violation"


class UpstreamUnavailable(PlatformError):  # noqa: N818 - name fixed by the design
    """503 — ClamAV, MinIO, OpenBao, SMTP or DNS is unreachable."""

    error_key = "upstream_unavailable"
    status_code = 503
    message_key = "error.upstream_unavailable"
    retryable = True

    def __init__(
        self,
        *,
        service: str,
        retry_after_seconds: int | None = None,
        log_message: str | None = None,
    ) -> None:
        headers: dict[str, str] = {}
        if retry_after_seconds is not None:
            headers["Retry-After"] = str(max(1, int(retry_after_seconds)))
        super().__init__(
            headers=headers,
            details={"service": service},
            log_message=log_message,
        )
