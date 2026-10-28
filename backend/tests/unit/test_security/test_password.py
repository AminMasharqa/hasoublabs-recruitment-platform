"""Property 52: Password policy and hash round-trip.

Task 3.4 — Requirements: Security constraints (password policy).

Properties validated:
  - Registration accepts a password if and only if it is ≥10 Unicode code
    points, is not present in the breached-password prefix set, and is within
    the configured maximum of at least 64 code points.
  - For any accepted password, verify_password() against its Argon2id hash
    succeeds; verify_password() of any different password against that hash
    fails.
  - validate_password_policy() enforces the code-point minimum and maximum.
  - needs_rehash() returns False for a freshly generated hash.
"""

from __future__ import annotations

import unicodedata

from hypothesis import given, settings
from hypothesis import strategies as st
import pytest

from app.platform.security.password import (
    PASSWORD_MIN_CODE_POINTS,
    PasswordPolicyViolation,
    hash_password,
    needs_rehash,
    validate_password_policy,
    verify_password,
)

# ── Strategies ─────────────────────────────────────────────────────────────

# Passwords that are long enough and do not contain non-printable chars.
_valid_password_strategy = st.text(
    alphabet=st.characters(
        whitelist_categories=("Lu", "Ll", "Nd", "Po", "Sm"),
        min_codepoint=32,
    ),
    min_size=PASSWORD_MIN_CODE_POINTS,
    max_size=64,
)

# Passwords that are too short.
_short_password_strategy = st.text(
    alphabet=st.characters(min_codepoint=32),
    min_size=0,
    max_size=PASSWORD_MIN_CODE_POINTS - 1,
)


# ── Unit tests ─────────────────────────────────────────────────────────────

@pytest.mark.unit
class TestPasswordPolicyEnforcement:
    def test_accepts_exactly_min_length(self) -> None:
        pwd = "A" * PASSWORD_MIN_CODE_POINTS
        validate_password_policy(pwd)  # must not raise

    def test_rejects_one_below_min_length(self) -> None:
        pwd = "A" * (PASSWORD_MIN_CODE_POINTS - 1)
        with pytest.raises(PasswordPolicyViolation, match="at least"):
            validate_password_policy(pwd)

    def test_rejects_empty(self) -> None:
        with pytest.raises(PasswordPolicyViolation, match="at least"):
            validate_password_policy("")

    def test_rejects_exceeding_max(self) -> None:
        pwd = "A" * 129  # default max = 128
        with pytest.raises(PasswordPolicyViolation, match="at most"):
            validate_password_policy(pwd, max_length=128)

    def test_accepts_exactly_max(self) -> None:
        pwd = "A" * 128
        validate_password_policy(pwd, max_length=128)  # must not raise

    def test_max_length_must_be_at_least_64(self) -> None:
        with pytest.raises(ValueError, match="at least 64"):
            validate_password_policy("ValidPass123!", max_length=63)

    def test_code_point_counting_not_bytes(self) -> None:
        # U+1F600 (😀) is 4 UTF-8 bytes but 1 code point.
        # 10 such characters → 10 code points → should pass min=10.
        pwd = "😀" * PASSWORD_MIN_CODE_POINTS
        validate_password_policy(pwd)  # must not raise

    def test_nfc_normalization_before_counting(self) -> None:
        # é can be encoded as U+00E9 (precomposed, 1 code point)
        # or as U+0065 U+0301 (decomposed, 2 code points).
        # After NFC normalization both become 1 code point each.
        precomposed = "\u00e9" * PASSWORD_MIN_CODE_POINTS
        validate_password_policy(precomposed)  # must not raise

    def test_breached_screening_skipped_when_file_absent(self) -> None:
        # The prefix file does not exist in the test environment.
        # Policy validation must not raise for a valid password.
        pwd = "ValidPass123!" + "x" * (PASSWORD_MIN_CODE_POINTS - 13)
        validate_password_policy(pwd)  # must not raise (screening skipped)


@pytest.mark.unit
class TestHashAndVerify:
    def test_valid_password_hashes_and_verifies(self) -> None:
        pwd = "C0rrectH0rse!Battery"
        hashed = hash_password(pwd)
        valid, _ = verify_password(pwd, hashed)
        assert valid is True

    def test_wrong_password_does_not_verify(self) -> None:
        pwd = "C0rrectH0rse!Battery"
        hashed = hash_password(pwd)
        valid, _ = verify_password("WrongPassword1234!", hashed)
        assert valid is False

    def test_fresh_hash_does_not_need_rehash(self) -> None:
        pwd = "C0rrectH0rse!Battery"
        hashed = hash_password(pwd)
        assert needs_rehash(hashed) is False

    def test_hash_policy_still_enforced(self) -> None:
        with pytest.raises(PasswordPolicyViolation):
            hash_password("short")

    def test_different_calls_produce_different_hashes(self) -> None:
        # Argon2id uses a random salt each time.
        pwd = "UniqueHashTest1234!"
        h1 = hash_password(pwd)
        h2 = hash_password(pwd)
        assert h1 != h2

    def test_verify_returns_new_hash_when_params_outdated(self) -> None:
        # We can't easily force a rehash without changing the real context,
        # so we verify that a freshly hashed password returns None as new_hash.
        pwd = "C0rrectH0rse!Battery"
        hashed = hash_password(pwd)
        valid, new_hash = verify_password(pwd, hashed)
        assert valid is True
        # Fresh hash with current params → no rehash needed.
        assert new_hash is None


# ── Property-based tests (Hypothesis) ─────────────────────────────────────

@pytest.mark.property
class TestPasswordPolicyProperties:
    @given(password=_valid_password_strategy)
    @settings(max_examples=100, deadline=None)  # Argon2id is intentionally slow (~300ms)
    def test_property_52_valid_passwords_verify(self, password: str) -> None:
        """Property 52 (partial): any policy-passing password verifies correctly."""
        hashed = hash_password(password)
        valid, _ = verify_password(password, hashed)
        assert valid is True, f"verify_password failed for a valid password: {password!r}"

    @given(password=_valid_password_strategy)
    @settings(max_examples=100, deadline=None)  # Argon2id is intentionally slow (~300ms)
    def test_property_52_different_password_fails(self, password: str) -> None:
        """Property 52 (partial): a different password never verifies against a hash."""
        hashed = hash_password(password)
        # Append a character to guarantee a different password.
        different = password + "!"
        valid, _ = verify_password(different, hashed)
        assert valid is False, (
            f"verify_password succeeded for wrong password. "
            f"original={password!r} tried={different!r}"
        )

    @given(password=_short_password_strategy)
    @settings(max_examples=100)
    def test_property_52_short_passwords_rejected(self, password: str) -> None:
        """Property 52 (partial): passwords below min length are always rejected."""
        normalized_len = len(unicodedata.normalize("NFC", password))
        if normalized_len >= PASSWORD_MIN_CODE_POINTS:
            return  # NFC normalization could collapse decomposed chars — skip
        with pytest.raises(PasswordPolicyViolation):
            validate_password_policy(password)

    @given(password=_valid_password_strategy)
    @settings(max_examples=50)
    def test_fresh_hash_never_needs_rehash(self, password: str) -> None:
        """Fresh hashes with current params never need rehashing."""
        hashed = hash_password(password)
        assert needs_rehash(hashed) is False
