"""No-op ``before_flush`` audit capture hook (MOCK for Section 9).

Replace the listener body in Section 9 with the real capture: inspect the
session's ``new`` / ``dirty`` / ``deleted`` sets, emit one ``audit_log`` row per
affected entity with ``before`` / ``after`` JSONB maps of changed columns only,
apply the sensitive-column redaction map, and extend the hash chain. The public
surface (``register_audit_capture``) stays identical so the ``UnitOfWork`` call
site does not change.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from sqlalchemy import event

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

_LOG = logging.getLogger(__name__)

#: Guards against double-registration when a session factory is reused.
_REGISTERED_MARKER = "_hasoub_audit_capture_registered"


def register_audit_capture(target: Any) -> None:
    """Attach the audit ``before_flush`` listener to a session (factory).

    MOCK: the listener currently records nothing. It only logs at DEBUG so the
    capture point is observable during development, then returns.

    Args:
        target: a SQLAlchemy ``Session``, ``sessionmaker`` /
            ``async_sessionmaker``, or the ``Session`` class — anything the
            SQLAlchemy event API accepts for the ``before_flush`` event.
    """
    if getattr(target, _REGISTERED_MARKER, False):
        return

    @event.listens_for(target, "before_flush")
    def _capture(session: Session, flush_context: Any, instances: Any) -> None:  # noqa: ANN401, ARG001
        # Section 9 replaces this body. Until then: no audit row is written.
        # The design requires audit writes to share the mutation's transaction,
        # so the real implementation emits rows here, inside the same flush.
        if _LOG.isEnabledFor(logging.DEBUG):
            _LOG.debug(
                "audit capture (mock): new=%d dirty=%d deleted=%d — recording nothing",
                len(session.new),
                len(session.dirty),
                len(session.deleted),
            )

    try:
        target._hasoub_audit_capture_registered = True  # noqa: SLF001
    except (AttributeError, TypeError):
        # Some event targets (e.g. the Session class) may reject attribute
        # assignment; the listener is still attached, which is what matters.
        pass


__all__ = ["register_audit_capture"]
