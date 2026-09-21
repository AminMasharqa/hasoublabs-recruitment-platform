import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import arValidation from '../i18n/locales/ar/validation.json'
import enValidation from '../i18n/locales/en/validation.json'
import heValidation from '../i18n/locales/he/validation.json'
import { BOUNDS, countCodePoints, isAddrSpec, validateEmail } from './validators'

/**
 * Property 13 generators.
 *
 * Both sides are built structurally — the well-formed side composes the RFC 5322
 * addr-spec productions (dot-atom, quoted-string, domain-literal) and the
 * malformed side composes a named grammar defect on top of otherwise well-formed
 * parts. Nothing is produced by filtering against the unit under test, so the
 * oracle is the construction itself rather than a second implementation of the
 * same regular expression.
 *
 * Every malformed value carries at least one non-whitespace character by
 * construction, so none of them is a blank value that {@link validateEmail}
 * would treat as an absent optional field.
 */

/** The inclusive ASCII range `[from, to]` as single-character strings. */
function asciiRange(from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, index) => String.fromCharCode(from + index))
}

/** `atext`: ALPHA / DIGIT / the printable specials RFC 5322 permits unquoted. */
const ATEXT: readonly string[] = [
  ...asciiRange(0x41, 0x5a),
  ...asciiRange(0x61, 0x7a),
  ...asciiRange(0x30, 0x39),
  '!',
  '#',
  '$',
  '%',
  '&',
  "'",
  '*',
  '+',
  '-',
  '/',
  '=',
  '?',
  '^',
  '_',
  '`',
  '{',
  '|',
  '}',
  '~',
]

/** `qtext`: printable ASCII inside a quoted string, less DQUOTE and backslash. */
const QTEXT: readonly string[] = [
  String.fromCharCode(0x21),
  ...asciiRange(0x23, 0x5b),
  ...asciiRange(0x5d, 0x7e),
]

/** `dtext`: printable ASCII inside a domain literal, less `[`, `]` and backslash. */
const DTEXT: readonly string[] = [...asciiRange(0x21, 0x5a), ...asciiRange(0x5e, 0x7e)]

/** The character a quoted-pair may escape: any VCHAR, SP or HTAB. */
const QUOTED_PAIR_TARGETS: readonly string[] = [...asciiRange(0x21, 0x7e), ' ', '\t']

/** Folding whitespace, accepted inside a quoted string and a domain literal. */
const fws: fc.Arbitrary<string> = fc.constantFrom('', ' ', '\t', '  ', ' \t', '\t ')

/** One `atom`: a non-empty run of atext. */
const atom: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...ATEXT), { minLength: 1, maxLength: 8 })
  .map((characters) => characters.join(''))

/** `dot-atom`: atoms joined by single dots, with no leading, trailing or doubled dot. */
const dotAtom: fc.Arbitrary<string> = fc
  .array(atom, { minLength: 1, maxLength: 4 })
  .map((atoms) => atoms.join('.'))

/** `quoted-string`: DQUOTE *([FWS] qcontent) [FWS] DQUOTE, qcontent = qtext / quoted-pair. */
const quotedString: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(
      fc.tuple(
        fws,
        fc.oneof(
          fc.constantFrom(...QTEXT),
          fc.constantFrom(...QUOTED_PAIR_TARGETS).map((target) => `\\${target}`),
        ),
      ),
      { maxLength: 6 },
    ),
    fws,
  )
  .map(
    ([content, trailing]) =>
      `"${content.map(([space, character]) => `${space}${character}`).join('')}${trailing}"`,
  )

/** `domain-literal`: "[" *([FWS] dtext) [FWS] "]". */
const domainLiteral: fc.Arbitrary<string> = fc
  .tuple(fc.array(fc.tuple(fws, fc.constantFrom(...DTEXT)), { maxLength: 10 }), fws)
  .map(
    ([content, trailing]) =>
      `[${content.map(([space, character]) => `${space}${character}`).join('')}${trailing}]`,
  )

