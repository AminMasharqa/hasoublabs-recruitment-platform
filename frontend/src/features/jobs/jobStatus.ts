/**
 * What a Job_Description's `status` means for the apply control
 * (Requirement 12 AC7).
 *
 * Pure, and deliberately its own module: the list entry and the detail view both
 * have to reach the same verdict, and AC7 requires them to — a closed indicator
 * and a disabled apply control "in both the list entry and the detail view". Two
 * independent conditions could drift; one function cannot.
 *
 * `Open` is the only status that admits an application. `Closed` is the one AC7
 * names, and `Draft` is refused for the same reason the Backend_Api refuses it: an
 * unpublished Job_Description is not on offer yet. The reason is carried alongside
 * the verdict so the surface can say *why* the control is disabled rather than
 * leaving a dead button unexplained (Requirement 20 AC8).
 *
 * Requirements: 12.7.
 */

import type { JdStatus } from '../../api/enums'

/** Why an apply control is disabled, or `null` when it is enabled. */
export type ApplyBlockReason = 'closed' | 'draft'

/** The verdict on one Job_Description's apply control. */
export interface ApplyAvailability {
  readonly enabled: boolean
  /** The localizable reason, or `null` when the control is enabled. */
  readonly reason: ApplyBlockReason | null
}

/** Whether a status is the `Closed` one the closed indicator marks (AC7). */
export function isClosed(status: JdStatus | null | undefined): boolean {
  return status === 'Closed'
}

/**
 * Whether the apply control is enabled for a status, and why not when it is not
 * (AC7).
 *
 * An unrecognized status — a value a future contract adds — is treated as not
 * applicable rather than as applicable, so a new lifecycle state cannot silently
 * open applications the Backend_Api would refuse.
 */
export function applyAvailability(status: JdStatus | null | undefined): ApplyAvailability {
  if (status === 'Open') {
    return { enabled: true, reason: null }
  }
  return { enabled: false, reason: isClosed(status) ? 'closed' : 'draft' }
}
