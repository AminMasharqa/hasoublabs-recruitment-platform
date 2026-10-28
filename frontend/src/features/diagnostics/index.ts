/**
 * The diagnostics feature slice (Requirement 23 AC5, AC6).
 *
 * The screen is registered on the already-declared `/diagnostics` route through
 * the `elements` table `routing/routes.tsx` accepts, keyed by the `diagnostics`
 * path id. This slice therefore imports nothing from the router and decides
 * nothing about access: the route's guard group is `ANY_CONTEXT_ACCESS`, so any
 * approved session reaches it whatever its role or Active_Context.
 */

export { DiagnosticsScreen } from './DiagnosticsScreen'
export { BUNDLE_VERSION_ENV_KEY, bundleVersion, normalizeBundleVersion } from './bundleVersion'
export {
  fetchHealth,
  healthIndicator,
  HEALTH_PATH,
  HEALTH_QUERY_KEY,
  readHealthStatus,
  toHealthReport,
  type HealthIndicator,
  type HealthReport,
} from './health'