/** `local-part`: dot-atom / quoted-string. */
const localPart: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: dotAtom },
  { weight: 2, arbitrary: quotedString },
)

/** `domain`: dot-atom / domain-literal. */
const domain: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: dotAtom },
  { weight: 1, arbitrary: domainLiteral },
)

/** A well-formed addr-spec: `local-part "@" domain`. */
const addrSpec: fc.Arbitrary<string> = fc
  .tuple(localPart, domain)
  .map(([local, host]) => `${local}@${host}`)

/** Characters that may appear in neither an unquoted local part nor a dot-atom domain. */
const FORBIDDEN: readonly string[] = [
  '(',
  ')',
  ',',
  ':',
  ';',
  '<',
  '>',
  '[',
  ']',
  '\\',
  '"',
  '@',
  ' ',
  '\t',
  '\n',
  '\u0000',
  '\u00e9',
  '\u0627',
  '\u{1F600}',
]

/** A malformed value paired with the name of the grammar defect it carries. */
interface Malformed {
  readonly value: string
  readonly defect: string
}

const malformed = (defect: string) => (value: string) => ({ value, defect })

/** No `@` at all: a bare dot-atom is not an addr-spec. */
const noAt: fc.Arbitrary<Malformed> = fc
  .tuple(dotAtom, dotAtom)
  .map(([left, right]) => `${left}${right}`)
  .map(malformed('no @'))

/** An empty local part, an empty domain, or both. */
const emptyPart: fc.Arbitrary<Malformed> = fc.oneof(
  domain.map((host) => `@${host}`).map(malformed('empty local part')),
  localPart.map((local) => `${local}@`).map(malformed('empty domain')),
  fc.constant('@').map(malformed('both parts empty')),
)

/** A leading, trailing or doubled dot on either side of the `@`. */
const dotDefect: fc.Arbitrary<Malformed> = fc
  .tuple(dotAtom, dotAtom, dotAtom, fc.constantFrom('leading', 'trailing', 'doubled'))
  .chain(([local, host, extra, kind]) => {
    const breakDot = (value: string): string =>
      kind === 'leading' ? `.${value}` : kind === 'trailing' ? `${value}.` : `${value}..${extra}`
    return fc.constantFrom(
      { value: `${breakDot(local)}@${host}`, defect: `${kind} dot in local part` },
      { value: `${local}@${breakDot(host)}`, defect: `${kind} dot in domain` },
    )
  })

/** A literal space or tab outside any quoted string or domain literal. */
const unquotedSpace: fc.Arbitrary<Malformed> = fc
  .tuple(dotAtom, dotAtom, dotAtom, fc.constantFrom(' ', '\t'))
  .chain(([local, host, extra, space]) =>
    fc.constantFrom(
      { value: `${local}${space}${extra}@${host}`, defect: 'space inside local part' },
      { value: `${local}@${host}${space}${extra}`, defect: 'space inside domain' },
      { value: `${space}${local}@${host}`, defect: 'leading space' },
      { value: `${local}@${host}${space}`, defect: 'trailing space' },
    ),
  )

/** An unterminated quoted string, or a stray DQUOTE where atext is required. */
const unclosedQuote: fc.Arbitrary<Malformed> = fc
  .tuple(dotAtom, dotAtom)
  .chain(([local, host]) =>
    fc.constantFrom(
      { value: `"${local}@${host}`, defect: 'unclosed opening quote' },
      { value: `${local}"@${host}`, defect: 'unopened closing quote' },
      { value: `"${local}"${local}@${host}`, defect: 'atext after a quoted string' },
    ),
  )

