"""Audit module error types (Section 9).

These extend ``PlatformError`` so they render through the one error envelope.
``IntegrityViolation`` is already defined in ``platform/errors/base.py`` and is
re-exported here so callers stay within the module boundary.
"""

from __future__ import annotations

from app.platform.errors.base import IntegrityViolation, PlatformError


class AuditWriteFailed(PlatformError):  # noqa: N818
    """500 — the audit layer could not persist an entry.

    This is fatal: if we can't audit a mutation we must not complete it.
    """

    error_key = "audit_write_failed"
    status_code = 500
    message_key = "error.audit_write_failed"


__all__ = [
    "AuditWriteFailed",
    "IntegrityViolation",
]
