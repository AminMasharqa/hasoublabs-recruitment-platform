"""Shared enums and domain types used across the security platform layer.

These are Python-level enums that mirror the native PostgreSQL ENUM types
defined in Section 2 (Khalid). The enum values here are the single source
of truth for application code; the DB migration generates matching PG types.
"""

from __future__ import annotations

from enum import StrEnum


class Role(StrEnum):
    """The three platform roles (R1 AC1). Admin may not be combined."""

    ADMIN = "ADMIN"
    CANDIDATE = "CANDIDATE"
    SENIOR = "SENIOR"


class AccountStatus(StrEnum):
    """All legal account statuses (R1 AC18)."""

    PENDING_VERIFICATION = "PendingVerification"
    PENDING_APPROVAL = "PendingApproval"
    APPROVED_PENDING_MEETING = "ApprovedPendingMeeting"
    APPROVED = "Approved"
    REJECTED = "Rejected"
    SUSPENDED = "Suspended"
    DEACTIVATED = "Deactivated"


# Statuses that grant full feature access (R1 AC21, R3 AC11).
APPROVED_ONLY: frozenset[AccountStatus] = frozenset({AccountStatus.APPROVED})

# Statuses that may view only the status-notice screen (R3 AC11).
STATUS_NOTICE_STATUSES: frozenset[AccountStatus] = frozenset(
    {
        AccountStatus.APPROVED,
        AccountStatus.SUSPENDED,
        AccountStatus.DEACTIVATED,
        AccountStatus.PENDING_VERIFICATION,
        AccountStatus.PENDING_APPROVAL,
        AccountStatus.APPROVED_PENDING_MEETING,
        AccountStatus.REJECTED,
    }
)

# Legal role-set combinations (R1 AC3, AC5).
# Admin may not be combined with any other role.
LEGAL_ROLE_SETS: frozenset[frozenset[Role]] = frozenset(
    {
        frozenset({Role.ADMIN}),
        frozenset({Role.CANDIDATE}),
        frozenset({Role.SENIOR}),
        frozenset({Role.CANDIDATE, Role.SENIOR}),
    }
)
