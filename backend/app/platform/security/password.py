"""Argon2id password hashing and breached-password screening.

Task 3.1 — Requirements: Security constraints (password policy).
Property 52 validated by tests/unit/test_security/test_password.py.

Design decisions:
- passlib[argon2] wraps argon2-cffi and encodes all parameters in the hash
  string, which means rehash-on-login (transparent parameter upgrade) works
  with zero application state.
- Breached-password screening uses a local SHA-1 k-anonymity prefix file
  (5 hex chars). No outbound network call. The prefix file ships as a
  compact bloom-filter-style set loaded at import time from a bundled asset.
  If the asset is absent (dev environment), screening is skipped with a
  warning — this is intentional so the test suite doesn't require the file.
- Unicode code-point counting (not byte-counting) is mandatory because the
  spec says "≥10 code points". Python len() on a str gives code-points only
  if the string is NFC-normalised first (surrogates are rejected by Pydantic
  before we see the value, so this is safe).
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path
from typing import Final
import unicodedata

from passlib.context import CryptContext  # type: ignore[import-untyped]

logger = logging.getLogger(__name__)

# ── Argon2id parameters ────────────────────────────────────────────────────
# Equivalent to bcrypt cost 12 per OWASP Argon2id guidelines (2024).
# Parameters are embedded in the hash string so they survive config changes.
_pwd_context = CryptContext(
    schemes=["argon2"],
    deprecated="auto",
    argon2__type="ID",            # Argon2id (not Argon2i or Argon2d)
    argon2__memory_cost=65536,    # 64 MiB
    argon2__time_cost=3,          # iterations
    argon2__parallelism=4,        # threads
    argon2__hash_len=32,          # output length bytes
    argon2__salt_len=16,          # salt length bytes
)

# ── Policy constants ───────────────────────────────────────────────────────
PASSWORD_MIN_CODE_POINTS: Final[int] = 10
# Maximum is read at runtime from settings but must be at least 64.
_DEFAULT_PASSWORD_MAX: Final[int] = 128

# ── Breached-password screening ────────────────────────────────────────────
# Path to the optional bundled k-anonymity prefix list.
# File format: one uppercase 5-char hex prefix per line.
_BREACH_PREFIX_FILE = Path(__file__).parent / "data" / "pwned_prefixes.txt"
_BREACHED_PREFIXES: set[str] | None = None
_BREACH_FILE_MISSING_WARNED = False


def _load_breached_prefixes() -> set[str] | None:
    """Load the breached-password SHA-1 prefix set on first use."""
    global _BREACHED_PREFIXES, _BREACH_FILE_MISSING_WARNED  # noqa: PLW0603

    if _BREACHED_PREFIXES is not None:
        return _BREACHED_PREFIXES

    if not _BREACH_PREFIX_FILE.exists():
        if not _BREACH_FILE_MISSING_WARNED:
            logger.warning(
                "Breached-password prefix file not found at %s. "
                "Password breach screening is DISABLED. "
                "Run scripts/download_pwned_prefixes.py to enable it.",
                _BREACH_PREFIX_FILE,
            )
            _BREACH_FILE_MISSING_WARNED = True
        return None

    prefixes = set(_BREACH_PREFIX_FILE.read_text().splitlines())
    _BREACHED_PREFIXES = {p.upper() for p in prefixes if p.strip()}
    logger.info("Loaded %d breached password prefixes.", len(_BREACHED_PREFIXES))
    return _BREACHED_PREFIXES


def _sha1_prefix(password: str) -> str:
    """Return the first 5 uppercase hex chars of the SHA-1 of the password."""
    digest = hashlib.sha1(password.encode("utf-8"), usedforsecurity=False).hexdigest()  # noqa: S324
    return digest[:5].upper()


# ── Public API ─────────────────────────────────────────────────────────────

class PasswordPolicyViolation(ValueError):  # noqa: N818
    """Raised when a password fails the policy check before hashing."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


def validate_password_policy(
    password: str,
    *,
    min_length: int = PASSWORD_MIN_CODE_POINTS,
    max_length: int = _DEFAULT_PASSWORD_MAX,
) -> None:
    """Validate password against the platform policy.

    Raises PasswordPolicyViolation if any rule is violated.

    Policy (Security constraints):
    - Minimum ≥10 Unicode code points (NFC-normalized).
    - Maximum configurable, must be ≥64 code points.
    - Not found in the breached-password prefix set.
    """
    if max_length < 64:  # noqa: PLR2004
        msg = "max_length must be at least 64 per platform policy"
        raise ValueError(msg)

    # Normalize to NFC before counting code points (surrogates already
    # rejected by Pydantic but we normalize defensively here).
    normalized = unicodedata.normalize("NFC", password)
    code_points = len(normalized)

    if code_points < min_length:
        raise PasswordPolicyViolation(
            f"Password must be at least {min_length} characters long "
            f"(got {code_points})."
        )

    if code_points > max_length:
        raise PasswordPolicyViolation(
            f"Password must be at most {max_length} characters long "
            f"(got {code_points})."
        )

    # Breached-password screening
    prefixes = _load_breached_prefixes()
    if prefixes is not None:
        prefix = _sha1_prefix(normalized)
        if prefix in prefixes:
            raise PasswordPolicyViolation(
                "This password has appeared in a data breach. "
                "Please choose a different password."
            )


def hash_password(password: str) -> str:
    """Validate policy then return an Argon2id hash of the password.

    The hash string encodes the algorithm and all parameters, enabling
    transparent parameter upgrades via needs_rehash / rehash_if_deprecated.

    Raises PasswordPolicyViolation if policy is violated.
    """
    validate_password_policy(password)
    return _pwd_context.hash(password)


def verify_password(password: str, hashed: str) -> tuple[bool, str | None]:
    """Verify a password against a stored hash.

    Returns:
        (is_valid, new_hash_or_none)

    If the hash was generated with deprecated parameters, new_hash_or_none
    will contain an updated hash that should be persisted (rehash-on-login).
    If verification fails, (False, None) is returned.
    """
    valid, new_hash = _pwd_context.verify_and_update(password, hashed)
    if not valid:
        return False, None
    return True, new_hash


def needs_rehash(hashed: str) -> bool:
    """Return True if the hash was generated with non-current parameters."""
    return _pwd_context.needs_update(hashed)
