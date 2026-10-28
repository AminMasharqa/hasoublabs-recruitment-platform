/**
 * The Audit_Log browsing slice (Requirement 17).
 *
 * The shell registers {@link AuditScreen} on `/admin/audit`; everything else here
 * is internal to the slice. The pure modules are exported as well, because they are
 * the parts another Admin surface might legitimately reuse — the field comparison
 * and the UTC/local timestamp pair in particular — and because exporting them keeps
 * them visible as the tested seams they are.
 *
 * Reads only: this slice exposes no mutation, which is how Requirement 17 AC8's
 * "no control that edits or deletes an Audit_Log entry" is enforced rather than
 * merely intended.
 */

export { AuditScreen } from './AuditScreen'
export { AuditTimestamp } from './AuditTimestamp'
export { AuditFiltersPanel } from './AuditFiltersPanel'
export { ChainVerifyPanel } from './ChainVerifyPanel'
export { FieldComparisonTable } from './FieldComparisonTable'
export {
  AUDIT_FILTER_PARAM_NAMES,
  AUDIT_PARAM,
  EMPTY_AUDIT_FILTERS,
  auditQueryParams,
  hasActiveAuditFilters,
  nextAuditPage,
  normalizeTimeBound,
  readAuditCursor,
  readAuditFilters,
  timeBoundInputValue,
  writeAuditFilters,
  type AuditFilters,
  type AuditQueryParams,
} from './auditFilters'
export { compareAuditFields, renderSnapshotValue } from './auditComparison'
export type {
  AuditComparison,
  AuditSnapshot,
  FieldChangeKind,
  FieldComparisonRow,
} from './auditComparison'
export {
  CHAIN_INTACT,
  chainOkValue,
  chainRange,
  chainVerdict,
  type ChainRange,
  type ChainVerdict,
} from './chainVerify'
export {
  auditLocalTimestamp,
  auditTimestampParts,
  auditUtcTimestamp,
  localTimeZone,
  type AuditTimestampParts,
} from './auditTimestamps'
export { useAuditSearchQuery, useChainVerifyQuery } from './auditQueries'
export type { AuditActor, AuditEntry, AuditSearchPage, ChainVerifyReport } from './auditApi'
