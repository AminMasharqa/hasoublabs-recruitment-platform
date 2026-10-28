/**
 * The Job_Description slice: browsing (Requirement 12) and authoring
 * (Requirement 13).
 *
 * The shell registers {@link JobsBrowseScreen} on `/jobs` and
 * {@link JobDetailScreen} on `/jobs/:jdId`; the authoring screens go on the Senior
 * and Admin paths — {@link SeniorJobsScreen} and {@link AdminJobsScreen} on the two
 * listings, {@link JobNewScreen} on both `.../jobs/new` paths and
 * {@link JobAuthoringScreen} on both `.../jobs/:jdId` paths. Everything else here is
 * internal to the slice.
 *
 * The pure modules are exported as well, so the application slice (task 20.1) can
 * reuse the status verdict, the skill resolution and the lifecycle table rather than
 * restating any of them.
 */

export { JobsBrowseScreen } from './JobsBrowseScreen'
export { JobDetailScreen } from './JobDetailScreen'
export { AdminJobsScreen } from './AdminJobsScreen'
export { JobAuthoringScreen } from './JobAuthoringScreen'
export { JobNewScreen } from './JobNewScreen'
export { SeniorJobsScreen } from './SeniorJobsScreen'
export { JobExtractionPanel } from './JobExtractionPanel'
export { JobForm } from './JobForm'
export { JobLifecycleControls } from './JobLifecycleControls'
export { JobSkillTermsField } from './JobSkillTermsField'
export { IllegalTransitionNotice } from './IllegalTransitionNotice'
export { SkillCandidatePanel } from './SkillCandidatePanel'
export { ApplyControl, JobStatusBadge } from './JobStatusControls'
export { applyAvailability, isClosed, type ApplyAvailability, type ApplyBlockReason } from './jobStatus'
export {
  EMPTY_BROWSE_FILTERS,
  browseQueryParams,
  hasActiveFilters,
  readBrowseCursor,
  readBrowseFilters,
  writeBrowseFilters,
  type JobBrowseFilters,
} from './browseFilters'
export {
  useContactableSeniorsQuery,
  useJobBrowseQuery,
  useJobQuery,
  useResolvedSkills,
  useSkillSearchQuery,
} from './jobQueries'
export type { JobBrowsePage, JobDescription } from './jobsApi'
export {
  admitsJobAction,
  applicationChannelBody,
  canCloseJob,
  canEditJob,
  canPublishJob,
  canSetApplicationChannel,
  changedJobFields,
  createJobBody,
  EMPTY_JOB_DRAFT,
  hasJobChanges,
  illegalTransitionOf,
  isIllegalTransition,
  jobAuthoringActions,
  jobDraftFrom,
  JOB_FIELD,
  normalizeSkillTerms,
  requiresExternalUrl,
  unresolvedSkillTerms,
  validateJobDraft,
  validatePublishPrecondition,
  type IllegalTransition,
  type JobAuthoringAction,
  type JobCreateBody,
  type JobDraft,
  type JobUpdateBody,
} from './authoringRules'
export {
  allSkillCandidatesResolved,
  canConfirmExtraction,
  confirmedSkillTerms,
  decideSkillCandidate,
  decodeExtractionDraft,
  draftFromExtraction,
  EXTRACTION_POLL_INTERVAL_MS,
  extractionPollInterval,
  initialSkillResolutions,
  isExtractionPending,
  isSkillCandidateResolved,
  missingExtractedFields,
  type ExtractableField,
  type ExtractionDraft,
  type ExtractionOutcome,
  type SkillCandidate,
  type SkillDecision,
  type SkillResolution,
} from './extraction'
export {
  adminJobsQuery,
  adminJobsQueryKey,
  extractionDraftQueryKey,
  nextAdminJobsPage,
  type AdminJobsQuery,
} from './authoringApi'
export {
  ADMIN_JOBS_PARAM,
  readAdminJobsCursor,
  readAdminJobStatus,
  writeAdminJobsParams,
} from './adminJobFilters'
export {
  useAdminJobsQuery,
  useCloseJob,
  useConfirmExtraction,
  useCreateJob,
  useExtractFromText,
  useExtractFromUrl,
  useExtractionDraftQuery,
  usePublishJob,
  useRefreshJob,
  useSetApplicationChannel,
  useUpdateJob,
} from './authoringQueries'
