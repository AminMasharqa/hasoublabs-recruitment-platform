/**
 * The apply gate: Requirement 9 AC13 as the controls it governs see it.
 *
 * AC13 disables **every** apply control while the Candidate's profile is `Draft`
 * and presents the unmet conditions as the reason. The profile screen states the
 * consequence where it is caused (`ApplyBlockedNotice`), but the controls
 * themselves are on the job list and the job detail — and later on the apply
 * dialog (task 20.1) — none of which owns the profile.
 *
 * So the rule travels as context rather than as a second copy of itself. This
 * module holds the context, the shape it carries and the hook that reads it;
 * `ApplyGateProvider.tsx` beside it holds the provider that fills it in, which is
 * the same split as `sessionState.ts` / `SessionContext.tsx`. The verdict itself is
 * `completeness.ts`'s `applyEligibility` — the function the profile screen already
 * renders from — so the two surfaces cannot disagree about whether a Candidate may
 * apply.
 *
 * Requirements: 9.13.
 */

import { createContext, useContext } from 'react'

import type { CompletenessField } from './completeness'

/** What an apply control needs to know about profile readiness (AC13). */
export interface ApplyGate {
  /** Whether apply controls must be disabled. */
  readonly blocked: boolean
  /**
   * The unmet conditions to present as the reason, empty when the gate is open —
   * and also empty while the profile is not yet known.
   */
  readonly missingFields: readonly CompletenessField[]
}

/** The gate of a context this requirement does not govern: open, with no reason. */
export const UNGATED_APPLY: ApplyGate = Object.freeze({ blocked: false, missingFields: [] })

/**
 * The gate while the profile is still unknown: closed, with no named condition.
 *
 * Closed rather than open because offering an apply the Backend_Api would refuse
 * for an incomplete profile is worse than briefly withholding one, and the reason
 * falls back to the generic "your profile is a draft" text rather than naming
 * conditions nobody has checked yet.
 */
export const UNKNOWN_PROFILE_GATE: ApplyGate = Object.freeze({
  blocked: true,
  missingFields: [],
})

/**
 * The apply gate context.
 *
 * `null` outside a `CandidateApplyGateProvider`, which {@link useApplyGate} reads
 * as "no gate" rather than as an error: a control rendered in isolation — in a
 * component test, or on a surface the provider does not cover — is governed by its
 * own requirement, not by this one.
 */
export const ApplyGateContext = createContext<ApplyGate | null>(null)

/**
 * The apply gate for the active session (AC13).
 *
 * Bind an apply control's `disabled` to `blocked`, and present the reason from
 * `missingFields`.
 */
export function useApplyGate(): ApplyGate {
  return useContext(ApplyGateContext) ?? UNGATED_APPLY
}
