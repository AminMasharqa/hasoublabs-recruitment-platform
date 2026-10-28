"""Public interface for the audit module — used by other modules (Section 9).

Imports allowed: ``audit/api.py`` and ``audit/schemas.py`` only.
No module may import ``audit/service.py``, ``audit/repository.py``, or
``audit/models.py`` directly.

This interface exposes:
* ``AuditApi`` — Protocol that any adapter must satisfy.
* ``DefaultAuditApi`` — Production implementation wrapping the service layer.
* ``record_denial`` — Thin helper for the authorization-denial handler in
  ``platform/security/guards.py`` (fire-and-forget on a separate connection).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    from datetime import datetime
    import uuid

    from sqlalchemy.ext.asyncio import AsyncSession

    from app.modules.audit.models import AuditLogEntry


class AuditApi(Protocol):
    """Protocol for the audit module's public interface."""

    async def record(
        self,
        session: AsyncSession,
        *,
        actor_identity_id: uuid.UUID,
        action: str,
        entity_type: str,
        entity_id: str,
        before: dict[str, Any] | None = None,
        after: dict[str, Any] | None = None,
        reason: str | None = None,
        request_id: str | None = None,
        outcome: str = "success",
        error_type: str | None = None,
        occurred_at: datetime | None = None,
    ) -> AuditLogEntry: ...

    async def get_or_create_actor(
        self,
        session: AsyncSession,
        *,
        account_id: uuid.UUID | None,
        role: str,
        display_name: str,
        email: str | None = None,
        is_system: bool = False,
    ) -> uuid.UUID: ...


class DefaultAuditApi:
    """Production implementation of ``AuditApi``."""

    async def record(
        self,
        session: AsyncSession,
        *,
        actor_identity_id: uuid.UUID,
        action: str,
        entity_type: str,
        entity_id: str,
        before: dict[str, Any] | None = None,
        after: dict[str, Any] | None = None,
        reason: str | None = None,
        request_id: str | None = None,
        outcome: str = "success",
        error_type: str | None = None,
        occurred_at: datetime | None = None,
    ) -> AuditLogEntry:
        from app.modules.audit.service import AuditService  # noqa: PLC0415

        return await AuditService.record(
            session,
            actor_identity_id=actor_identity_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            before=before,
            after=after,
            reason=reason,
            request_id=request_id,
            outcome=outcome,
            error_type=error_type,
            occurred_at=occurred_at,
        )

    async def get_or_create_actor(
        self,
        session: AsyncSession,
        *,
        account_id: uuid.UUID | None,
        role: str,
        display_name: str,
        email: str | None = None,
        is_system: bool = False,
    ) -> uuid.UUID:
        from app.modules.audit.service import AuditService  # noqa: PLC0415

        return await AuditService.get_or_create_actor(
            session,
            account_id=account_id,
            role=role,
            display_name=display_name,
            email=email,
            is_system=is_system,
        )


#: Module-level singleton.
audit_api: DefaultAuditApi = DefaultAuditApi()


__all__ = [
    "AuditApi",
    "DefaultAuditApi",
    "audit_api",
]
