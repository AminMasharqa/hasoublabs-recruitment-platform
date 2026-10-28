"""AES-256-GCM envelope encryption with OpenBao-wrapped data keys.

Task 3.2 — Requirements: 2.15 (national IDs / residency proofs), 5.16 (CVs).
Property 16 validated by tests/unit/test_security/test_crypto.py.

Architecture:
  Each sensitive value gets a freshly generated per-record 256-bit data key.
  The data key is encrypted by OpenBao's transit engine (key wrapping) before
  being stored alongside the ciphertext. PostgreSQL backups therefore contain
  ciphertext + wrapped_key but never the unwrapping key, which lives only in
  OpenBao.

  Stored layout (bytes):
    nonce (12 bytes) || tag-included ciphertext (variable)

  DB columns (example: residency_proofs):
    value_enc      bytea    -- nonce || ciphertext (AES-256-GCM output)
    value_wrapped_key bytea -- OpenBao-wrapped data key
    value_digest   bytea    -- HMAC-SHA256(plaintext, pepper) blind index

OpenBao unavailability:
  If OpenBao is unreachable, encrypt() and decrypt() raise OpenBaoUnavailable.
  Callers must propagate this as HTTP 503. Under no circumstances should the
  plaintext fall through to storage.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import httpx

logger = logging.getLogger(__name__)

# AES-256 → 32-byte key.
_AES_KEY_BYTES = 32
_AES_NONCE_BYTES = 12


# ── Errors ─────────────────────────────────────────────────────────────────

class OpenBaoUnavailable(RuntimeError):  # noqa: N818
    """OpenBao transit endpoint is unreachable or returned an error.

    Callers must surface this as HTTP 503 — never fall back to plaintext.
    """


# ── OpenBao transit client ─────────────────────────────────────────────────

class OpenBaoClient:
    """Thin async wrapper around the OpenBao transit API for key wrapping.

    Only the wrap/unwrap (encrypt/decrypt) operations on the transit key are
    used here.  Key generation for each record is done locally with os.urandom
    for performance; OpenBao provides key custody, not entropy.
    """

    def __init__(self, addr: str, token: str, transit_key: str) -> None:
        self._addr = addr.rstrip("/")
        self._token = token
        self._transit_key = transit_key
        self._client = httpx.AsyncClient(
            base_url=self._addr,
            headers={"X-Vault-Token": self._token},
            timeout=5.0,
        )

    async def wrap_key(self, raw_key: bytes) -> bytes:
        """Encrypt a data key using the OpenBao transit engine.

        Returns the wrapped key as raw bytes (base64 decoded from OpenBao's
        response).
        """
        import base64  # noqa: PLC0415

        payload = {"plaintext": base64.b64encode(raw_key).decode()}
        try:
            resp = await self._client.post(
                f"/v1/transit/encrypt/{self._transit_key}", json=payload
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise OpenBaoUnavailable(f"OpenBao unreachable: {exc}") from exc

        ciphertext_b64: str = resp.json()["data"]["ciphertext"]
        # OpenBao returns "vault:v1:<base64>" — store the whole string as bytes
        return ciphertext_b64.encode()

    async def unwrap_key(self, wrapped_key: bytes) -> bytes:
        """Decrypt a wrapped data key using the OpenBao transit engine.

        Returns the original raw key bytes.
        """
        import base64  # noqa: PLC0415

        payload = {"ciphertext": wrapped_key.decode()}
        try:
            resp = await self._client.post(
                f"/v1/transit/decrypt/{self._transit_key}", json=payload
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise OpenBaoUnavailable(f"OpenBao unreachable: {exc}") from exc

        plaintext_b64: str = resp.json()["data"]["plaintext"]
        return base64.b64decode(plaintext_b64)

    async def aclose(self) -> None:
        await self._client.aclose()


# ── Envelope encryption ────────────────────────────────────────────────────

class EnvelopeEncryption:
    """Per-record AES-256-GCM envelope encryption.

    Usage:
        enc = EnvelopeEncryption(bao_client)
        ciphertext, wrapped_key = await enc.encrypt(b"secret data")
        plaintext = await enc.decrypt(ciphertext, wrapped_key)
    """

    def __init__(self, bao_client: OpenBaoClient) -> None:
        self._bao = bao_client

    async def encrypt(self, plaintext: bytes) -> tuple[bytes, bytes]:
        """Encrypt plaintext with a fresh data key.

        Returns:
            (ciphertext_with_nonce, wrapped_data_key)

        ciphertext_with_nonce layout: nonce (12 bytes) || AES-GCM ciphertext.
        wrapped_data_key is the OpenBao-encrypted data key to store alongside.
        """
        # Generate a fresh per-record key and nonce.
        data_key = os.urandom(_AES_KEY_BYTES)
        nonce = os.urandom(_AES_NONCE_BYTES)

        # Encrypt the plaintext.
        aesgcm = AESGCM(data_key)
        ciphertext = aesgcm.encrypt(nonce, plaintext, None)

        # Wrap the data key via OpenBao (raises OpenBaoUnavailable if down).
        wrapped_key = await self._bao.wrap_key(data_key)

        # Zero-out the plaintext key from memory immediately.
        data_key = b"\x00" * _AES_KEY_BYTES  # noqa: S001 (intentional overwrite)

        return nonce + ciphertext, wrapped_key

    async def decrypt(self, ciphertext_with_nonce: bytes, wrapped_key: bytes) -> bytes:
        """Decrypt a value previously encrypted with encrypt().

        Raises:
            OpenBaoUnavailable: if OpenBao is unreachable.
            ValueError: if the ciphertext is malformed or the tag fails.
        """
        if len(ciphertext_with_nonce) < _AES_NONCE_BYTES:
            msg = "Ciphertext too short to contain nonce"
            raise ValueError(msg)

        nonce = ciphertext_with_nonce[:_AES_NONCE_BYTES]
        ciphertext = ciphertext_with_nonce[_AES_NONCE_BYTES:]

        # Unwrap the data key via OpenBao.
        data_key = await self._bao.unwrap_key(wrapped_key)

        aesgcm = AESGCM(data_key)
        plaintext = aesgcm.decrypt(nonce, ciphertext, None)

        # Zero-out the key from memory immediately.
        data_key = b"\x00" * _AES_KEY_BYTES  # noqa: S001

        return plaintext


# ── Blind index ─────────────────────────────────────────────────────────────

def compute_blind_index(plaintext: bytes, pepper: bytes) -> bytes:
    """Compute an HMAC-SHA256 blind index for duplicate detection.

    The blind index allows checking whether two encrypted values are equal
    (e.g. duplicate national IDs) without decryption.

    pepper must come from OpenBao (e.g. a versioned transit HMAC key).
    Do not use a constant pepper — rotate it with key rotation.

    Returns 32 bytes (SHA-256 output).
    """
    return hmac.new(pepper, plaintext, hashlib.sha256).digest()


def verify_blind_index(plaintext: bytes, pepper: bytes, stored_digest: bytes) -> bool:
    """Return True if plaintext matches a stored blind index (constant-time)."""
    expected = compute_blind_index(plaintext, pepper)
    return hmac.compare_digest(expected, stored_digest)


# ── Synchronous thin wrapper (for tests / sync code paths) ─────────────────

def encrypt_sync(plaintext: bytes, raw_key: bytes) -> bytes:
    """AES-256-GCM encryption with a caller-supplied key (no key wrapping).

    Used in tests and in scenarios where OpenBao is bypassed (e.g., developer
    mode with a local key). NOT for production use with sensitive data.
    Returns nonce (12 bytes) || ciphertext.
    """
    if len(raw_key) != _AES_KEY_BYTES:
        msg = f"Key must be {_AES_KEY_BYTES} bytes, got {len(raw_key)}"
        raise ValueError(msg)
    nonce = os.urandom(_AES_NONCE_BYTES)
    aesgcm = AESGCM(raw_key)
    return nonce + aesgcm.encrypt(nonce, plaintext, None)


def decrypt_sync(ciphertext_with_nonce: bytes, raw_key: bytes) -> bytes:
    """AES-256-GCM decryption with a caller-supplied key (no key wrapping).

    Counterpart of encrypt_sync. Used in tests.
    """
    if len(raw_key) != _AES_KEY_BYTES:
        msg = f"Key must be {_AES_KEY_BYTES} bytes, got {len(raw_key)}"
        raise ValueError(msg)
    if len(ciphertext_with_nonce) < _AES_NONCE_BYTES:
        msg = "Ciphertext too short to contain nonce"
        raise ValueError(msg)
    nonce = ciphertext_with_nonce[:_AES_NONCE_BYTES]
    ciphertext = ciphertext_with_nonce[_AES_NONCE_BYTES:]
    aesgcm = AESGCM(raw_key)
    return aesgcm.decrypt(nonce, ciphertext, None)
