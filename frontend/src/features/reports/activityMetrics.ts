/**
 * The metric list of the activity report (Requirement 18 AC1).
 *
 * AC1 asks for *every returned metric*, so the list is not a hand-picked
 * selection: {@link ACTIVITY_METRIC_KEYS} is derived from the contract type
 * through an exhaustive `Record`, which means a metric the Backend_Api adds to
 * `ActivityReportDTO` fails the typecheck here until it is given a place in the
 * order and an entry in the catalogue. A metric cannot be silently dropped from
 * the screen.
 *
 * Its own module rather than a constant beside the panel component, so the list is
 * readable — and assertable — without rendering anything.
 *
 * Requirements: 18.1.
 */

import type { ActivityReport } from './reportsApi'

/** A counted metric of the activity report, i.e. everything but the period bounds. */
export type ActivityMetricKey = Exclude<keyof ActivityReport, 'period_from' | 'period_to'>

/**
 * Every counted metric, in the order the panel renders them.
 *
 * Grouped by subject — candidates first, then CV versions, then applications —
 * because that is how the numbers are read together.
 */
const METRIC_ORDER: Readonly<Record<ActivityMetricKey, true>> = Object.freeze({
  candidates_registered: true,
  candidates_approved: true,
  candidates_rejected: true,
  cv_versions_uploaded: true,
  applications_submitted: true,
  applications_under_review: true,
  applications_forwarded: true,
  applications_closed: true,
})

/** The counted metrics of the activity report, in rendering order (AC1). */
export const ACTIVITY_METRIC_KEYS: readonly ActivityMetricKey[] = Object.freeze(
  Object.keys(METRIC_ORDER) as ActivityMetricKey[],
)
