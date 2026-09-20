"""Pydantic v2 request/response schemas for the audit module (R8 AC4).

These are the public DTOs used by the router and the ``AuditApi`` interface.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
import uuid

from pydantic import BaseModel, ConfigDict, Field

# ── Response: one audit log entry ─────────────────────────────────────────────

class AuditActorDTO(BaseModel):
    """Condensed actor identity snapshot in an audit entry response."""

    model_config = ConfigDict(frozen=True)

    id: uuid.UUID
    account_id: uuid.UUID | None
    role: str
    display_name: str
    is_system: bool
    anonymised: bool


class AuditLogEntryDTO(BaseModel):
    """Full representation of one audit log entry for Admin consumption."""

    model_config = ConfigDict(frozen=True)

    id: int
    occurred_at: datetime
    actor: AuditActorDTO | None = None
    action: str
    entity_type: str
    entity_id: str
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None
    reason: str | None = None
    request_id: str | None = None
    outcome: str
    error_type: str | None = None


# ── Request: search query params ──────────────────────────────────────────────

class AuditSearchParams(BaseModel):
    """Query parameters for the Admin audit search endpoint (R8 AC4)."""

    model_config = ConfigDict(frozen=True)

    actor_account_id: uuid.UUID | None = None
    action: str | None = None
    entity_type: str | None = None
    entity_id: str | None = None
    from_dt: datetime | None = None
    to_dt: datetime | None = None

    # Keyset pagination cursor (the ``id`` of the last entry on the previous page).
    after_id: int | None = None
    page_size: int = Field(default=20, ge=1, le=100)


# ── Response envelope ─────────────────────────────────────────────────────────

class AuditSearchResponse(BaseModel):
    """Paginated list of audit log entries."""

    model_config = ConfigDict(frozen=True)

    data: list[AuditLogEntryDTO]
    meta: AuditPageMeta


class AuditPageMeta(BaseModel):
    model_config = ConfigDict(frozen=True)

    page_size: int
    has_more: bool
    next_after_id: int | None = None


# ── Response: chain verification ─────────────────────────────────────────────

class ChainVerifyResponse(BaseModel):
    """Result of a manual chain-verification request."""

    model_config = ConfigDict(frozen=True)

    ok: bool
    first_bad_id: int | None = None
    checked_from_id: int
    max_id: int | None = None


__all__ = [
    "AuditActorDTO",
    "AuditLogEntryDTO",
    "AuditPageMeta",
    "AuditSearchParams",
    "AuditSearchResponse",
    "ChainVerifyResponse",
]
