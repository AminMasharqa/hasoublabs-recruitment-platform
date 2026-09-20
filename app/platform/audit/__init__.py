"""Platform-side audit capture registration (MOCK).

PROVISIONAL / MOCK OWNERSHIP NOTE
---------------------------------
The real audit machinery — the append-only ``audit_log``, the hash chain, and
the ``before_flush`` capture listener that emits field-level before/after diffs
— belongs to Section 9 (``modules/audit``, owned by Salma) and is not yet
merged. Every mutation is supposed to flow through that listener (design D-6:
"Audit capture in the persistence layer, not at call sites").

This shim exists only so the :class:`~app.platform.db.uow.UnitOfWork` has a
stable capture hook to install *now*, letting Fadi's Section 6/7 writes run
without the real audit layer present. It is a **no-op**: it records nothing.

Contract preserved for the real implementation to drop into:
- ``register_audit_capture(session)`` attaches a ``before_flush`` listener to a
  session (or session factory). Section 9 replaces the body; the signature and
  call site in ``UnitOfWork`` stay put.

IMPORTANT: the design also requires "never fail closed on the audit path" — if
an audit write fails, the domain transaction must fail with it. A no-op cannot
violate that (it never writes), but do not mistake this shim for a working audit
trail. Anything relying on a real audit record MUST wait for Section 9.
"""

from app.platform.audit.hook import register_audit_capture

__all__ = ["register_audit_capture"]
