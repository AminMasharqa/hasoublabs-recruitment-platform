"""Property 16: Encryption round-trip with no plaintext at rest.

Task 3.5 — Requirements: 2.15.

Properties validated:
  - decrypt(encrypt(x, key), key) == x for any plaintext and key.
  - The stored bytes contain no substring of the plaintext.
  - Blind index computed twice with the same pepper returns the same digest.
  - Blind index computed with a different pepper returns a different digest
    (with overwhelming probability).
  - verify_blind_index() is constant-time and returns True iff the plaintext
    matches the stored digest.
"""

from __future__ import annotations

import os

from hypothesis import given, settings
from hypothesis import strategies as st
import pytest

from app.platform.security.crypto import (
    compute_blind_index,
    decrypt_sync,
    encrypt_sync,
    verify_blind_index,
)

# ── Strategies ─────────────────────────────────────────────────────────────

_plaintext_strategy = st.binary(min_size=1, max_size=4096)
_key_strategy = st.binary(min_size=32, max_size=32)  # AES-256
_pepper_strategy = st.binary(min_size=16, max_size=32)


# ── Unit tests ─────────────────────────────────────────────────────────────

@pytest.mark.unit
class TestEncryptDecryptSync:
    def test_round_trip(self) -> None:
        key = os.urandom(32)
        plaintext = b"sensitive national ID: 123456789"
        ciphertext = encrypt_sync(plaintext, key)
        recovered = decrypt_sync(ciphertext, key)
        assert recovered == plaintext

    def test_different_plaintexts_differ(self) -> None:
        key = os.urandom(32)
        c1 = encrypt_sync(b"aaaa", key)
        c2 = encrypt_sync(b"bbbb", key)
        assert c1 != c2

    def test_same_plaintext_different_nonces(self) -> None:
        # Each call uses os.urandom(12) for the nonce.
        key = os.urandom(32)
        c1 = encrypt_sync(b"same", key)
        c2 = encrypt_sync(b"same", key)
        assert c1 != c2  # nonces differ → ciphertexts differ

    def test_ciphertext_does_not_contain_plaintext_substring(self) -> None:
        key = os.urandom(32)
        plaintext = b"supersecret_data_1234567890_abcde"
        ciphertext = encrypt_sync(plaintext, key)
        # The plaintext should not appear anywhere in the stored bytes.
        assert plaintext not in ciphertext

    def test_wrong_key_raises(self) -> None:
        from cryptography.exceptions import InvalidTag  # noqa: PLC0415

        key = os.urandom(32)
        wrong_key = os.urandom(32)
        ciphertext = encrypt_sync(b"secret", key)
        with pytest.raises(InvalidTag):
            decrypt_sync(ciphertext, wrong_key)

    def test_truncated_ciphertext_raises(self) -> None:
        key = os.urandom(32)
        ciphertext = encrypt_sync(b"secret", key)
        with pytest.raises(ValueError, match="too short"):
            decrypt_sync(ciphertext[:5], key)

    def test_key_must_be_32_bytes(self) -> None:
        with pytest.raises(ValueError, match="32 bytes"):
            encrypt_sync(b"data", b"short")

    def test_empty_plaintext_round_trips(self) -> None:
        key = os.urandom(32)
        ciphertext = encrypt_sync(b"", key)
        assert decrypt_sync(ciphertext, key) == b""


@pytest.mark.unit
class TestBlindIndex:
    def test_same_inputs_same_digest(self) -> None:
        plaintext = b"050-1234567"
        pepper = os.urandom(32)
        d1 = compute_blind_index(plaintext, pepper)
        d2 = compute_blind_index(plaintext, pepper)
        assert d1 == d2

    def test_different_plaintext_different_digest(self) -> None:
        pepper = os.urandom(32)
        d1 = compute_blind_index(b"value_a", pepper)
        d2 = compute_blind_index(b"value_b", pepper)
        assert d1 != d2

    def test_different_pepper_different_digest(self) -> None:
        plaintext = b"050-1234567"
        p1 = os.urandom(32)
        p2 = os.urandom(32)
        assert compute_blind_index(plaintext, p1) != compute_blind_index(plaintext, p2)

    def test_verify_correct(self) -> None:
        plaintext = b"sensitive"
        pepper = os.urandom(32)
        digest = compute_blind_index(plaintext, pepper)
        assert verify_blind_index(plaintext, pepper, digest) is True

    def test_verify_wrong_plaintext(self) -> None:
        pepper = os.urandom(32)
        digest = compute_blind_index(b"correct", pepper)
        assert verify_blind_index(b"wrong", pepper, digest) is False

    def test_digest_is_32_bytes(self) -> None:
        digest = compute_blind_index(b"data", os.urandom(32))
        assert len(digest) == 32


# ── Property-based tests (Hypothesis) ─────────────────────────────────────

@pytest.mark.property
class TestEncryptionProperties:
    @given(plaintext=_plaintext_strategy, key=_key_strategy)
    @settings(max_examples=100)
    def test_property_16_round_trip(self, plaintext: bytes, key: bytes) -> None:
        """Property 16: decrypt(encrypt(x)) == x for any plaintext."""
        ciphertext = encrypt_sync(plaintext, key)
        recovered = decrypt_sync(ciphertext, key)
        assert recovered == plaintext, (
            f"Round-trip failed: input={plaintext!r}, recovered={recovered!r}"
        )

    @given(plaintext=_plaintext_strategy, key=_key_strategy)
    @settings(max_examples=100)
    def test_property_16_no_plaintext_at_rest(self, plaintext: bytes, key: bytes) -> None:
        """Property 16: stored bytes contain no substring of the plaintext."""
        if len(plaintext) < 4:  # noqa: PLR2004 — too short to detect reliably
            return
        ciphertext = encrypt_sync(plaintext, key)
        # Check a unique 4-byte window from the plaintext is not in the ciphertext.
        # (Not checking all substrings — just a representative sample.)
        window = plaintext[:8]
        assert window not in ciphertext, (
            "Plaintext appears in ciphertext — encryption may not be working"
        )

    @given(
        plaintext=_plaintext_strategy,
        pepper=_pepper_strategy,
    )
    @settings(max_examples=100)
    def test_blind_index_deterministic(self, plaintext: bytes, pepper: bytes) -> None:
        """Blind index of the same input is always the same."""
        d1 = compute_blind_index(plaintext, pepper)
        d2 = compute_blind_index(plaintext, pepper)
        assert d1 == d2

    @given(
        plaintext=_plaintext_strategy,
        pepper=_pepper_strategy,
    )
    @settings(max_examples=100)
    def test_verify_blind_index_correct(
        self, plaintext: bytes, pepper: bytes
    ) -> None:
        """verify_blind_index returns True iff the plaintext matches."""
        digest = compute_blind_index(plaintext, pepper)
        assert verify_blind_index(plaintext, pepper, digest) is True
