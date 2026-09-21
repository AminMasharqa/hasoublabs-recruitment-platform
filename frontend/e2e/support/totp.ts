/**
 * A minimal RFC 6238 TOTP code generator, driven off the base32 secret the
 * Backend_Api's MFA enrolment returns (Requirement 5 AC4).
 *
 * The journey suite (task 27, `e2e/journeys/admin-accounts.spec.ts` and any
 * other Admin journey that signs in through a full login) has to get past the
 * mandatory-for-Admin second factor exactly the way the Backend_Api enrols and
 * verifies it: `pyotp` with its defaults — SHA-1, 6 digits, a 30-second step,
 * `app/platform/security/mfa.py`. There is no JS TOTP dependency in this
 * project yet and this is the only place one would be used, so rather than add
 * one, this module implements the handful of RFC 6238 steps it needs directly
 * on top of Node's built-in `crypto` — no new dependency for the whole
 * application to carry.
 *
 * This is deliberately not a general-purpose TOTP library: no custom digit
 * counts, no alternate hash algorithms, no clock-drift search beyond the ±1
 * step `verify_code` itself already tolerates. It generates the *current*
 * step's code, which is what a real authenticator app would show the person
 * scanning the QR code at the moment they read it.
 */

import { createHmac } from 'node:crypto'

/** RFC 6238 defaults, matching `pyotp.TOTP`'s own (`app/platform/security/mfa.py`). */
const TOTP_STEP_SECONDS = 30
const TOTP_DIGITS = 6

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Decodes an RFC 4648 base32 string (the alphabet `pyotp.random_base32` uses). */
function base32Decode(secret: string): Buffer {
  const cleaned = secret.trim().toUpperCase().replaceAll('=', '')
  let bits = ''
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      // Not part of the base32 alphabet (padding, whitespace already stripped) —
      // skip rather than throw, so a secret copied with stray formatting still
      // decodes.
      continue
    }
    bits += index.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2))
  }
  return Buffer.from(bytes)
}

/** One HOTP code (RFC 4226) for a given 8-byte counter and secret. */
function hotp(secretBytes: Buffer, counter: bigint): string {
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(counter)
  const hmac = createHmac('sha1', secretBytes).update(counterBuffer).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const truncated =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  const code = (truncated % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, '0')
  return code
}

/**
 * The current TOTP code for a base32 secret, at the instant this is called.
 *
 * A code is valid for one 30-second step and the Backend_Api accepts the
 * adjacent step either side of it (`_TOTP_VALID_WINDOW = 1`), so calling this
 * immediately before submitting the code is enough — there is no need to guard
 * against a step boundary the way a long-lived cached code would have to.
 */
export function currentTotpCode(base32Secret: string, at: Date = new Date()): string {
  const secretBytes = base32Decode(base32Secret)
  const counter = BigInt(Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS))
  return hotp(secretBytes, counter)
}

/**
 * Extracts the `secret` query parameter from an `otpauth://totp/...` URI
 * (the `provisioning_uri` Requirement 5 AC4 returns).
 *
 * Parsed with `URL` against the `otpauth:` scheme's own query string rather than
 * a hand-rolled regex, so any additional parameters (`issuer`, `algorithm`,
 * `digits`, `period`) are ignored rather than tripping a stricter pattern.
 */
export function totpSecretFromProvisioningUri(provisioningUri: string): string {
  const url = new URL(provisioningUri)
  const secret = url.searchParams.get('secret')
  if (secret === null || secret === '') {
    throw new Error(`provisioning_uri carried no secret: ${provisioningUri}`)
  }
  return secret
}
