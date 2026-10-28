/**
 * Admin enrolment, verification and the enrolment indicator (Requirement 5 AC4,
 * AC6, AC7).
 *
 * The two requests are driven through a stub Api_Client, so the assertions are
 * about the endpoints, the bodies and the decoding rather than about a rendering.
 */

import { describe, expect, it, vi } from 'vitest'

import type { ApiClient } from '../../api/client'

import {
  ADMIN_ACCOUNTS_PATH,
  findOwnAccount,
  isVerifiedOutcome,
  MFA_ENROLL_PATH,
  MFA_VERIFY_PATH,
  OWN_ACCOUNT_MAX_PAGES,
  ownAccountQueryKey,
  qrCodeImageSource,
  startMfaEnrolment,
  verifyMfaCode,
  type Account,
} from './mfaEnrolment'

/** One `AccountDTO`, with only the members these assertions read spelled out. */
function account(id: string, mfaEnrolled = false): Account {
  return {
    id,
    email: `${id}@example.com`,
    roles: ['ADMIN'],
    status: 'Approved',
    language_preference: 'en',
    mfa_enrolled: mfaEnrolled,
    created_at: '2025-01-01T00:00:00Z',
  }
}

/** An Api_Client whose `request` answers from a scripted list of bodies. */
function stubApi(bodies: readonly unknown[]): {
  readonly api: ApiClient
  readonly calls: { method: string; path: string; init?: unknown }[]
} {
  const calls: { method: string; path: string; init?: unknown }[] = []
  let index = 0
  const api = {
    request: vi.fn((method: string, path: string, init?: unknown) => {
      calls.push({ method, path, init })
      const data = bodies[index]
      index += 1
      return Promise.resolve({ data, response: new Response(), supportReference: null })
    }),
    exchangeRefreshToken: vi.fn(),
    revokeSession: vi.fn(),
  } as unknown as ApiClient
  return { api, calls }
}

describe('beginning enrolment (AC4)', () => {
  it('posts to the enrolment endpoint and returns both artefacts', async () => {
    const { api, calls } = stubApi([
      { provisioning_uri: 'otpauth://totp/HasoubLabs:admin', qr_code_png_b64: 'AAAA' },
    ])

    const enrolment = await startMfaEnrolment(api)

    expect(calls[0]?.method).toBe('post')
    expect(calls[0]?.path).toBe(MFA_ENROLL_PATH)
    expect(MFA_ENROLL_PATH).toBe('/api/v1/auth/mfa/enroll')
    expect(enrolment.provisioning_uri).toBe('otpauth://totp/HasoubLabs:admin')
    expect(enrolment.qr_code_png_b64).toBe('AAAA')
  })
})

describe('the QR image source (AC4)', () => {
  it('renders the returned base64 as a PNG data URI', () => {
    expect(qrCodeImageSource('AAAA')).toBe('data:image/png;base64,AAAA')
    expect(qrCodeImageSource('  AAAA  ')).toBe('data:image/png;base64,AAAA')
  })

  it('refuses a value that is not base64, so nothing becomes a relative URL', () => {
    expect(qrCodeImageSource('/not/base64.png')).toBeNull()
    expect(qrCodeImageSource('AAA')).toBeNull()
    expect(qrCodeImageSource('')).toBeNull()
    expect(qrCodeImageSource(null)).toBeNull()
    expect(qrCodeImageSource(undefined)).toBeNull()
  })
})

describe('verifying a code (AC6)', () => {
  it('posts the account and the code to the verify endpoint', async () => {
    const { api, calls } = stubApi([{ verified: true }])

    await expect(verifyMfaCode(api, 'account-1', '123456')).resolves.toBe(true)

    expect(MFA_VERIFY_PATH).toBe('/api/v1/auth/mfa/verify')
    expect(calls[0]).toMatchObject({
      method: 'post',
      path: MFA_VERIFY_PATH,
      init: { body: { account_id: 'account-1', code: '123456' } },
    })
  })

  it('reports only a literal verified outcome as verified', () => {
    expect(isVerifiedOutcome({ verified: true })).toBe(true)
    expect(isVerifiedOutcome({ verified: false })).toBe(false)
    expect(isVerifiedOutcome({})).toBe(false)
    expect(isVerifiedOutcome(null)).toBe(false)
    expect(isVerifiedOutcome('verified')).toBe(false)
  })

  it('resolves false for a 200 that reports nothing verified', async () => {
    const { api } = stubApi([{}])
    await expect(verifyMfaCode(api, 'account-1', '123456')).resolves.toBe(false)
  })
})

describe('the enrolment indicator (AC7)', () => {
  it('reads the mfa_enrolled member of the own account row', async () => {
    const { api, calls } = stubApi([[account('other'), account('account-1', true)]])

    const own = await findOwnAccount(api, 'account-1')

    expect(own?.mfa_enrolled).toBe(true)
    expect(calls[0]?.path).toBe(ADMIN_ACCOUNTS_PATH)
    expect(calls[0]?.init).toMatchObject({ params: { query: { role: 'ADMIN', limit: 20 } } })
  })

  it('follows the keyset cursor until the row is found', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => account(`filler-${index}`))
    const { api, calls } = stubApi([firstPage, [account('account-1')]])

    const own = await findOwnAccount(api, 'account-1')

    expect(own?.id).toBe('account-1')
    expect(calls).toHaveLength(2)
    expect(calls[1]?.init).toMatchObject({
      params: { query: { after_id: 'filler-19' } },
    })
  })

  it('reports "not found" rather than "not enrolled" when the list ends', async () => {
    const { api, calls } = stubApi([[account('someone-else')]])
    await expect(findOwnAccount(api, 'account-1')).resolves.toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('issues nothing at all without an account identifier', async () => {
    const { api, calls } = stubApi([])
    await expect(findOwnAccount(api, '   ')).resolves.toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('stops at the page bound rather than walking a list that never ends', async () => {
    const fullPage = Array.from({ length: 20 }, (_, index) => account(`filler-${index}`))
    const { api, calls } = stubApi(Array.from({ length: 40 }, () => fullPage))

    await expect(findOwnAccount(api, 'account-1')).resolves.toBeNull()

    expect(calls).toHaveLength(OWN_ACCOUNT_MAX_PAGES)
  })

  it('keys the cached payload per account', () => {
    expect(ownAccountQueryKey('account-1')).not.toEqual(ownAccountQueryKey('account-2'))
  })
})
