"""Request-scoped audit context: who is acting, why, and under which request (R8).

The ``before_flush`` hook and the Unit of Work's failure path read these when
they write an audit entry. Whoever handles a request or runs a job sets them.
"""

from __future__ import annotations

from contextvars import ContextVar
from typing import TYPE_CHECKING

from app.platform.audit.models import SYSTEM_ACTOR_UUID

if TYPE_CHECKING:
    import uuid

#: The current actor identity UUID.  ``SYSTEM_ACTOR_UUID`` when no user is
#: authenticated (background jobs, startup hooks).
audit_actor_id_var: ContextVar[uuid.UUID] = ContextVar("audit_actor_id", default=SYSTEM_ACTOR_UUID)

#: Free-text reason for the current operation (e.g. rejection reason).
audit_reason_var: ContextVar[str | None] = ContextVar("audit_reason", default=None)

#: Request ID propagated from the middleware (``request.state.request_id``).
audit_request_id_var: ContextVar[str | None] = ContextVar("audit_request_id", default=None)


__all__ = ["audit_actor_id_var", "audit_reason_var", "audit_request_id_var"]
