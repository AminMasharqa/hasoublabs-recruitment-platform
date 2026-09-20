"""Platform-side audit capture registration (Section 9 — real implementation).

This package exposes ``register_audit_capture``, which attaches the real
``before_flush`` listener to a SQLAlchemy session or session factory.  The
listener emits field-level before/after diffs for every entity mutation,
applies the sensitive-column redaction map, and extends the hash chain — all
inside the caller's transaction so audit rows share the same ACID boundary as
the mutations they describe.

The public surface (``register_audit_capture``) is unchanged from the mock so
all call sites (``UnitOfWork``, test fixtures, etc.) require no edits.
"""

from app.platform.audit.hook import register_audit_capture

__all__ = ["register_audit_capture"]
