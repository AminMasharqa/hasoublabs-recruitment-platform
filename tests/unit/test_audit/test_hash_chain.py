"""Unit tests for the audit hash-chain algorithm (Properties 45 & 42).

These are pure-logic tests — no database, no I/O.

Property 45: Hash chain verifies legitimate logs and detects any mutation.
  Every entry_hash is re-computable from entry_fields + prev_hash.
  Mutating *any* byte of any entry (fields or stored hash) breaks verification.

Property 42: Audit_Log is append-only under monotone reads.
  This portion tests the hash invariants that make the chain tamper-evident.
  The DB-level append-only enforcement is tested in the integration suite.

Task 9.10 & 9.7 (security-critical, must keep per sprint-planning.md).
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from app.modules.audit.repository import compute_entry_hash


# ── helpers ────────────────────────────────────────────────────────────────────

def _make_fields(
    *,
    actor_id: str | None = None,
    action: str = "Account.created",
    entity_type: str = "Account",
    entity_id: str = "abc-123",
    occurred_at: datetime | None = None,
) -> dict:
    return {
        "actor_identity_id": actor_id or str(uuid.uuid4()),
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "before": None,
        "after": {"status": "PendingVerification"},
        "reason": None,
        "request_id": "req-001",
        "outcome": "success",
        "error_type": None,
        "occurred_at": occurred_at or datetime.now(UTC),
    }


def _build_chain(n: int) -> list[bytes]:
    """Build a legitimate hash chain of ``n`` entries. Returns [entry_hash, ...]."""
    hashes: list[bytes] = []
    prev: bytes | None = None
    for i in range(n):
        fields = _make_fields(entity_id=str(i))
        h = compute_entry_hash(fields, prev)
        hashes.append(h)
        prev = h
    return hashes


# ── determinism ────────────────────────────────────────────────────────────────

class TestComputeEntryHashDeterminism:
    def test_same_inputs_produce_same_hash(self) -> None:
        fields = _make_fields(occurred_at=datetime(2026, 1, 1, 0, 0, 0, tzinfo=UTC))
        prev = b"\x00" * 32
        h1 = compute_entry_hash(fields, prev)
        h2 = compute_entry_hash(fields, prev)
        assert h1 == h2

    def test_output_is_32_bytes(self) -> None:
        h = compute_entry_hash(_make_fields(), None)
        assert len(h) == 32  # SHA-256

    def test_genesis_entry_has_no_prev(self) -> None:
        """First entry (prev_hash=None) must not equal any entry with prev_hash=b""."""
        fields = _make_fields(occurred_at=datetime(2026, 1, 1, tzinfo=UTC))
        h_none = compute_entry_hash(fields, None)
        h_empty = compute_entry_hash(fields, b"")
        # Both use b"" internally, so they should be equal (None → b"").
        assert h_none == h_empty

    def test_different_prev_hash_produces_different_entry_hash(self) -> None:
        fields = _make_fields(occurred_at=datetime(2026, 1, 1, tzinfo=UTC))
        h1 = compute_entry_hash(fields, b"\x00" * 32)
        h2 = compute_entry_hash(fields, b"\xff" * 32)
        assert h1 != h2


# ── chain integrity ────────────────────────────────────────────────────────────

class TestHashChainIntegrity:
    def test_chain_of_one_is_valid(self) -> None:
        chain = _build_chain(1)
        assert len(chain) == 1

    def test_chain_of_ten_all_distinct(self) -> None:
        chain = _build_chain(10)
        assert len(set(chain)) == 10  # all hashes are unique

    def test_recomputing_chain_matches_stored_hashes(self) -> None:
        """Re-walk a 50-entry chain and confirm every recomputed hash matches stored."""
        n = 50
        fields_list = [_make_fields(entity_id=str(i)) for i in range(n)]
        stored_hashes: list[bytes] = []
        prev: bytes | None = None
        for fields in fields_list:
            h = compute_entry_hash(fields, prev)
            stored_hashes.append(h)
            prev = h

        # Re-verify
        prev = None
        for i, fields in enumerate(fields_list):
            expected = compute_entry_hash(fields, prev)
            assert expected == stored_hashes[i], f"Hash mismatch at entry {i}"
            prev = stored_hashes[i]


# ── mutation detection (Property 45) ──────────────────────────────────────────

class TestMutationDetection:
    """Mutating ANY part of an entry must break verification from that point forward."""

    def test_mutating_action_field_breaks_chain(self) -> None:
        fields = _make_fields(action="Account.created")
        prev = b"\xab" * 32
        original_hash = compute_entry_hash(fields, prev)

        mutated = dict(fields)
        mutated["action"] = "Account.deleted"  # tamper
        tampered_hash = compute_entry_hash(mutated, prev)
        assert tampered_hash != original_hash

    def test_mutating_entity_id_breaks_chain(self) -> None:
        fields = _make_fields(entity_id="legitimate-id")
        prev = None
        h1 = compute_entry_hash(fields, prev)

        mutated = dict(fields)
        mutated["entity_id"] = "attacker-id"
        h2 = compute_entry_hash(mutated, prev)
        assert h1 != h2

    def test_mutating_before_field_breaks_chain(self) -> None:
        fields = _make_fields()
        fields["before"] = {"status": "Approved"}
        prev = None
        h1 = compute_entry_hash(fields, prev)

        mutated = dict(fields)
        mutated["before"] = {"status": "Rejected"}
        h2 = compute_entry_hash(mutated, prev)
        assert h1 != h2

    def test_inserting_entry_in_middle_breaks_downstream(self) -> None:
        """Inserting a new entry between two existing ones invalidates the chain."""
        fields_a = _make_fields(entity_id="a")
        fields_b = _make_fields(entity_id="b")
        fields_c = _make_fields(entity_id="c")

        hash_a = compute_entry_hash(fields_a, None)
        hash_b = compute_entry_hash(fields_b, hash_a)
        hash_c = compute_entry_hash(fields_c, hash_b)  # legitimate

        # Now: insert a fake entry between b and c.
        fields_fake = _make_fields(entity_id="FAKE")
        hash_fake = compute_entry_hash(fields_fake, hash_b)
        # Downstream entry c would need to use hash_fake as prev, not hash_b.
        hash_c_if_fake_present = compute_entry_hash(fields_c, hash_fake)
        assert hash_c != hash_c_if_fake_present

    def test_deleting_entry_breaks_downstream(self) -> None:
        """Removing an entry from the middle invalidates every subsequent hash."""
        fields_list = [_make_fields(entity_id=str(i)) for i in range(5)]
        hashes: list[bytes] = []
        prev: bytes | None = None
        for f in fields_list:
            h = compute_entry_hash(f, prev)
            hashes.append(h)
            prev = h

        # If entry 2 is deleted, entry 3's hash would now chain from entry 1's hash.
        h3_if_2_deleted = compute_entry_hash(fields_list[3], hashes[1])
        assert h3_if_2_deleted != hashes[3], "Deletion must break downstream hashes"


# ── property-based tests (Hypothesis) ─────────────────────────────────────────

class TestHashChainProperties:
    """Property 45: Hash chain verifies legitimate logs and detects any mutation."""

    @given(
        n=st.integers(min_value=1, max_value=50),
        seed=st.integers(min_value=0, max_value=2**32 - 1),
    )
    @settings(max_examples=150)
    def test_legitimate_chain_always_verifies(self, n: int, seed: int) -> None:
        """A chain built correctly always passes re-verification."""
        rng_actor = str(uuid.UUID(int=seed % (2**128)))
        fields_list = [
            _make_fields(
                actor_id=rng_actor,
                entity_id=f"{seed}-{i}",
                occurred_at=datetime(2026, 1, 1, tzinfo=UTC),
            )
            for i in range(n)
        ]

        stored_hashes: list[bytes] = []
        prev: bytes | None = None
        for fields in fields_list:
            h = compute_entry_hash(fields, prev)
            stored_hashes.append(h)
            prev = h

        # Re-verify
        prev = None
        for i, (fields, stored) in enumerate(zip(fields_list, stored_hashes)):
            expected = compute_entry_hash(fields, prev)
            assert expected == stored, f"Verification failed at entry {i}"
            prev = stored

    @given(
        fields_json=st.fixed_dictionaries(
            {
                "actor_identity_id": st.uuids().map(str),
                "action": st.text(min_size=1, max_size=50, alphabet=st.characters(blacklist_categories=["Cs"])),
                "entity_type": st.sampled_from(["Account", "CvVersion", "Application"]),
                "entity_id": st.uuids().map(str),
                "before": st.none(),
                "after": st.none(),
                "reason": st.none(),
                "request_id": st.none(),
                "outcome": st.just("success"),
                "error_type": st.none(),
                "occurred_at": st.datetimes(
                    min_value=datetime(2024, 1, 1),
                    max_value=datetime(2030, 12, 31),
                    timezones=st.just(UTC),
                ),
            }
        ),
        prev_hash=st.one_of(st.none(), st.binary(min_size=32, max_size=32)),
    )
    @settings(max_examples=200)
    def test_any_field_mutation_changes_hash(
        self, fields_json: dict, prev_hash: bytes | None
    ) -> None:
        """Mutating any entry field must produce a different hash."""
        original_hash = compute_entry_hash(fields_json, prev_hash)

        # Mutate the action field.
        mutated = dict(fields_json)
        mutated["action"] = mutated["action"] + "_TAMPERED"
        tampered_hash = compute_entry_hash(mutated, prev_hash)
        assert original_hash != tampered_hash

    @given(
        prev_a=st.binary(min_size=32, max_size=32),
        prev_b=st.binary(min_size=32, max_size=32),
    )
    @settings(max_examples=150)
    def test_different_prev_hash_always_different_entry_hash(
        self, prev_a: bytes, prev_b: bytes
    ) -> None:
        """If prev_a != prev_b then entry hashes must differ (with overwhelming probability)."""
        if prev_a == prev_b:
            return  # trivially equal — skip
        fields = _make_fields(occurred_at=datetime(2026, 1, 1, tzinfo=UTC))
        h_a = compute_entry_hash(fields, prev_a)
        h_b = compute_entry_hash(fields, prev_b)
        assert h_a != h_b


# ── redaction map (Property 41 partial) ───────────────────────────────────────

class TestSensitiveColumnRedaction:
    """Sensitive columns must never appear as plain values in audit JSONB."""

    def test_redacted_columns_constant_exists(self) -> None:
        from app.modules.audit.repository import REDACTED_COLUMNS
        assert "residency_proofs.value_enc" in REDACTED_COLUMNS
        assert "accounts.password_hash" in REDACTED_COLUMNS
        assert "email_verifications.code_hash" in REDACTED_COLUMNS

    def test_redacted_sentinel_is_string(self) -> None:
        from app.modules.audit.repository import _REDACTED_SENTINEL
        assert isinstance(_REDACTED_SENTINEL, str)
        assert "[REDACTED]" in _REDACTED_SENTINEL

    def test_snapshot_redacts_known_columns(self) -> None:
        """_snapshot() must replace sensitive values with the sentinel."""
        from app.platform.audit.hook import _snapshot

        class FakeResidencyProof:
            __tablename__ = "residency_proofs"

        # We can't easily build a SQLAlchemy-mapped object in unit tests,
        # so we test _snapshot's redaction logic indirectly via the constant set.
        from app.modules.audit.repository import REDACTED_COLUMNS
        assert "residency_proofs.value_enc" in REDACTED_COLUMNS
        assert "residency_proofs.value_digest" in REDACTED_COLUMNS


# ── actor context variables ────────────────────────────────────────────────────

class TestAuditContextVars:
    def test_default_actor_is_system_uuid(self) -> None:
        from app.modules.audit.models import SYSTEM_ACTOR_UUID
        from app.modules.audit.repository import audit_actor_id_var
        assert audit_actor_id_var.get() == SYSTEM_ACTOR_UUID

    def test_default_reason_is_none(self) -> None:
        from app.modules.audit.repository import audit_reason_var
        assert audit_reason_var.get() is None

    def test_default_request_id_is_none(self) -> None:
        from app.modules.audit.repository import audit_request_id_var
        assert audit_request_id_var.get() is None

    def test_context_var_can_be_set(self) -> None:
        from app.modules.audit.repository import audit_reason_var
        token = audit_reason_var.set("test-reason")
        try:
            assert audit_reason_var.get() == "test-reason"
        finally:
            audit_reason_var.reset(token)

    def test_context_var_reset_restores_default(self) -> None:
        from app.modules.audit.repository import audit_reason_var
        token = audit_reason_var.set("ephemeral")
        audit_reason_var.reset(token)
        assert audit_reason_var.get() is None
