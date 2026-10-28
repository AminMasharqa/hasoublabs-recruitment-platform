/**
 * Profile completeness, and the one predicate the apply flow asks about
 * (Requirement 9 AC9, AC10, AC13).
 *
 * The Backend_Api owns the classification: the `state` member of the returned
 * profile is `Draft` or `Complete` and nothing here second-guesses it. What the
 * Backend_Api does *not* return alongside a profile is which fields are still
 * unmet — `GET`/`PUT /me/profile` carry `state` only — so AC9's "naming each field
 * required for Complete state that the returned profile does not satisfy" has to
 * be derived from the returned profile. {@link missingCompletenessFields} mirrors
 * the server's `CompletenessEvaluator` exactly: full name, email, phone and city
 * non-blank, plus at least one education entry and at least one skill.
 *
 * The mirror is checked rather than assumed: {@link isCompletenessConsistent}
 * states the agreement between the derived set and the reported `state`, and the
 * tests assert it over the profiles the requirement describes. When the two
 * disagree the *reported state* wins for every decision — the panel still names
 * what it derived, because naming nothing would be worse than naming a stale set.
 *
 * ## Why the apply predicate lives here and is exported
 *
 * AC13 disables every apply control while the profile is `Draft` and presents the
 * unmet conditions as the reason. Those controls are not on this screen — they are
 * on the job list, the job detail and the apply dialog (task 20.1) — so the rule
 * would be restated in three more places unless it is exported from one.
 * {@link applyEligibility} is that one place: it answers both halves of AC13, the
 * disabling and the reason, from the profile alone.
 *
 * Pure: no React, no i18n, no I/O. The field names are catalogue *keys*, resolved
 * by whoever renders them.
 */

import type { ProfileState } from '../../../api/enums'

import type { CandidateProfile } from './model'

/**
 * The fields the Backend_Api requires for `Complete`, in the order the panel
 * names them.
 *
 * These are the member names the server's evaluator reports, so a
 * `profile_validation_failed` envelope that names one lines up with what the panel
 * already said.
 */
export const COMPLETENESS_FIELDS = Object.freeze([
  'full_name',
  'email',
  'phone',
  'city',
  'education',
  'skills',
] as const)

/** One field required for `Complete` state. */
export type CompletenessField = (typeof COMPLETENESS_FIELDS)[number]

/** The state a profile the Backend_Api has never created is treated as. */
export const ABSENT_PROFILE_STATE: ProfileState = 'Draft'

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim() === ''
}

/**
 * The fields the returned profile does not satisfy (AC9).
 *
 * An absent profile is missing all of them, which is the honest answer for a
 * Candidate who has not started yet.
 */
export function missingCompletenessFields(
  profile: CandidateProfile | null | undefined,
): readonly CompletenessField[] {
  if (profile == null) {
    return COMPLETENESS_FIELDS
  }
  const missing: CompletenessField[] = []
  if (isBlank(profile.full_name)) {
    missing.push('full_name')
  }
  if (isBlank(profile.email)) {
    missing.push('email')
  }
  if (isBlank(profile.phone)) {
    missing.push('phone')
  }
  if (isBlank(profile.city)) {
    missing.push('city')
  }
  if (profile.education.length === 0) {
    missing.push('education')
  }
  if (profile.skills.length === 0) {
    missing.push('skills')
  }
  return missing
}

/** The `state` member of a profile, treating an absent profile as `Draft`. */
export function profileState(profile: CandidateProfile | null | undefined): ProfileState {
  return profile?.state ?? ABSENT_PROFILE_STATE
}

/** Whether the Backend_Api reported the profile as `Complete` (AC10). */
export function isProfileComplete(profile: CandidateProfile | null | undefined): boolean {
  return profileState(profile) === 'Complete'
}

/**
 * Whether the derived missing set agrees with the reported `state`.
 *
 * `Complete` iff nothing is missing. Used by the tests to hold the client-side
 * mirror to the server's evaluator; the screen never branches on it.
 */
export function isCompletenessConsistent(profile: CandidateProfile | null | undefined): boolean {
  return isProfileComplete(profile) === (missingCompletenessFields(profile).length === 0)
}

/** What the apply controls of Requirement 9 AC13 need to know. */
export interface ApplyEligibility {
  /** Whether apply controls may be enabled at all. */
  readonly allowed: boolean
  /** The reported profile state the decision was taken from. */
  readonly state: ProfileState
  /**
   * The unmet conditions to present as the reason (AC13). Empty when
   * {@link allowed} — and also empty on the rare disagreement where the
   * Backend_Api reports `Draft` while the returned profile satisfies every field,
   * in which case the caller renders the generic "not complete yet" reason.
   */
  readonly missingFields: readonly CompletenessField[]
}

/**
 * The apply decision for one profile (AC13).
 *
 * The *reported* state decides, not the derived set: the Backend_Api is
 * authoritative about readiness, and enabling an apply control against a locally
 * computed "looks complete to me" would send the Candidate into a submission the
 * server refuses.
 */
export function applyEligibility(profile: CandidateProfile | null | undefined): ApplyEligibility {
  const state = profileState(profile)
  const allowed = state === 'Complete'
  return {
    allowed,
    state,
    missingFields: allowed ? [] : missingCompletenessFields(profile),
  }
}

/**
 * Whether apply controls may be enabled (AC13).
 *
 * The single predicate the apply flow (task 20.1) binds its `disabled` to, so the
 * rule is stated once for the job list, the job detail and the apply dialog.
 */
export function isApplyEnabled(profile: CandidateProfile | null | undefined): boolean {
  return applyEligibility(profile).allowed
}
