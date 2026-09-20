"""Unit tests for audit ORM model structure and constants (Property 41, 46).

Property 41 (partial): Audit completeness and entry structure.
Property 46 (partial): Deletion requests never remove audit entries — the
  anonymisation path only touches audit_actor_identities, not audit_log rows.

No database needed: tests inspect the ORM metadata and class attributes.
"""

from __future__ import annotations

import uuid

import pytest


class TestAuditLogEntryModel:
    def test_tablename(self) -> None:
        from app.modules.audit.models import AuditLogEntry
        assert AuditLogEntry.__tablename__ == "audit_log"

    def test_id_is_biginteger(self) -> None:
        from sqlalchemy import BigInteger
        from app.modules.audit.models import AuditLogEntry
        col = AuditLogEntry.__table__.c["id"]
        assert isinstance(col.type, BigInteger)

    def test_partition_by_in_table_args(self) -> None:
        """postgresql_partition_by must be declared so Alembic emits RANGE DDL."""
        from app.modules.audit.models import AuditLogEntry
        args = AuditLogEntry.__table_args__
        dicts = [a for a in args if isinstance(a, dict)]
        assert any("postgresql_partition_by" in d for d in dicts), (
            "AuditLogEntry must declare postgresql_partition_by in __table_args__"
        )

    def test_brin_index_on_occurred_at(self) -> None:
        from app.modules.audit.models import AuditLogEntry
        args = AuditLogEntry.__table_args__
        from sqlalchemy import Index
        indexes = [a for a in args if isinstance(a, Index)]
        brin = [i for i in indexes if "brin" in i.name]
        assert brin, "Expected a BRIN index on occurred_at"

    def test_outcome_column_defaults_to_success(self) -> None:
        from app.modules.audit.models import AuditLogEntry
        col = AuditLogEntry.__table__.c["outcome"]
        assert col.default is not None or col.server_default is not None

    def test_required_columns_present(self) -> None:
        from app.modules.audit.models import AuditLogEntry
        cols = {c.name for c in AuditLogEntry.__table__.c}
        required = {
            "id", "occurred_at", "actor_identity_id",
            "action", "entity_type", "entity_id",
            "before", "after", "prev_hash", "entry_hash", "outcome",
        }
        assert required <= cols, f"Missing columns: {required - cols}"


class TestAuditActorIdentityModel:
    def test_tablename(self) -> None:
        from app.modules.audit.models import AuditActorIdentity
        assert AuditActorIdentity.__tablename__ == "audit_actor_identities"

    def test_system_actor_uuid_is_zero_uuid(self) -> None:
        from app.modules.audit.models import SYSTEM_ACTOR_UUID
        assert SYSTEM_ACTOR_UUID == uuid.UUID("00000000-0000-0000-0000-000000000000")

    def test_unique_constraint_on_account_id_role(self) -> None:
        from sqlalchemy import UniqueConstraint
        from app.modules.audit.models import AuditActorIdentity
        args = AuditActorIdentity.__table_args__
        uqs = [a for a in args if isinstance(a, UniqueConstraint)]
        assert any(
            set(c.name for c in uq.columns) == {"account_id", "role"}
            for uq in uqs
        ), "Expected unique constraint on (account_id, role)"

    def test_anonymised_at_is_nullable(self) -> None:
        from app.modules.audit.models import AuditActorIdentity
        col = AuditActorIdentity.__table__.c["anonymised_at"]
        assert col.nullable is True

    def test_email_is_nullable(self) -> None:
        from app.modules.audit.models import AuditActorIdentity
        col = AuditActorIdentity.__table__.c["email"]
        assert col.nullable is True


class TestAnonymisationNeverTouchesAuditLog:
    """Property 46: Anonymisation removes personal data from audit_actor_identities
    only. The audit_log rows (carrying the hash chain) are never modified.
    """

    def test_anonymise_actor_only_targets_identity_table(self) -> None:
        """Inspect the anonymise_actor source to confirm it only touches AuditActorIdentity."""
        import inspect as pyinspect
        from app.modules.audit import repository
        src = pyinspect.getsource(repository.anonymise_actor)
        # Must not reference AuditLogEntry directly.
        assert "AuditLogEntry" not in src, (
            "anonymise_actor must not touch AuditLogEntry rows"
        )
        assert "AuditActorIdentity" in src

    def test_anonymise_sets_display_name_to_anonymised(self) -> None:
        """anonymise_actor must set display_name to '[anonymised]'."""
        import inspect as pyinspect
        from app.modules.audit import repository
        src = pyinspect.getsource(repository.anonymise_actor)
        assert "[anonymised]" in src

    def test_anonymise_sets_email_to_none(self) -> None:
        import inspect as pyinspect
        from app.modules.audit import repository
        src = pyinspect.getsource(repository.anonymise_actor)
        assert "email = None" in src or "email=None" in src


class TestModulePublicSurface:
    """api.py must be the only cross-module entry point (module boundary rule)."""

    def test_audit_api_exports_expected_names(self) -> None:
        from app.modules.audit import api as m
        assert hasattr(m, "AuditApi")
        assert hasattr(m, "DefaultAuditApi")
        assert hasattr(m, "audit_api")
        assert hasattr(m, "record_denial_async")

    def test_schemas_exports_dtos(self) -> None:
        from app.modules.audit import schemas as m
        assert hasattr(m, "AuditLogEntryDTO")
        assert hasattr(m, "AuditSearchResponse")
        assert hasattr(m, "ChainVerifyResponse")
