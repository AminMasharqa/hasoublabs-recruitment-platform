"""Principal — the resolved, authenticated identity attached to every request.

A Principal is what current_principal() returns after validating the JWT and
loading the Valkey session. It is the single source of truth about who is
making a request and what role context they are acting in.
"""

from __future__ import annotations

from dataclasses import dataclass
import uuid

from app.platform.security.types import AccountStatus, Role


@dataclass(frozen=True, slots=True)
class Principal:
    """Resolved authenticated identity for a single request.

    Attributes:
        account_id:     The authenticated account's UUID.
        roles:          All roles the account holds.
        active_context: The role the account is *currently acting as*.
                        Equals the sole role for single-role accounts; chosen
                        by the user for dual-role (Candidate+Senior) accounts.
        status:         The account's current AccountStatus.
        session_id:     The Valkey session key (used for logout / rotation).
    """

    account_id: uuid.UUID
    roles: frozenset[Role]
    active_context: Role
    status: AccountStatus
    session_id: str

    # ── Convenience properties ─────────────────────────────────────────────

    @property
    def is_admin(self) -> bool:
        return Role.ADMIN in self.roles

    @property
    def is_candidate(self) -> bool:
        return Role.CANDIDATE in self.roles

    @property
    def is_senior(self) -> bool:
        return Role.SENIOR in self.roles

    @property
    def is_approved(self) -> bool:
        return self.status == AccountStatus.APPROVED

    def acting_as(self, role: Role) -> bool:
        """Return True if this principal is currently acting in `role` context."""
        return self.active_context == role

    def can_switch_to(self, role: Role) -> bool:
        """Return True if this account holds `role` (context switch is valid)."""
        return role in self.roles


# A sentinel used in the audit layer when no authenticated principal is
# present (e.g. background jobs or unauthenticated public requests).
SYSTEM_PRINCIPAL = Principal(
    account_id=uuid.UUID("00000000-0000-0000-0000-000000000000"),
    roles=frozenset(),
    active_context=Role.ADMIN,   # sentinel — system actor has no real context
    status=AccountStatus.APPROVED,
    session_id="system",
)
