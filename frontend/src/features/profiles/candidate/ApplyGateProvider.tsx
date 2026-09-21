/**
 * The provider that fills in the apply gate (Requirement 9 AC13).
 *
 * The gate itself — the context, its shape and the hook — is `applyGate.ts`; this
 * file exports the component only, so a fast-refresh edit to it does not reset the
 * module that every apply control imports.
 *
 * ## Why the provider, not the control, owns the read
 *
 * A list page renders up to twenty apply controls. Each one asking for the profile
 * would still be one cache entry and one request under TanStack Query, but it would
 * also mean twenty components that must remember to ask. One provider above the
 * router makes the gate a property of the session, which is what AC13 describes.
 *
 * ## Contexts other than `CANDIDATE`
 *
 * AC13 is scoped to `WHILE the Active_Context is CANDIDATE`, and `GET /me/profile`
 * is a Candidate-context read. In a Senior or Admin context the gate is therefore
 * open and no request is issued; whether those contexts offer an apply control at
 * all is Requirement 12's and Requirement 14's business.
 *
 * ## An unknown profile blocks
 *
 * While the read is in flight, and if it fails, the gate stays closed
 * (`UNKNOWN_PROFILE_GATE`). An absent profile — a 404 — *is* a Draft as far as
 * readiness goes, and `applyEligibility` treats it as one.
 *
 * Requirements: 9.13.
 */

import { useMemo, type ReactNode } from 'react'

import { useSession } from '../../../session/sessionState'

import { ApplyGateContext, UNGATED_APPLY, UNKNOWN_PROFILE_GATE, type ApplyGate } from './applyGate'
import { applyEligibility } from './completeness'
import { useMyProfileQuery } from './profileQueries'

export interface CandidateApplyGateProviderProps {
  readonly children?: ReactNode
}

/**
 * Publishes the apply gate to the tree (AC13).
 *
 * Mounted by the shell above the router, so every apply control on every screen is
 * governed by one reading of the profile.
 */
export function CandidateApplyGateProvider({ children }: CandidateApplyGateProviderProps) {
  const { act } = useSession()
  const isCandidateContext = act === 'CANDIDATE'
  const profile = useMyProfileQuery({ enabled: isCandidateContext })

  const gate = useMemo<ApplyGate>(() => {
    if (!isCandidateContext) {
      return UNGATED_APPLY
    }
    if (profile.isPending) {
      return UNKNOWN_PROFILE_GATE
    }
    const eligibility = applyEligibility(profile.data ?? null)
    return eligibility.allowed
      ? UNGATED_APPLY
      : { blocked: true, missingFields: eligibility.missingFields }
  }, [isCandidateContext, profile.isPending, profile.data])

  return <ApplyGateContext.Provider value={gate}>{children}</ApplyGateContext.Provider>
}
