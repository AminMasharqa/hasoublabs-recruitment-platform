/**
 * Public surface of the profile slices.
 *
 * The shell registers the screens (`shell/screenElements.tsx`) and the job
 * screens read the apply predicate — nothing else outside this folder needs the
 * internals, so only those are re-exported.
 *
 * `applyEligibility`/`isApplyEnabled` are exported for Requirement 9 AC13: the
 * apply controls live on the job list, the job detail and the apply dialog, and
 * all three bind to this one predicate rather than restating the Draft rule.
 * `CandidateApplyGateProvider`/`useApplyGate` are how that predicate reaches them:
 * the shell mounts the provider, and each control asks the gate.
 */

export { UNGATED_APPLY, useApplyGate, type ApplyGate } from './candidate/applyGate'
export { CandidateApplyGateProvider } from './candidate/ApplyGateProvider'

export {
  AdminCandidateProfileScreen,
  AdminCandidateProfileView,
} from './candidate/AdminCandidateProfileScreen'
export { CandidateProfileScreen, CandidateProfileView } from './candidate/CandidateProfileScreen'
export { CandidateProfileForm } from './candidate/CandidateProfileForm'
export {
  applyEligibility,
  isApplyEnabled,
  isProfileComplete,
  missingCompletenessFields,
  profileState,
  type ApplyEligibility,
  type CompletenessField,
} from './candidate/completeness'
export type { CandidateProfile } from './candidate/model'
export {
  MY_PROFILE_QUERY_KEY,
  adminCandidateProfileQueryKey,
} from './candidate/queries'
export {
  useAdminCandidateProfileQuery,
  useMyProfileQuery,
  useSaveMyProfile,
} from './candidate/profileQueries'

export {
  AdminSeniorProfileScreen,
  AdminSeniorProfileView,
} from './senior/AdminSeniorProfileScreen'
export { SeniorProfileScreen, SeniorProfileView } from './senior/SeniorProfileScreen'
export { SeniorProfileForm } from './senior/SeniorProfileForm'
export {
  showsChatPlaceholder,
  showsContactScope,
  showsEmailContact,
  type SeniorProfile,
} from './senior/model'
export {
  MY_SENIOR_PROFILE_QUERY_KEY,
  adminSeniorProfileQueryKey,
} from './senior/queries'
export {
  useAdminSeniorProfileQuery,
  useMySeniorProfileQuery,
  useSaveMySeniorProfile,
} from './senior/profileQueries'
