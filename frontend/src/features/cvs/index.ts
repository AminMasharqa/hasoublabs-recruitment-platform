/**
 * The CV slice (Requirement 11).
 *
 * Variant management is the list of `GET /me/cv-variants` and the create, edit,
 * archive and primary controls decided from it (AC1–AC7). Version management —
 * upload with byte-percentage progress, the ≤10s `PendingScan` poll, the download
 * gating and the Admin read (AC8–AC20) — is `CvVersionPanel`, mounted inside
 * `CvVariantScreen`, plus `AdminCandidateCvPanel` for AC19.
 *
 * `AdminCandidateCvPanel` is exported but not yet mounted on a route: the Admin
 * Candidate screens live in `features/profiles`, and AC19 becomes reachable when
 * one of them mounts this panel with the Candidate's account identifier. It holds
 * no routing knowledge of its own, so that wiring is a one-line change there.
 *
 * The two screens are registered on the already-declared `/candidate/cvs` and
 * `/candidate/cvs/:variantId` routes through the `elements` table of
 * `routing/routes.tsx`, so this slice imports nothing from the router beyond the
 * path helper the card links with, and decides nothing about access: the route
 * group is `CANDIDATE_ACCESS`, so the Candidate context is required above every
 * screen here (Req 8 AC6).
 */

export { AdminCandidateCvPanel, type AdminCandidateCvPanelProps } from './AdminCandidateCvPanel'
export { CvVariantActions } from './CvVariantActions'
export { CvVariantCard } from './CvVariantCard'
export { CvVariantForm } from './CvVariantForm'
export { CvVariantScreen } from './CvVariantScreen'
export { CvVariantsScreen } from './CvVariantsScreen'
export { CvVersionDownloadControl, IncompleteDownloadNotice } from './CvVersionDownloadControl'
export { CvVersionPanel, type CvVersionPanelProps } from './CvVersionPanel'
export { CvVersionRow, type CvVersionRowProps } from './CvVersionRow'
export { CvVersionUpload, type CvVersionUploadProps } from './CvVersionUpload'
export {
  archiveCvVariant,
  createCvVariant,
  CV_VARIANT_PATH,
  CV_VARIANT_PRIMARY_PATH,
  CV_VARIANTS_PATH,
  CV_VARIANTS_QUERY_KEY,
  listCvVariants,
  setPrimaryCvVariant,
  updateCvVariant,
} from './variantApi'
export {
  useArchiveCvVariant,
  useCreateCvVariant,
  useCvVariantsQuery,
  useSetPrimaryCvVariant,
  useUpdateCvVariant,
  type UpdateVariantVariables,
} from './variantQueries'
export {
  activeVariants,
  applyPrimary,
  archiveBlockedReason,
  canArchiveVariant,
  canCreateVariant,
  canSetPrimary,
  changedVariantFields,
  countActiveVariants,
  createBlockedReason,
  createBodyFrom,
  draftFromVariant,
  EMPTY_VARIANT_DRAFT,
  findVariant,
  hasVariantChanges,
  isRenderedPrimary,
  MAX_ACTIVE_VARIANTS,
  orderVariantsForDisplay,
  primaryVariantId,
  replaceVariant,
  validateVariantDraft,
  VARIANT_DESCRIPTION_BOUNDS,
  VARIANT_NAME_BOUNDS,
  type ArchiveBlockedReason,
  type CreateBlockedReason,
  type CreateVariantBody,
  type CvVariant,
  type UpdateVariantBody,
  type VariantDraft,
} from './variantRules'
export {
  fieldViolationMessage,
  issueCatalogueKey,
  issueMessage,
  issueMessages,
  validationIssueMessage,
} from './variantMessages'
export {
  ADMIN_CV_VARIANTS_PATH,
  ADMIN_CV_VERSION_DOWNLOAD_PATH,
  adminCvVariantsQueryKey,
  adminListCvVariants,
  CV_VERSION_DOWNLOAD_PATH,
  CV_VERSIONS_PATH,
  CV_VERSIONS_QUERY_SCOPE,
  cvVersionsQueryKey,
  listCvVersions,
} from './versionApi'
export {
  adminDownloadCvVersion,
  deliverFile,
  downloadCvVersion,
  OBJECT_URL_LIFETIME_MS,
  type AdminDownloadVersionRequest,
  type DownloadedFile,
  type DownloadHost,
  type DownloadVersionRequest,
} from './versionDownload'
export {
  useAdminCvVariantsQuery,
  useAdminDownloadCvVersion,
  useCvVersionsQuery,
  useDownloadCvVersion,
  useUploadCvVersion,
  type CvVersionUpload as CvVersionUploadState,
} from './versionQueries'
export {
  adminVersionNumbers,
  applyUploadedVersion,
  canDownloadVersion,
  canUploadSelection,
  CV_UPLOAD_ACCEPT,
  CV_VERSION_STATES,
  declaredContentLength,
  downloadBlockedReason,
  hasPendingScan,
  INCOMPLETE_DOWNLOAD_ERROR,
  incompleteDownloadFailure,
  INTEGRITY_VIOLATION_ERROR,
  isAcceptedMediaType,
  isAvailable,
  isIncompleteDownload,
  isIntegrityViolation,
  isPendingScan,
  isQuarantined,
  isTruncatedTransfer,
  isWithinUploadBound,
  latestVersion,
  MAX_UPLOAD_BYTES,
  orderVersionsForDisplay,
  pendingScanVersions,
  uploadProgress,
  UPLOAD_FIELD_PATH,
  UPLOAD_MEDIA_TYPES,
  validateVersionSelection,
  VERSION_POLL_INTERVAL_MS,
  versionsPollInterval,
  type CvUploadAccepted,
  type CvVersion,
  type CvVersionState,
  type DownloadBlockedReason,
  type IncompleteDownloadFailure,
  type SelectedFile,
  type UploadProgress,
  type UploadProgressListener,
} from './versionRules'
export {
  escapeMultipartFilename,
  multipartParts,
  newBoundary,
  streamedMultipartBody,
  supportsRequestStreaming,
  UPLOAD_CHUNK_BYTES,
  UPLOAD_FIELD_NAME,
  UPLOAD_TIMEOUT_MS,
  uploadCvVersion,
  type EncodableFile,
  type MultipartParts,
  type UploadableFile,
  type UploadVersionRequest,
} from './versionUpload'
