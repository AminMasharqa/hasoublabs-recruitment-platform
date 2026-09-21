import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { BOUNDS, isHttpsUrl, isValidLinkedInUrl, validateLinkedInUrl } from './validators'

/**
 * Property 14 — LinkedIn URL validation.
 *
 * Cases are generated structurally: each arm builds a value whose shape already
 * determines whether it is a well-formed HTTPS URL, and carries that verdict as
 * `wellFormed`. Acceptance is then the conjunction of `wellFormed` with the
 * 200-code-point bound, which is the biconditional the requirement states.
 */
interface UrlCase {
  /** The candidate value handed to the Form_Validator. */
  readonly value: unknown
  /** Whether the value is, by construction, a well-formed absolute HTTPS URL. */
  readonly wellFormed: boolean
}

const MAX_LENGTH = BOUNDS.linkedinUrl.maxLength

/** Code-point length, counted here rather than borrowed from the unit under test. */
const codePoints = (value: string): number => [...value].length

/**
 * The acceptance rule, stated independently of the implementation: a value is
 * accepted exactly when it is a string of at most 200 code points that carries an
 * `https://` scheme, holds no literal whitespace or control character, and names a
 * non-empty host in its authority.
 *
 * Hosts are generated from the ASCII letter/digit/dot alphabet only, so deciding
 * "non-empty host" by splitting the authority agrees with a full URL parse over
 * the generated domain without re-using the parse itself.
 */
function oracleAccepts(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false
  }
  if (codePoints(value) > MAX_LENGTH) {
    return false
  }
  if (!/^https:\/\//i.test(value)) {
    return false
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007F]/.test(value)) {
    return false
  }
  // The URL Standard skips redundant slashes after a special scheme, so
  // `https:///host/p` names the host `host`.
  const afterScheme = value.slice('https://'.length).replace(/^[/\\]+/, '')
  const authority = afterScheme.split(/[/?#]/)[0]
  const afterUserinfo = authority.includes('@')
    ? authority.slice(authority.lastIndexOf('@') + 1)
    : authority
  const host = afterUserinfo.startsWith('[') ? afterUserinfo : afterUserinfo.split(':')[0]
  return host !== ''
}

// ── Building blocks for a well-formed URL ─────────────────────────────────────

const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')
const PATH_CHARS = [...ALNUM, '-', '_', '.', '~']

const word = (chars: readonly string[], maxLength: number): fc.Arbitrary<string> =>
  fc
    .array(fc.constantFrom(...chars), { minLength: 1, maxLength })
    .map((characters) => characters.join(''))

/** A dotted host whose last label is alphabetic, so it is never read as an IPv4 literal. */
const host: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(word(ALNUM, 10), { minLength: 1, maxLength: 3 }),
    fc.constantFrom('com', 'org', 'net', 'io', 'co.uk', 'linkedin.com'),
  )
  .map(([labels, tld]) => `${labels.join('.')}.${tld}`)

/** A path, which may be absent; LinkedIn profile paths look like `/in/handle`. */
const path: fc.Arbitrary<string> = fc.oneof(
  fc.constant(''),
  fc.constant('/'),
  word(PATH_CHARS, 12).map((segment) => `/in/${segment}`),
  fc
    .array(word(PATH_CHARS, 8), { minLength: 1, maxLength: 4 })
    .map((segments) => `/${segments.join('/')}`),
)

/** The scheme in the casings a pasted URL arrives in; the scheme is case-insensitive. */
const httpsScheme: fc.Arbitrary<string> = fc.constantFrom(
  'https://',
  'HTTPS://',
  'Https://',
  'hTTps://',
)

/** A well-formed absolute HTTPS URL, with optional userinfo, port, query and fragment. */
const httpsUrlText: fc.Arbitrary<string> = fc
  .tuple(
    httpsScheme,
    fc.constantFrom('', 'user@', 'user:pass@'),
    host,
    fc.constantFrom('', ':443', ':8443'),
    path,
    fc.constantFrom('', '?trk=public-profile', '?a=1&b=2'),
    fc.constantFrom('', '#top', '#section-1'),
  )
  .map(([scheme, userinfo, hostname, port, pathname, query, hash]) =>
    `${scheme}${userinfo}${hostname}${port}${pathname}${query}${hash}`,
  )

const wellFormedUrl: fc.Arbitrary<UrlCase> = httpsUrlText.map((value) => ({
  value,
  wellFormed: true,
}))

/**
 * A URL carrying redundant slashes after the scheme. The URL Standard skips them
 * for a special scheme, so `https:///www.linkedin.com/in/x` still names a host and
 * is well-formed.
 */
const redundantSlashes: fc.Arbitrary<UrlCase> = fc
  .tuple(httpsScheme, fc.constantFrom('/', '//', '///'), host, path)
  .map(([scheme, slashes, hostname, pathname]) => ({
    value: `${scheme}${slashes}${hostname}${pathname}`,
    wellFormed: true,
  }))

/**
 * A well-formed HTTPS URL of an exact code-point length, straddling the bound:
 * 199 and 200 must be accepted, 201 and beyond must not. The padding includes a
 * Hebrew letter and an astral emoji so the count is in code points rather than
 * UTF-16 code units.
 */
const atExactLength: fc.Arbitrary<UrlCase> = fc
  .tuple(fc.constantFrom(199, MAX_LENGTH, MAX_LENGTH + 1, 240, 512), fc.constantFrom('a', 'ז', '😀'))
  .map(([length, pad]) => {
    const base = 'https://www.linkedin.com/in/'
    const value = base + pad.repeat(length - codePoints(base))
    return { value, wellFormed: true }
  })

// ── Building blocks for a rejected value ──────────────────────────────────────

