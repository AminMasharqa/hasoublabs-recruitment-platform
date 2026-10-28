/**
 * What the Status_Notice presents for one retained Account_Status — pure, no
 * React, no i18next instance, no router (Requirement 7 AC3, AC4, AC5).
 *
 * Requirement 7 describes the screen as a function of the retained `status`
 * member alone:
 *
 * | retained status | description | next step | verification control | other action |
 * | --- | --- | --- | --- | --- |
 * | `PendingVerification` | yes (AC3) | yes (AC3) | yes (AC4) | none |
 * | `PendingApproval`, `ApprovedPendingMeeting` | yes (AC3) | yes (AC3) | no | none |
 * | `Approved` | yes (AC3) | yes (AC3) | no | none |
 * | `Suspended`, `Rejected`, `Deactivated` | yes (AC3) | yes (AC3) | no | none (AC5) |
 *
 * That function lives here so it can be read and tested without rendering
 * anything, and so the screen is left with nothing to decide.
 *
 * ## Why a "terminal" flag when no status offers an action anyway
 *
 * AC5 is a prohibition — `Suspended`, `Rejected` and `Deactivated` get the
 * Status_Notice and the logout control and *no other action* — and a prohibition
 * that is satisfied by accident is one a later change silently breaks. Naming the
 * three statuses makes the rule assertable ({@link isTerminalStatus}) and gives
 * the screen a place to say so to the user, so adding an affordance for, say,
 * `PendingApproval` cannot leak into the suspended surface.
 *
 * `AccountStatus` comes from `src/api/enums.ts`, i.e. from the generated contract:
 * a status the Backend_Api renames or adds fails the typecheck of
 * {@link STATUS_NOTICE_STATUS_KEYS} here rather than rendering a raw enum member
 * to the user.
 *
 * Requirements: 7.3, 7.4, 7.5.
 */

import type { AccountStatus } from '../../api/enums'

/** The catalogue namespace this slice resolves its strings against (Req 19 AC2). */
export const ONBOARDING_NAMESPACE = 'onboarding'

/**
 * The statuses that close the account down: the Status_Notice and the logout
 * control, and nothing else (AC5).
 */
export const TERMINAL_STATUSES: readonly AccountStatus[] = Object.freeze([
  'Rejected',
  'Suspended',
  'Deactivated',
])

/** The one status that offers the Verification_Code entry screen (AC4). */
export const VERIFICATION_STATUS: AccountStatus = 'PendingVerification'

/** Whether the account is closed down, so the notice offers no action (AC5). */
export function isTerminalStatus(status: AccountStatus | null | undefined): boolean {
  return status != null && TERMINAL_STATUSES.includes(status)
}

/**
 * Whether the notice presents the control that navigates to the
 * Verification_Code entry screen (AC4).
 *
 * `PendingVerification` and nothing else: a suspended account also has an
 * unverified-looking history, and offering it a code entry would be an action AC5
 * forbids.
 */
export function offersVerification(status: AccountStatus | null | undefined): boolean {
  return status === VERIFICATION_STATUS
}

/**
 * The catalogue sub-key each status is described under.
 *
 * The enum member doubles as the key, so the three catalogues carry one entry per
 * contract status and `index.test.ts` fails the build when a locale is missing
 * one. Declared as an exhaustive record rather than derived by string
 * concatenation so that a contract status with no key is a typecheck failure.
 */
export const STATUS_NOTICE_STATUS_KEYS: Readonly<Record<AccountStatus, AccountStatus>> =
  Object.freeze({
    PendingVerification: 'PendingVerification',
    PendingApproval: 'PendingApproval',
    ApprovedPendingMeeting: 'ApprovedPendingMeeting',
    Approved: 'Approved',
    Rejected: 'Rejected',
    Suspended: 'Suspended',
    Deactivated: 'Deactivated',
  })

/** The catalogue keys one status resolves its text through. */
export interface StatusNoticeKeys {
  /** Short localized name of the status (AC3). */
  readonly statusKey: string
  /** Localized description of the status (AC3). */
  readonly descriptionKey: string
  /**
   * Localized next step for the status (AC3).
   *
   * The Backend_Api's own `next_step` member is a prose sentence in one language,
   * so it decides *whether* a next step is shown, not what it reads: the screen
   * renders the entry under this key, in the active Locale, and falls back to the
   * retained value only when no entry exists.
   */
  readonly nextStepKey: string
}

/** The catalogue keys for one retained Account_Status (AC3). */
export function statusNoticeKeys(status: AccountStatus): StatusNoticeKeys {
  const member = STATUS_NOTICE_STATUS_KEYS[status] ?? status
  return {
    statusKey: `${ONBOARDING_NAMESPACE}:status.${member}`,
    descriptionKey: `${ONBOARDING_NAMESPACE}:description.${member}`,
    nextStepKey: `${ONBOARDING_NAMESPACE}:nextStep.${member}`,
  }
}

/** Everything the Status_Notice presents for one retained Account_Status. */
export interface StatusNoticeSurface extends StatusNoticeKeys {
  /** The retained status this surface describes. */
  readonly status: AccountStatus
  /** Whether the Verification_Code entry control is presented (AC4). */
  readonly verification: boolean
  /** Whether the account is closed down, so no action is presented (AC5). */
  readonly terminal: boolean
}

/**
 * Derives the whole surface from the retained status (AC3, AC4, AC5).
 *
 * The single entry point the screen calls, so the screen holds no status
 * comparison of its own.
 */
export function statusNoticeSurface(status: AccountStatus): StatusNoticeSurface {
  return {
    status,
    ...statusNoticeKeys(status),
    verification: offersVerification(status),
    terminal: isTerminalStatus(status),
  }
}
