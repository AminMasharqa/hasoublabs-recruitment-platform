/**
 * The `GET /health` probe the diagnostics surface reports (Requirement 23 AC6).
 *
 * ## Why the path is not a generated one
 *
 * Every other Backend_Api path in this application is a key of
 * `api/generated/schema.d.ts`, and that is enforced by the type of
 * {@link ApiClient.request}. `/health` is the one exception, for a reason that is
 * on the server: it is declared with `include_in_schema=False`, so it is absent
 * from `/api/openapi.json` and therefore absent from the generated declarations.
 * `verify:api` will never produce it, and hand-writing an entry into the
 * generated file would be exactly the drift that script exists to catch.
 *
 * So this module holds the one documented cast in the client, {@link issueHealthRead},
 * confined to a single call with a single path constant. What is *not* given up
 * is Requirement 3 AC1: the request still goes through the Api_Client, so it
 * carries the active Locale, obeys the 30-second budget, retries as an idempotent
 * read, decodes any failure into an Error_Envelope and records its
 * Support_Reference like every other request.
 *
 * ## Why the path has no `/api/v1` prefix
 *
 * It is mounted at the origin root, not under the versioned prefix — the probe
 * predates and outlives the API surface. That happens to compose correctly with
 * the Api_Client's base-URL handling: `resolveRequestBaseUrl` strips the
 * `/api/v1` mount prefix from the configured base URL precisely because the
 * generated templates carry it themselves, which leaves the origin (or the empty
 * string) for this path to be appended to. `https://host/api/v1` therefore probes
 * `https://host/health`, not `https://host/api/v1/health`.
 *
 * The decoding below is pure, so the classification of a reported status is
 * testable without a network.
 */

import type { ApiClient, ApiSuccess } from '../../api/client'

/** The unauthenticated probe path, mounted at the origin root, not under `/api/v1`. */
export const HEALTH_PATH = '/health'

/** TanStack Query key of the probe. */
export const HEALTH_QUERY_KEY = ['diagnostics', 'health'] as const

/**
 * How a reported status reads.
 *
 * Only three outcomes, because the surface promises only what it can know:
 * - `healthy` — the service answered and named itself well.
 * - `other` — the service answered but named something else, whatever that is.
 *   The raw value is rendered beside this, so nothing is lost by not
 *   enumerating the vocabulary.
 * - `unknown` — the service answered 200 with a body that carries no readable
 *   status. Reachability is still a real diagnostic result, so this is a success
 *   rather than an error.
 *
 * A failed request is not represented here at all: that is an Error_Envelope, and
 * the Error_Presenter surfaces it.
 */
export type HealthIndicator = 'healthy' | 'other' | 'unknown'

/**
 * Status values that mean the service considers itself well.
 *
 * The Backend_Api answers `{"status": "ok"}` today. The others are accepted
 * because this is a probe contract that is not in the OpenAPI document and so
 * carries no compile-time guarantee — and because misreporting a healthy service
 * as troubled is the more misleading of the two mistakes available here.
 */
const HEALTHY_STATUS_VALUES: readonly string[] = ['ok', 'healthy', 'up', 'pass', 'passing']

/** The outcome of one probe. */
export interface HealthReport {
  /**
   * The `status` member exactly as the response carried it, or `null` when the
   * body carried none. Rendered verbatim (Requirement 23 AC6) — the surface
   * reports what the service said, not a paraphrase of it.
   */
  readonly status: string | null
  /** How that value reads, for the localized summary beside it. */
  readonly indicator: HealthIndicator
}

/**
 * Reads the `status` member of a probe body, or `null`.
 *
 * Tolerant by design: the endpoint is outside the generated contract, so its body
 * is an assumption rather than a guarantee, and an unexpected shape must degrade
 * to "reachable, status not reported" rather than throw on a diagnostics screen.
 */
export function readHealthStatus(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null
  }
  const status = (body as { status?: unknown }).status
  if (typeof status !== 'string') {
    return null
  }
  const trimmed = status.trim()
  return trimmed.length === 0 ? null : status
}

/** Classifies a reported status value. Case- and whitespace-insensitive. */
export function healthIndicator(status: string | null): HealthIndicator {
  if (status === null) {
    return 'unknown'
  }
  return HEALTHY_STATUS_VALUES.includes(status.trim().toLowerCase()) ? 'healthy' : 'other'
}

/** Builds the report for a probe body. */
export function toHealthReport(body: unknown): HealthReport {
  const status = readHealthStatus(body)
  return { status, indicator: healthIndicator(status) }
}

/**
 * The init members the probe supplies, restated structurally.
 *
 * The generated-path typing of {@link ApiClient.request} cannot describe an
 * operation that is not in the document, so the one cast this module makes is
 * against this signature rather than against `any` — the method, the path and the
 * init members stay checked.
 */
type UntypedRead = (
  method: 'get',
  path: string,
  init: {
    readonly signal?: AbortSignal
    readonly accessToken?: string | null
    readonly allowAuthRefresh?: boolean
  },
) => Promise<ApiSuccess<unknown>>

/**
 * Issues the probe through the Api_Client (Requirement 3 AC1, Requirement 23 AC6).
 *
 * `accessToken: null` sends no `Authorization` header: the probe is
 * unauthenticated on the server, so there is no reason to put a credential on the
 * wire for it. `allowAuthRefresh: false` follows from that — a 401 from an
 * endpoint that was never asked to authenticate says nothing about the session,
 * and driving a Refresh_Token exchange from a diagnostics screen would turn a
 * read-only surface into one with session side effects.
 */
export async function fetchHealth(api: ApiClient, signal?: AbortSignal): Promise<HealthReport> {
  const issue = api.request as unknown as UntypedRead
  const { data } = await issue('get', HEALTH_PATH, {
    ...(signal === undefined ? {} : { signal }),
    accessToken: null,
    allowAuthRefresh: false,
  })
  return toHealthReport(data)
}
