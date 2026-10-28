/**
 * The screens registered on the declared route paths.
 *
 * `routing/routes.tsx` renders a {@link import('../routing/placeholders').PlaceholderScreen}
 * for every path absent from this table, so a feature slice becomes reachable by
 * adding one entry here — and changes nothing about the paths, the nesting or the
 * guarding, which are final. The dependency runs one way only: the shell knows
 * the feature slices, and a slice knows nothing of the router, which is why each
 * one can be mounted directly in its own test.
 *
 * Its own module rather than a constant in `AppShell.tsx` so that the shell file
 * exports components only, and so a feature task edits one short table instead of
 * the provider stack.
 *
 * Filled in so far: the unauthenticated `/login` screen (task 14.1, Requirement 4
 * AC1, AC2, AC12), `/account` (task 14.2, Requirement 5 AC4–AC7),
 * `/diagnostics` (task 12.3, Requirement 23 AC5, AC6) and the
 * unauthenticated `/register/:token` Registration_Link screen (task 15.1,
 * Requirement 6 AC1–AC8, AC13, AC14), the unauthenticated `/verify`
 * Verification_Code screen (task 15.2, Requirement 6 AC9–AC12), the `/status`
 * Status_Notice (task 15.3, Requirement 7 AC3–AC5), the two
 * CV_Variant screens (task 17.1,
 * Requirement 11 AC1–AC7), the two Job_Description browsing screens (task 18.1,
 * Requirement 12 AC1–AC11), the four Job_Description authoring screens — the two
 * listings, the creation form and the authoring surface (task 19.1, Requirement 13
 * AC1–AC18) — the Candidate profile pair — the Candidate's own
 * editor and the Admin read (task 16.1, Requirement 9) — the Senior profile pair —
 * the Senior's own editor and the Admin read (task 16.2, Requirement 10) — the
 * Audit_Log_Viewer
 * on `/admin/audit` (task 23.1, Requirement 17 AC1–AC9), the four Review
 * screens (task 21.1, Requirement 15 AC1–AC11), the reports and exports pair
 * (task 24.1, Requirement 18 AC1–AC11) and the five Application screens — the
 * Candidate's own list and detail, the Senior applicant list on both its addresses and
 * the Admin Application destination (task 20.1, Requirement 14 AC9–AC14). The
 * remaining tasks in 14–24 add the rest.
 */

import { AdminAccountsScreen } from '../features/admin-accounts'
import {
  AdminApplicationsScreen,
  ApplicantsScreen,
  MyApplicationScreen,
  MyApplicationsScreen,
} from '../features/applications'
import { AuditScreen } from '../features/audit'
import { LoginScreen } from '../features/auth'
import { CvVariantScreen, CvVariantsScreen } from '../features/cvs'
import { DiagnosticsScreen } from '../features/diagnostics'
import {
  AdminJobsScreen,
  JobAuthoringScreen,
  JobDetailScreen,
  JobNewScreen,
  JobsBrowseScreen,
  SeniorJobsScreen,
} from '../features/jobs'
import { AccountScreen } from '../features/mfa'
import { StatusNoticeScreen } from '../features/onboarding'
import {
  AdminCandidateProfileScreen,
  AdminSeniorProfileScreen,
  CandidateProfileScreen,
  SeniorProfileScreen,
} from '../features/profiles'
import { RegistrationScreen, VerificationScreen } from '../features/registration'
import { ExportsScreen, ReportsScreen } from '../features/reports'
import {
  AdminCandidateReviewsScreen,
  AdminReviewsScreen,
  SeniorReviewNewScreen,
  SeniorReviewsScreen,
} from '../features/reviews'
import type { ScreenElements } from '../routing/routes'