/** A scheme other than HTTPS, a half-written scheme, or no scheme at all. */
const otherSchemePrefix: fc.Arbitrary<string> = fc.constantFrom(
  'http://',
  'HTTP://',
  'ftp://',
  'ws://',
  'wss://',
  'file://',
  'httpx://',
  'javascript:',
  'data:text/plain,',
  'mailto:',
  'https:/',
  'https:',
  'https//',
  'httpshttps://',
  // Scheme-relative and relative references.
  '//',
  '/',
  './',
  '',
)

const wrongScheme: fc.Arbitrary<UrlCase> = fc
  .tuple(otherSchemePrefix, host, path)
  .map(([prefix, hostname, pathname]) => ({
    value: `${prefix}${hostname}${pathname}`,
    wellFormed: false,
  }))

/** Whitespace and control characters, none of which may appear literally in a URL. */
const forbiddenCharacter: fc.Arbitrary<string> = fc.constantFrom(
  ' ',
  '\t',
  '\n',
  '\r',
  '\f',
  '\v',
  '\u0000',
  '\u0001',
  '\u001F',
  '\u007F',
)

/** A URL that would be well-formed but for one embedded whitespace/control character. */
const withEmbeddedForbiddenCharacter: fc.Arbitrary<UrlCase> = fc
  .tuple(httpsUrlText, forbiddenCharacter, fc.nat())
  .map(([url, character, offset]) => {
    const characters = [...url]
    const at = offset % (characters.length + 1)
    return {
      value: `${characters.slice(0, at).join('')}${character}${characters.slice(at).join('')}`,
      wellFormed: false,
    }
  })

/** An HTTPS scheme with no host to authorize it. */
const emptyHost: fc.Arbitrary<UrlCase> = fc
  .constantFrom(
    'https://',
    'HTTPS://',
    'https:///',
    'https://////',
    'https://:443/in/handle',
    'https://?trk=x',
    'https://#top',
    'https://@',
    'https://user@',
    'https://user:pass@:8443/in/handle',
  )
  .map((value) => ({ value, wellFormed: false }))

/** Values that are not strings at all. */
const nonString: fc.Arbitrary<UrlCase> = fc
  .oneof(
    fc.constant<unknown>(null),
    fc.constant<unknown>(undefined),
    fc.integer(),
    fc.double({ noNaN: true }),
    fc.boolean(),
    fc.constant<unknown>({}),
    fc.constant<unknown>([]),
    fc.constant<unknown>(['https://www.linkedin.com/in/handle']),
    fc.constant<unknown>({ href: 'https://www.linkedin.com/in/handle' }),
  )
  .map((value) => ({ value, wellFormed: false }))

/**
 * Free-form text, including the empty string and whitespace runs. The guard drops
 * the vanishingly rare draw that happens to carry an HTTPS scheme, so every value
 * reaching the property is unambiguously not a URL.
 */
const junkText: fc.Arbitrary<UrlCase> = fc
  .oneof(
    fc.string(),
    fc.string({ unit: 'grapheme' }),
    fc.constantFrom(
      '',
      '   ',
      '\t\n',
      'www.linkedin.com/in/handle',
      'linkedin.com',
      'in/handle',
      'https',
      '://www.linkedin.com',
      ' https://www.linkedin.com/in/handle',
      'https://www.linkedin.com/in/handle ',
      'HTTPS : //www.linkedin.com',
    ),
  )
  .filter((value) => !/^https:\/\//i.test(value))
  .map((value) => ({ value, wellFormed: false }))

const urlCase: fc.Arbitrary<UrlCase> = fc.oneof(
  { weight: 4, arbitrary: wellFormedUrl },
  { weight: 1, arbitrary: redundantSlashes },
  { weight: 3, arbitrary: atExactLength },
  { weight: 3, arbitrary: wrongScheme },
  { weight: 3, arbitrary: withEmbeddedForbiddenCharacter },
  { weight: 2, arbitrary: emptyHost },
  { weight: 2, arbitrary: nonString },
  { weight: 2, arbitrary: junkText },
)

describe('LinkedIn URL validation properties', () => {
  // Feature: frontend-web-application, Property 14: LinkedIn URL validation —
  // For any candidate URL string, the Form_Validator accepts it if and only if it
  // is a well-formed HTTPS URL of at most 200 characters.
  //
  // **Validates: Requirements 22.5**
  it('accepts a candidate URL iff it is a well-formed HTTPS URL of at most 200 code points', () => {
    fc.assert(
      fc.property(urlCase, ({ value, wellFormed }) => {
        const length = typeof value === 'string' ? codePoints(value) : Number.NaN
        const withinBound = typeof value === 'string' && length <= MAX_LENGTH
        const expected = wellFormed && withinBound

        // The biconditional: acceptance is exactly well-formed HTTPS ∧ within bound.
        expect(isValidLinkedInUrl(value)).toBe(expected)
        // The same verdict from the independently stated rule.
        expect(oracleAccepts(value)).toBe(expected)
        // Well-formedness is the length-independent half of the conjunction.
        expect(isHttpsUrl(value)).toBe(wellFormed)

        // The field rule agrees, and an absent value stays allowed — the field is optional.
        const blank =
          value === null ||
          value === undefined ||
          (typeof value === 'string' && value.trim() === '')
        const issue = validateLinkedInUrl(value)
        if (expected || blank) {
          expect(issue).toBeNull()
        } else {
          expect(issue).not.toBeNull()
          expect(issue?.path).toBe('linkedin_url')
          expect(issue?.code).toBe('invalid_url')
          expect(issue?.params?.maxLength).toBe(MAX_LENGTH)
        }
      }),
      { numRuns: 500 },
    )
  })
})
