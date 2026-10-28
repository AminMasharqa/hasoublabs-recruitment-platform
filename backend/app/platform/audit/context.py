"""The audit actor identity of the current request or job (R8 AC2).

``audit_actor_id_var`` holds the ``audit_actor_identities`` id every audit entry
written in this context references. :func:`app.platform.audit.actor.bind_principal_actor`
sets it once a request is authenticated; jobs and unauthenticated requests keep
the ``system`` default.

The request id and reason are not duplicated here: audit writers read them from
the request context (:mod:`app.platform.middleware.context`), which the request
middleware and the job runner bind.
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

__all__ = ["audit_actor_id_var"]
