/**
 * The drill-down destinations of a candidate-progress row (Requirement 18 AC5).
 *
 * AC5 asks for a control per row that navigates to the underlying account,
 * Job_Description or Application destination. Two of the three already have a
 * path helper in `routing/paths.ts` — `adminCandidateProfilePath` and
 * `adminJobPath` — so only the Application needs one, and it lives here rather
 * than in the table component so the addresses stay assertable without rendering
 * anything.
 *
 * Requirements: 18.5.
 */

import { ROUTE_PATHS } from '../../routing/paths'

/** Query parameter the Application destination is addressed with (AC5). */
export const APPLICATION_DRILLDOWN_PARAM = 'application_id'

/**
 * The Admin Application destination for one Application (AC5).
 *
 * The contract exposes no per-Application Admin screen, so the drill-down names
 * the Admin Application destination and carries the identifier as a query
 * parameter: an address that is meaningful to the Admin who follows it, and one
 * the applications destination can narrow its list on.
 */
export function adminApplicationDestination(applicationId: string): string {
  const params = new URLSearchParams({ [APPLICATION_DRILLDOWN_PARAM]: applicationId })
  return `${ROUTE_PATHS.adminApplications}?${params.toString()}`
}
