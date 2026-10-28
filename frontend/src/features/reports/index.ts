/**
 * The reports and Excel export slice (Requirement 18).
 *
 * The shell registers {@link ReportsScreen} on `/admin/reports` and
 * {@link ExportsScreen} on `/admin/exports`; both sit in the `admin` guarded
 * group, which is what keeps every report and export destination out of the
 * Candidate and Senior contexts (AC11).
 *
 * The pure modules are exported too — the filter round trip and the export
 * lifecycle — so another Admin surface can bound an export the same way without
 * restating either.
 */

export { ReportsScreen } from './ReportsScreen'
export { ExportsScreen } from './ExportsScreen'
export { ActivityReportPanel } from './ActivityReportPanel'
export { ACTIVITY_METRIC_KEYS, type ActivityMetricKey } from './activityMetrics'
export { CandidateProgressTable } from './CandidateProgressTable'
export { adminApplicationDestination, APPLICATION_DRILLDOWN_PARAM } from './drilldowns'
export { ExportPanel, ExportFailureNotice } from './ExportPanel'
export { ReportFilterControls } from './ReportFilterControls'
export {
  EMPTY_REPORT_FILTERS,
  REPORT_PARAM,
  activityQueryParams,
  exportRequestBody,
  hasActiveReportFilters,
  nextProgressPage,
  progressQueryParams,
  readProgressCursor,
  readReportFilters,
  writeReportFilters,
  type ReportFilters,
} from './reportFilters'
export {
  EXPORT_ENTITY_TYPES,
  EXPORT_POLL_INTERVAL_MS,
  exportDownload,
  exportErrorMessage,
  exportJobId,
  exportPollInterval,
  isExportFailed,
  isExportPolling,
  isTerminalExportStatus,
  type ExportEntityType,
  type ExportJob,
  type ExportStatus,
} from './exportPolling'
export {
  useActivityReportQuery,
  useCandidateProgressQuery,
  useExportStatusQuery,
  useRequestExport,
} from './reportQueries'
export type {
  ActivityReport,
  CandidateProgressPage,
  CandidateProgressRow,
  PolledExport,
} from './reportsApi'
