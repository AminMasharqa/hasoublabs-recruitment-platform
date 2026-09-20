"""TOTP multi-factor authentication.

Task 3.3 (partial) — Requirements: Security constraints (MFA).

MFA is mandatory for Admin accounts in production (enforced in AuthService).
The TOTP secret is stored encrypted via AES-256-GCM envelope encryption
(crypto.py) in accounts.mfa_secret_enc.

Flow:
  Enrolment:
    1. generate_secret() → raw_secret, provisioning_uri, qr_code_png_bytes
    2. Caller encrypts raw_secret with EnvelopeEncryption and stores it.
    3. User scans QR code in their authenticator app.
    4. User submits a verification code to confirm enrolment.

  Verification (on login):
    1. Caller decrypts mfa_secret_enc to get raw_secret.
    2. verify_code(raw_secret, submitted_code) → bool
"""

from __future__ import annotations

import io
import logging
from typing import NamedTuple

import pyotp
import qrcode  # type: ignore[import-untyped]

logger = logging.getLogger(__name__)

# TOTP window: accept current and ±1 step (30s window = allows ~30s clock skew).
_TOTP_VALID_WINDOW = 1


class MFAEnrolmentData(NamedTuple):
    """Result of starting an MFA enrolment."""

    raw_secret: bytes
    """The raw base32 TOTP secret — must be encrypted before storage."""

    provisioning_uri: str
    """otpauth:// URI for QR code rendering in an authenticator app."""

    qr_code_png: bytes
    """PNG bytes of the QR code for the provisioning URI."""


def generate_secret(
    *,
    account_email: str,
    issuer: str = "HasoubLabs",
) -> MFAEnrolmentData:
    """Generate a new TOTP secret and produce enrolment artefacts.

    The raw_secret MUST be encrypted (via crypto.EnvelopeEncryption) before
    being written to the database. Never store it in plaintext.
    """
    totp = pyotp.TOTP(pyotp.random_base32())
    provisioning_uri = totp.provisioning_uri(
        name=account_email,
        issuer_name=issuer,
    )

    # Generate QR code PNG in memory.
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        box_size=10,
        border=4,
    )
    qr.add_data(provisioning_uri)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    qr_png = buffer.getvalue()

    return MFAEnrolmentData(
        raw_secret=totp.secret.encode(),
        provisioning_uri=provisioning_uri,
        qr_code_png=qr_png,
    )


def verify_code(raw_secret: bytes, code: str) -> bool:
    """Verify a TOTP code against the raw secret.

    Accepts codes within ±1 time step of the current step to tolerate
    minor clock skew between the user's device and the server.

    Args:
        raw_secret: The raw (unencrypted) base32 TOTP secret bytes.
        code: The 6-digit code submitted by the user.

    Returns:
        True if the code is valid for the current time window.
    """
    try:
        totp = pyotp.TOTP(raw_secret.decode())
        return totp.verify(code, valid_window=_TOTP_VALID_WINDOW)
    except Exception:  # noqa: BLE001
        logger.warning("TOTP verification raised an unexpected error", exc_info=True)
        return False


def is_enrolled(mfa_secret_enc: bytes | None) -> bool:
    """Return True if an account has completed MFA enrolment."""
    return mfa_secret_enc is not None and len(mfa_secret_enc) > 0
