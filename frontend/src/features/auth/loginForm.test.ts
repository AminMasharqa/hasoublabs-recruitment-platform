/**
 * The login form's pure half: the values, the rendered inputs, the client-side
 * rules and the catalogue key each reported issue resolves to (Requirement 4 AC1,
 * Requirement 22 AC9–AC12).
 *
 * Asserted without rendering, which is the reason this logic sits outside
 * `LoginScreen.tsx` at all. Message resolution is asserted against a *real*
 * i18next instance rather than a stub translate function, because the fallback
 * path for an unknown Field_Violation `code` depends on i18next's own
 * missing-key behaviour — `parseMissingKeyHandler` echoes the key — and a stub
 * that returned something else would assert a lookup that cannot happen.
 */

import { describe, expect, it } from 'vitest'

import { UNKNOWN_VIOLATION_CODE } from '../../api/errors'
import { createI18n } from '../../i18n'

import {
  EMPTY_LOGIN_VALUES,
  fieldViolationCatalogueKey,
  issueMessage,
  LOGIN_INPUT_ID_PREFIX,
  LOGIN_INPUTS,
  LOGIN_ROLES,
  loginRole,
  validateLoginValues,
  validationCatalogueKey,
  type LoginFormValues,
  type Translate,
} from './loginForm'

/** A form filled in well enough to pass every client-side bound. */
function filled(overrides: Partial<LoginFormValues> = {}): LoginFormValues {
  return {
    email: 'person@example.com',
    password: 'correct horse battery',
    role: 'CANDIDATE',
    ...overrides,
  }
}

/** The codes reported for a submission, by the input each addresses. */
function codesByPath(values: LoginFormValues): Record<string, string> {
  return Object.fromEntries(validateLoginValues(values).map((issue) => [issue.path, issue.code]))
}

// ── Values and inputs (AC1) ───────────────────────────────────────────────────

describe('the collected values (AC1)', () => {
  it('holds exactly the email address, the password and the role', () => {
    expect(Object.keys(EMPTY_LOGIN_VALUES).sort()).toEqual(['email', 'password', 'role'])
    expect(EMPTY_LOGIN_VALUES).toEqual({ email: '', password: '', role: '' })
  })

  it('offers ADMIN, CANDIDATE and SENIOR in the contract order', () => {
    expect(LOGIN_ROLES).toEqual(['ADMIN', 'CANDIDATE', 'SENIOR'])
  })

  it('narrows a selected role, and reports anything else as absent', () => {
    expect(loginRole(filled({ role: 'ADMIN' }))).toBe('ADMIN')
    expect(loginRole(filled({ role: 'SENIOR' }))).toBe('SENIOR')
    expect(loginRole(EMPTY_LOGIN_VALUES)).toBeNull()
    expect(loginRole(filled({ role: 'candidate' }))).toBeNull()
    expect(loginRole(filled({ role: 'SUPERUSER' }))).toBeNull()
  })
})

describe('the rendered inputs (Req 22 AC9, Req 20 AC6)', () => {
  it('addresses each input by its LoginRequest member name', () => {
    expect(LOGIN_INPUTS.map((input) => input.path)).toEqual(['email', 'password', 'role'])
  })

  it('gives each input a distinct prefixed DOM id', () => {
    const ids = LOGIN_INPUTS.map((input) => input.id)
    expect(ids).toEqual(['login-email', 'login-password', 'login-role'])
    expect(new Set(ids).size).toBe(ids.length)
    // Declared rather than derived, so the ids cannot collide with another
    // screen's inputs mounted in the same document.
    for (const input of LOGIN_INPUTS) {
      expect(input.id).toMatch(new RegExp(`^${LOGIN_INPUT_ID_PREFIX}`))
    }
  })
})

// ── Client-side rules (Req 22 AC1, AC12) ──────────────────────────────────────

describe('the client-side rules', () => {
  it('accepts a well-formed submission', () => {
    expect(validateLoginValues(filled())).toEqual([])
  })

  it('reports every unmet rule at once rather than the first', () => {
    expect(codesByPath(EMPTY_LOGIN_VALUES)).toEqual({
      email: 'required',
      password: 'required',
      role: 'required',
    })
  })

  it('reports a malformed address and an undeclared role by their own codes', () => {
    expect(codesByPath(filled({ email: 'not-an-address', role: 'SUPERUSER' }))).toEqual({
      email: 'malformed_email',
      role: 'invalid_enum',
    })
  })

  it('accepts a one-character password, as the LoginRequest bound allows', () => {
    // The Backend_Api declares `min_length=1` on login so an account created
    // under an earlier password policy can still authenticate; applying the
    // registration bound here would lock those accounts out client-side.
    expect(validateLoginValues(filled({ password: 'x' }))).toEqual([])
  })
})

// ── Message resolution (Req 19 AC2, Req 22 AC9) ───────────────────────────────

describe('resolving the message of a reported issue', () => {
  const instance = createI18n('en')
  const translate: Translate = (key, values) => instance.t(key, { ...values }) as unknown as string

  it('promotes the first segment of a Form_Validator key to its namespace', () => {
    expect(validationCatalogueKey('validation.required')).toBe('validation:required')
    expect(validationCatalogueKey('validation.tooLong')).toBe('validation:tooLong')
  })

  it('leaves an already-namespaced key and a key with no separator untouched', () => {
    expect(validationCatalogueKey('errors:field.invalid')).toBe('errors:field.invalid')
    expect(validationCatalogueKey('required')).toBe('required')
  })

  it('looks a Field_Violation code up under the errors namespace', () => {
    expect(fieldViolationCatalogueKey('invalid_email')).toBe('errors:field.invalid_email')
  })

  it('falls back to the unknown-violation entry for an absent or unsafe code', () => {
    const fallback = `errors:field.${UNKNOWN_VIOLATION_CODE}`
    expect(fieldViolationCatalogueKey(null)).toBe(fallback)
    expect(fieldViolationCatalogueKey(undefined)).toBe(fallback)
    expect(fieldViolationCatalogueKey('  ')).toBe(fallback)
    // A code carrying separators would escape `field.<code>` into another part of
    // the catalogue, so it is not looked up at all.
    expect(fieldViolationCatalogueKey('field.invalid')).toBe(fallback)
    expect(fieldViolationCatalogueKey('a:b')).toBe(fallback)
  })

  it('resolves a client-side issue through its own key and bounds', () => {
    expect(issueMessage(translate, { path: 'email', messageKey: 'validation.required' })).toBe(
      'This field is required.',
    )
    expect(
      issueMessage(translate, {
        path: 'password',
        messageKey: 'validation.tooLong',
        params: { maxLength: 128, actual: 200 },
      }),
    ).toBe('Enter at most 128 characters (currently 200).')
  })

  it('resolves a server violation through its code', () => {
    expect(issueMessage(translate, { path: 'email', code: 'invalid_email' })).toBe(
      'Enter a valid email address.',
    )
  })

  it('renders the generic field entry for a code the catalogue does not know', () => {
    const generic = translate(`errors:field.${UNKNOWN_VIOLATION_CODE}`)
    const message = issueMessage(translate, { path: 'email', code: 'something_never_seen' })

    expect(message).toBe(generic)
    // Never the raw key: an echoed lookup is not a user-visible message.
    expect(message).not.toContain('errors:')
  })
})
