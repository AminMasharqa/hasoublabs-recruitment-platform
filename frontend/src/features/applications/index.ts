/**
 * The Application submission and tracking slice (Requirement 14).
 *
 * The shell registers five screens: {@link MyApplicationsScreen} on
 * `/candidate/applications`, {@link MyApplicationScreen} on
 * `/candidate/applications/:applicationId`, {@link ApplicantsScreen} on both
 * `/senior/applicants` and `/senior/jobs/:jdId/applicants`, and
 * {@link AdminApplicationsScreen} on `/admin/applications`. Which accounts reach each
 * one is the route groups' decision (`CANDIDATE_ACCESS`, `SENIOR_ACCESS`,
 * `ADMIN_ACCESS`), so no screen here checks a role or an Active_Context for itself.
 *
 * {@link ApplyDialog} is the other half: the apply flow of AC2–AC8, opened by the apply
 * control the job browse slice already gates on the Job_Description status and the
 * Candidate's profile readiness (Req 12 AC7, Req 9 AC13). `ApplyControl` supplies the
 * gate and this slice supplies what happens next, which is why the dependency runs one
 * way — this slice imports nothing from `features/jobs`.
 *
 * The pure modules are exported as well, so another slice can address an Application
 * destination or read the Applicant_Card restriction without restating either.
 */

export { AdminApplicationsScreen } from './AdminApplicationsScreen'
export { ApplicantsScreen } from './ApplicantsScreen'
export { MyApplicationScreen } from './MyApplicationScreen'
export { MyApplicationsScreen } from './MyApplicationsScreen'
export { ApplicantCardView, ApplicantList, type ApplicantListProps } from './ApplicantList'
export {
  ApplicationCard,
  ApplicationField,
  type ApplicationCardProps,
} from './ApplicationCard'
export {
  ApplicationStatusControl,
  type ApplicationStatusControlProps,
} from './ApplicationStatusControl'
export { ApplyDialog, type ApplyDialogProps } from './ApplyDialog'
export { JobSelector, type JobSelectorProps } from './JobSelector'
export {
  applicantCardFields,
  applicantsQueryParams,
  APPLICANT_CARD_FIELDS,
  APPLICATIONS_PAGE_SIZE,
  APPLICATION_RECORDED_STATUS,
  APPLICATION_STATUS_TARGETS,
  applicationStatusBody,
  applyBody,
  applyOutcome,
  applyRefusal,
  CONFLICTING_STATE_ERROR,
  externalRedirectUrl,
  isApplicationStatus,
  myApplicationsQueryParams,
  nextApplicationsPage,
  orderApplicationsNewestFirst,
  PRECONDITION_UNMET_ERROR,
  RATE_LIMITED_ERROR,
  REDIRECT_URL_MEMBER,
  retryAfterSeconds,
  RETRY_AFTER_DETAILS_MEMBER,
  STATUS_REASON_BOUNDS,
  STATUS_REASON_PATH,
  unmetConditions,
  UNMET_DETAILS_MEMBER,
  validateStatusReason,
  type ApplicantCard,
  type ApplicantCardEntry,
  type ApplicantCardField,
  type Application,
  type ApplicantsQueryParams,
  type ApplyBody,
  type ApplyOutcome,
  type ApplyRefusal,
  type MyApplicationsQueryParams,
  type UnmetCondition,
  type UpdateApplicationStatusBody,
} from './applicationRules'
export {
  applicationChannelLabel,
  applicationStatusLabel,
  APPLICATIONS_NAMESPACE,
  fieldIssueText,
  fieldIssueTexts,
  unmetConditionText,
  unmetConditionTexts,
} from './applicationMessages'
export {
  applicantsQueryKey,
  applicantsScopeKey,
  APPLICANTS_PATH,
  APPLICANTS_SCOPE_KEY,
  applicationQueryKey,
  APPLICATIONS_QUERY_SCOPE,
  APPLICATION_DETAIL_SCOPE_KEY,
  APPLICATION_STATUS_PATH,
  APPLY_PATH,
  fetchMyApplication,
  listApplicants,
  listMyApplications,
  MY_APPLICATIONS_PATH,
  MY_APPLICATIONS_SCOPE_KEY,
  MY_APPLICATION_PATH,
  myApplicationsQueryKey,
  submitApplication,
  updateApplicationStatus,
} from './applicationsApi'
export {
  useApplicantsQuery,
  useMyApplicationQuery,
  useMyApplicationsQuery,
  useSubmitApplication,
  useUpdateApplicationStatus,
  type SubmitApplicationVariables,
  type UpdateApplicationStatusVariables,
} from './applicationQueries'
export {
  APPLICATIONS_CURSOR_PARAM,
  APPLICATION_PARAM,
  JD_PARAM,
  readApplicationId,
  readApplicationsCursor,
  readJdId,
  writeApplicationsCursor,
  writeSelection,
} from './selection'
export {
  defaultVariantChoice,
  resolveVariantSelection,
  variantChoices,
  type VariantChoice,
} from './variantChoice'