export const SCREEN_ELEMENTS: ScreenElements = Object.freeze({
  login: <LoginScreen />,
  // Req 5 AC4–AC7: the account screen, in the session-wide guard group so it is
  // reachable in every Active_Context. The multi-factor section inside it renders
  // from the `roles` claim, because the second factor belongs to the account rather
  // than to the context it is currently acting in.
  account: <AccountScreen />,
  diagnostics: <DiagnosticsScreen />,
  // Public by route declaration, not by anything this table does: `register` is
  // one of `PUBLIC_ROUTE_PATH_IDS`, so no guard sits above it (Req 6 AC1).
  register: <RegistrationScreen />,
  // Also public by route declaration (Req 6 AC9): a registrant enters the code
  // before they have ever signed in, so `verification` is one of
  // `PUBLIC_ROUTE_PATH_IDS` and no guard sits above it. The account identifier the
  // screen submits arrives in router state from the registration screen, never
  // from the address — see `features/registration/verificationHandoff.ts`.
  verification: <VerificationScreen />,
  // Req 7 AC3–AC5: the Status_Notice, the sole member of the `onboarding` guard
  // group — whose metadata opens it to every role and every Account_Status, which
  // is what keeps it reachable for a suspended account and is why the screen
  // itself decides nothing about access.
  statusNotice: <StatusNoticeScreen />,
  // Req 12 AC11: both sit in the `job-browsing` guard group, so neither renders a
  // Job_Description without an approved Candidate or Senior session.
  jobs: <JobsBrowseScreen />,
  jobDetail: <JobDetailScreen />,
  // Req 13: Job_Description authoring. The creation form and the authoring surface
  // are one screen each, registered on both the Senior and the Admin path, which is
  // what makes AC1's "the Active_Context is SENIOR or the account holds the Admin
  // role" structural: the `senior` and `admin` guard groups decide admission above
  // them, and neither screen checks a role for itself (Req 8 AC4, AC7, AC8).
  seniorJobs: <SeniorJobsScreen />,
  seniorJobNew: <JobNewScreen />,
  seniorJobDetail: <JobAuthoringScreen />,
  // Req 13 AC17: the Admin all-status listing with its status filter.
  adminJobs: <AdminJobsScreen />,
  adminJobNew: <JobNewScreen />,
  adminJobDetail: <JobAuthoringScreen />,
  // All three sit in the `candidate` guard group, so the Candidate Active_Context
  // is required above them (Req 8 AC6); no screen decides that for itself, which
  // is what makes Req 9 AC1's "while the Active_Context is CANDIDATE" structural.
  candidateProfile: <CandidateProfileScreen />,
  candidateCvs: <CvVariantsScreen />,
  candidateCvVariant: <CvVariantScreen />,
  // Req 14 AC9–AC11: the Candidate's own Applications and one Application in full.
  // Also in the `candidate` group, so "while the Active_Context is CANDIDATE" is
  // decided above them rather than by either screen.
  candidateApplications: <MyApplicationsScreen />,
  candidateApplicationDetail: <MyApplicationScreen />,
  // Req 10: the Senior's own profile and contact preferences, in the `senior` guard
  // group — which is what makes AC1's "while the Active_Context is SENIOR"
  // structural rather than a check the screen performs on itself.
  seniorProfile: <SeniorProfileScreen />,
  // Req 9 AC14: the Admin read of any Candidate's profile, in the Admin group.
  adminCandidateProfile: <AdminCandidateProfileScreen />,
  // Req 10 AC12: the Admin read of any Senior's profile, in the Admin group.
  adminSeniorProfile: <AdminSeniorProfileScreen />,
  // Req 16: Admin account management — the account list, Registration_Links, the
  // lifecycle controls and the pending-skill review. In the `admin` guard group,
  // which is what makes AC1's "WHERE the account holds the Admin role" structural
  // rather than a check the screen performs on itself.
  adminAccounts: <AdminAccountsScreen />,
  // Req 17: the Audit_Log_Viewer, in the `admin` guard group — which is what makes
  // AC1's "WHERE the account holds the Admin role" structural rather than a check
  // the screen performs on itself.
  adminAudit: <AuditScreen />,
  // Req 15: the Review_Timelines and the review form. The two Senior paths sit in
  // the `senior` guard group and the two Admin paths in the `admin` group, which
  // is what makes AC9's "WHILE the Active_Context is SENIOR", AC7's "WHERE the
  // account holds the Admin role" and AC10's "no Review_Timeline destination while
  // the Active_Context is CANDIDATE" structural: there is no Candidate route here
  // for a timeline to be reached from.
  seniorReviews: <SeniorReviewsScreen />,
  seniorReviewNew: <SeniorReviewNewScreen />,
  // Req 14 AC12: the Applicant_Cards of one Job_Description, one screen on both the
  // menu destination and the per-role address — they differ only in where the
  // Job_Description identifier comes from. Both sit in the `senior` group, and the
  // Admin reaches the same list from `/admin/applications` below, which is what makes
  // AC12's "WHERE the Active_Context is SENIOR or the account holds the Admin role"
  // structural (Req 8 AC7, AC8).
  seniorApplicants: <ApplicantsScreen />,
  seniorJobApplicants: <ApplicantsScreen />,
  // Req 14 AC13, AC14: the Admin status control, plus the same applicant list. In the
  // `admin` guard group, so the Admin role is required above it.
  adminApplications: <AdminApplicationsScreen />,
  adminReviews: <AdminReviewsScreen />,
  adminCandidateReviews: <AdminCandidateReviewsScreen />,
  // Req 18: the activity and candidate-progress reports and the Excel export.
  // Both sit in the `admin` guard group, which is what makes AC11's "no report or
  // export destination while the Active_Context is CANDIDATE or SENIOR"
  // structural: there is no non-Admin route either screen could be reached from,
  // and the Navigation_Menu derives its entries from the same access metadata.
  adminReports: <ReportsScreen />,
  adminExports: <ExportsScreen />,
})