/** An unterminated domain literal, or a stray bracket where atext is required. */
const unclosedBracket: fc.Arbitrary<Malformed> = fc
  .tuple(dotAtom, dotAtom, fc.array(fc.constantFrom(...DTEXT), { maxLength: 8 }))
  .chain(([local, host, inner]) =>
    fc.constantFrom(
      { value: `${local}@[${inner.join('')}`, defect: 'unclosed domain literal' },
      { value: `${local}@${host}]`, defect: 'unopened domain literal' },
      { value: `${local}@[${inner.join('')}]${host}`, defect: 'atext after a domain literal' },
    ),
  )

/**
 * A character the grammar forbids, spliced between two atoms so the affected
 * part can be read neither as a dot-atom nor as a quoted string or literal.
 */
const forbiddenCharacter: fc.Arbitrary<Malformed> = fc
  .tuple(atom, atom, dotAtom, fc.constantFrom(...FORBIDDEN))
  .chain(([left, right, other, character]) =>
    fc.constantFrom(
      {
        value: `${left}${character}${right}@${other}`,
        defect: `forbidden character in local part`,
      },
      {
        value: `${other}@${left}${character}${right}`,
        defect: `forbidden character in domain`,
      },
    ),
  )

/** More than one unquoted `@`, which leaves no single local-part/domain split. */
const multipleAt: fc.Arbitrary<Malformed> = fc
  .tuple(dotAtom, dotAtom, dotAtom)
  .map(([local, host, extra]) => `${local}@${host}@${extra}`)
  .map(malformed('multiple unquoted @'))

/** A value that is definitively not a well-formed addr-spec. */
const nonAddrSpec: fc.Arbitrary<Malformed> = fc.oneof(
  noAt,
  emptyPart,
  dotDefect,
  unquotedSpace,
  unclosedQuote,
  unclosedBracket,
  forbiddenCharacter,
  multipleAt,
)

/** The field path the caller hands the rule; the issue must echo it back. */
const fieldPath: fc.Arbitrary<string> = fc.constantFrom(
  'email',
  'contact_email',
  'applicants.3.email',
)

/** The three shipped catalogues, so the rejection message is checked as localized. */
const CATALOGUES: readonly Readonly<Record<string, string>>[] = [
  enValidation,
  arValidation,
  heValidation,
]

describe('email addr-spec validation properties', () => {
  // Feature: frontend-web-application, Property 13: Email validation accepts
  // exactly well-formed addr-specs — For any generated RFC 5322 addr-spec, the
  // Form_Validator accepts the address, and for any generated string that is
  // not a well-formed addr-spec, it rejects the address with a localized
  // field-level message.
  //
  // **Validates: Requirements 22.4**
  it('accepts every generated addr-spec and rejects every generated non-addr-spec', () => {
    fc.assert(
      fc.property(addrSpec, nonAddrSpec, fieldPath, (wellFormed, { value, defect }, path) => {
        // Acceptance side: every composed addr-spec is accepted.
        expect(isAddrSpec(wellFormed)).toBe(true)
        // The field rule adds only the declared length bound on top.
        const accepted = validateEmail(wellFormed, { path, required: true })
        if (countCodePoints(wellFormed) <= BOUNDS.email.maxLength) {
          expect(accepted).toBeNull()
        } else {
          expect(accepted?.code).toBe('too_long')
        }

        // Rejection side: every composed defect is rejected, with the reason
        // named so a counterexample identifies which production failed.
        expect(isAddrSpec(value), `expected rejection (${defect}): ${JSON.stringify(value)}`).toBe(
          false,
        )
        const rejected = validateEmail(value, { path })
        expect(rejected).not.toBeNull()
        expect(rejected?.path).toBe(path)
        expect(rejected?.code).toBe('malformed_email')
        // Field-level and localized: the issue carries a catalogue key, not a
        // literal, and that key resolves in every shipped Locale.
        expect(rejected?.messageKey).toBe('validation.emailMalformed')
        for (const catalogue of CATALOGUES) {
          expect(catalogue['emailMalformed']).toBeTypeOf('string')
        }
      }),
      { numRuns: 500 },
    )
  })
})
