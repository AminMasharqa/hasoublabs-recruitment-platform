"""Audit module HTTP router — Admin-only endpoints (R8 AC4, Section 9.5).

Routes:
    GET  /admin/audit                  Search the audit log (filters + keyset pagination)
    GET  /admin/audit/chain/verify     On-demand chain verification for Admins
    POST /admin/audit/actors/{account_id}/anonymise  Anonymise a deleted account's identity

All routes require ``Role.ADMIN`` + ``AccountStatus.APPROVED`` — enforced via
``require()``.  The startup assertion will catch any route that lacks a guard.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Annotated, Any

from fastapi import APIRouter, Depends, Query, Request

from app.modules.audit.repository import get_max_audit_id
from app.modules.audit.schemas import (
    AuditLogEntryDTO,
    AuditPageMeta,
    AuditSearchResponse,
    ChainVerifyResponse,
)
from app.modules.audit.service import AuditChainVerifier, AuditService
from app.platform.db.session import get_session
from app.platform.security.guards import require
from app.platform.security.types import Role

if TYPE_CHECKING:
    from datetime import datetime
    import uuid

    from sqlalchemy.ext.asyncio import AsyncSession

    from app.platform.security.principal import Principal

# Only router.py may import FastAPI — enforced by Semgrep.
router = APIRouter(prefix="/admin/audit", tags=["audit"])

_ADMIN_GUARD = require(roles=frozenset({Role.ADMIN}))


# ── Helpers ───────────────────────────────────────────────────────────────────

def _entry_dto(entry: object) -> AuditLogEntryDTO:
    """Convert an ORM ``AuditLogEntry`` to its DTO.

    The actor relationship is loaded lazily only if the caller explicitly eager-
    loaded it.  The router uses the search results as returned by the repo
    (actor_identity not loaded), so we leave the actor field ``None`` and let
    callers enrich if needed.
    """
    from app.modules.audit.models import AuditLogEntry  # noqa: PLC0415

    assert isinstance(entry, AuditLogEntry)
    return AuditLogEntryDTO(
        id=entry.id,
        occurred_at=entry.occurred_at,
        # Enrichment deferred to avoid N+1 queries.
        # Use actor_account_id filter to scope by actor.
        actor=None,
        action=entry.action,
        entity_type=entry.entity_type,
        entity_id=entry.entity_id,
        before=entry.before,
        after=entry.after,
        reason=entry.reason,
        request_id=entry.request_id,
        outcome=entry.outcome,
        error_type=entry.error_type,
    )


# ── GET /admin/audit ──────────────────────────────────────────────────────────

@router.get("", response_model=AuditSearchResponse)
async def search_audit(
    request: Request,
    principal: Principal = Depends(_ADMIN_GUARD),
    actor_account_id: Annotated[uuid.UUID | None, Query()] = None,
    action: Annotated[str | None, Query(max_length=200)] = None,
    entity_type: Annotated[str | None, Query(max_length=100)] = None,
    entity_id: Annotated[str | None, Query(max_length=200)] = None,
    from_dt: Annotated[datetime | None, Query()] = None,
    to_dt: Annotated[datetime | None, Query()] = None,
    after_id: Annotated[int | None, Query()] = None,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    session: AsyncSession = Depends(get_session),
) -> AuditSearchResponse:
    """Search the audit log.

    All filters are optional and conjunctive.  Pagination is keyset: pass the
    ``meta.next_after_id`` from the previous page as ``after_id`` on the next
    request.

    Requirements: R8 AC4.
    """
    entries, has_more = await AuditService.search(
        session,
        actor_account_id=actor_account_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        from_dt=from_dt,
        to_dt=to_dt,
        after_id=after_id,
        page_size=page_size,
    )

    dtos = [_entry_dto(e) for e in entries]
    next_after_id = entries[-1].id if entries and has_more else None

    return AuditSearchResponse(
        data=dtos,
        meta=AuditPageMeta(
            page_size=page_size,
            has_more=has_more,
            next_after_id=next_after_id,
        ),
    )


# ── GET /admin/audit/chain/verify ─────────────────────────────────────────────

@router.get("/chain/verify", response_model=ChainVerifyResponse)
async def verify_chain(
    request: Request,
    principal: Principal = Depends(_ADMIN_GUARD),
    start_id: Annotated[int, Query(ge=1)] = 1,
    session: AsyncSession = Depends(get_session),
) -> ChainVerifyResponse:
    """On-demand full chain verification (walks from ``start_id`` in windows).

    The ARQ job calls the same verifier on a schedule; this endpoint lets Admins
    trigger an ad-hoc check.

    Requirements: R8 AC8.
    """
    verifier = AuditChainVerifier()
    max_id = await get_max_audit_id(session)
    ok, first_bad_id = await verifier.verify_since(session, start_id=start_id)

    return ChainVerifyResponse(
        ok=ok,
        first_bad_id=first_bad_id,
        checked_from_id=start_id,
        max_id=max_id,
    )


# ── POST /admin/audit/actors/{account_id}/anonymise ───────────────────────────

@router.post("/actors/{account_id}/anonymise", status_code=200)
async def anonymise_actor_endpoint(
    account_id: uuid.UUID,
    request: Request,
    principal: Principal = Depends(_ADMIN_GUARD),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Anonymise audit actor identity rows for a deleted account.

    Nulls out ``display_name`` and ``email``; sets ``anonymised_at``.
    The hash-chained ``audit_log`` rows are left byte-identical (R8 AC7).

    Requirements: R8 AC7.
    """
    count = await AuditService.anonymise_deleted_account(session, account_id)
    await session.commit()
    return {"data": {"anonymised_rows": count}}


__all__ = ["router"]
