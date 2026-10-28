/**
 * Carrying the new account identifier from a successful registration to the
 * Verification_Code entry screen (Requirement 6 AC8, AC9).
 *
 * A 201 returns the created `AccountDTO`; AC8 asks the Web_Client to retain its
 * identifier and navigate to the verification screen, and AC9 has that screen
 * submit the retained identifier together with the collected code. So the
 * identifier has to survive exactly one navigation, and nothing more.
 *
 * ## Why router state, and not storage or a query parameter
 *
 * - **Not a query parameter.** It would put an account identifier in the address
 *   bar, in the browser history entry's URL and in any `Referer` the browser
 *   sends onward. A newly created account's identifier is not a secret, but it is
 *   not something to publish either, and a link with someone else's identifier
 *   pasted in is a screen asking to submit codes against a stranger's account.
 * - **Not `sessionStorage`.** Nothing else in this application persists anything
 *   outside memory (the Session_Manager deliberately keeps even tokens in
 *   memory), and a stale identifier surviving a reload would leave the
 *   verification screen posting against an account the user no longer remembers
 *   registering.
 * - **Router state** is in-memory, travels with the one navigation, survives the
 *   verification screen's own re-renders, and is discarded when the browsing
 *   context is. A reload loses it, which is correct: the verification screen then
 *   has no retained identifier and must ask the user to follow their emailed link
 *   again rather than guess.
 *
 * Both halves live here so the producing screen (task 15.1) and the consuming one
 * (task 15.2) agree on the shape by construction, and the reader validates rather
 * than trusts — router state is attacker-authorable in the sense that any code can
 * navigate with any state.
 */

import type { components } from '../../api/generated/schema'

/** The account a registration created, as the contract declares it. */
export type RegisteredAccount = components['schemas']['AccountDTO']

/** What the verification screen needs from the registration that preceded it. */
export interface RegistrationHandoff {
  /** `AccountDTO.id` of the account just created (AC8). */
  readonly accountId: string
}

/** The `Location.state` the registration screen navigates with. */
export interface VerificationHandoffState {
  readonly registration: RegistrationHandoff
}

/** Builds the navigation state carrying the new account identifier (AC8). */
export function verificationHandoffState(account: RegisteredAccount): VerificationHandoffState {
  return { registration: { accountId: account.id } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * The retained identifier a navigation carried, or `null` when it carried none
 * usable (AC9).
 *
 * Validated rather than trusted: any non-blank string identifier is accepted (the
 * Backend_Api is the authority on whether it names an account), and everything
 * else — absent state, wrong shape, blank value — reports absence so the
 * verification screen renders its own "no account to verify" path instead of
 * posting a malformed body.
 */
export function registrationHandoffFrom(state: unknown): RegistrationHandoff | null {
  if (!isRecord(state) || !isRecord(state.registration)) {
    return null
  }
  const accountId = state.registration.accountId
  if (typeof accountId !== 'string' || accountId.trim() === '') {
    return null
  }
  return { accountId }
}
