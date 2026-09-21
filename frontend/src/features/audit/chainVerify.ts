/**
 * The verdict of an Audit_Log chain verification (Requirement 17 AC6, AC7).
 *
 * Pure: no React. `GET /admin/audit/chain/verify` answers with four members —
 * `ok`, `first_bad_id`, `checked_from_id` and `max_id` — and AC6 requires all four
 * to be rendered while AC7 requires an `ok` of false to raise a tampering alert
 * that names `first_bad_id`. {@link chainVerdict} is the one place that decides
 * which of the two the screen is looking at, so the alert cannot be attached to an
 * intact chain by a mis-read condition in a component.
 *
 * ## Why `ok` is compared to `false` rather than tested for truthiness
 *
 * A tampering alert is the most consequential thing this screen renders, and the
 * contract declares `ok` as a boolean. Anything that is not the boolean `true` is
 * therefore treated as a chain that did not verify: a response missing the member,
 * or carrying something other than a boolean in it, is a response that has not
 * told us the chain is intact, and silently reading that as "fine" is the one
 * failure mode this surface must not have.
 *
 * ## Why a missing `first_bad_id` is modelled explicitly
 *
 * The contract declares `first_bad_id` as nullable, so a chain reported as broken
 * without an identifier is possible. The verdict carries `firstBadId: null` for
 * that case and the screen says the entry could not be identified, rather than
 * rendering an alert with a blank where the identifier should be — which reads as
 * a rendering defect precisely when the reader most needs to trust the screen.
 *
 * Requirements: 17.6, 17.7.
 */

/** The four members `GET /admin/audit/chain/verify` answers with (AC6). */
export interface ChainVerifyReportLike {
  readonly ok?: boolean | null
  readonly first_bad_id?: number | null
  readonly checked_from_id?: number | null
  readonly max_id?: number | null
}

/**
 * The verdict of one verification.
 *
 * A union, so a caller cannot reach for `firstBadId` on an intact chain: the
 * tampering alert of AC7 exists only on the branch that has one.
 */
export type ChainVerdict =
  | { readonly tampered: false }
  | { readonly tampered: true; readonly firstBadId: number | null }

/** An intact chain: no alert (AC6). */
export const CHAIN_INTACT: ChainVerdict = Object.freeze({ tampered: false })

function identifier(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * The verdict of a chain verification response (AC6, AC7).
 *
 * An absent response — the verification has not been asked for yet, or it failed —
 * is not a verdict at all and yields `null`; the screen renders the Error_Presenter
 * for a failure and nothing for a verification never requested, rather than an
 * alert about a chain nobody checked.
 */
export function chainVerdict(
  report: ChainVerifyReportLike | null | undefined,
): ChainVerdict | null {
  if (report == null) {
    return null
  }
  if (report.ok === true) {
    return CHAIN_INTACT
  }
  return { tampered: true, firstBadId: identifier(report.first_bad_id) }
}

/**
 * The `ok` member as the contract spells it, for verbatim rendering (AC6).
 *
 * AC6 asks for the returned `ok` member to be *rendered*, and the honest rendering
 * of a contract boolean is the boolean: `true` or `false`, the same two words a
 * reader would see in the response body they might be comparing this screen
 * against. It is deliberately not a catalogue entry — translating a machine value
 * would make the screen and the API disagree about what was returned — so it is
 * produced here, from the data, rather than as a literal inside a component.
 *
 * The plain-language verdict beside it *is* localized: that is what
 * {@link chainVerdict} and the alert of AC7 are for.
 */
export function chainOkValue(report: ChainVerifyReportLike | null | undefined): string {
  return report?.ok === true ? 'true' : 'false'
}

/** The identifier range a verification walked (AC6), for rendering. */
export interface ChainRange {
  readonly checkedFromId: number | null
  readonly maxId: number | null
}

/** The `checked_from_id` and `max_id` members of a response (AC6). */
export function chainRange(report: ChainVerifyReportLike | null | undefined): ChainRange {
  return {
    checkedFromId: identifier(report?.checked_from_id),
    maxId: identifier(report?.max_id),
  }
}
