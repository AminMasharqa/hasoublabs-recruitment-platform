/**
 * Api_Client — the sole HTTP layer of the Web_Client (Requirement 3).
 *
 * Every Backend_Api call in the application goes through {@link ApiClient.request}.
 * No other module calls `fetch`, constructs a `Request` or reads a `Response`
 * (AC1), which is what makes credential attachment, language negotiation, error
 * decoding, Support_Reference recording, the timeout budget and the retry policy
 * uniform for every screen instead of per-feature folklore.
 *
 * ## What one request does
 *
 * 1. Reads the Access_Token from the Session_Manager and attaches it as
 *    `Authorization: Bearer` when one is held (AC2).
 * 2. Attaches the active Locale as `Accept-Language` on every request (AC3).
 * 3. Arms a 30-second budget; when it elapses the request is aborted and an
 *    Error_Envelope with `error: "request_timeout"` is synthesized (AC12).
 * 4. Records the `X-Request-ID` of the response as that request's
 *    Support_Reference (AC6). It rides along on success in
 *    {@link ApiSuccess.supportReference} but is only ever *shown* to the user on
 *    a failure (Requirement 23 AC4), which is why the `onFailure` observer — the
 *    hook the shell uses to retain the most-recent reference — fires on failures
 *    only.
 * 5. On 400–599, decodes the body through `./errors.ts` (AC4, AC5, AC9) and
 *    augments it with the transport facts the requirements ask for: the 429
 *    `Retry-After` value (AC10) and the 503 `upstream_unavailable`
 *    `details.service` (AC11).
 * 6. Routes a 401 to the Session_Manager refresh-and-replay path (AC7) and a 403
 *    straight to the caller with no refresh attempted (AC8).
 * 7. Retries a failed *read* at most twice with increasing delay when the
 *    outcome is retryable, and never retries a mutation (Requirement 21 AC9,
 *    AC10) — the decision itself lives in `../lib/retry.ts`.
 *
 * ## Secret hygiene (AC13, Requirement 23 AC7)
 *
 * This module writes nothing anywhere. It holds no logger, calls no `console`
 * (an oxlint rule over `src/api/**` fails the Build_Pipeline if that changes) and
 * never copies a request body into a thrown value. An Access_Token, a
 * Refresh_Token, a password, a Verification_Code and a Residency_Proof value
 * therefore appear in exactly one place: the Backend_Api request that needs them.
 * {@link ApiFailure} carries only the decoded Error_Envelope plus the method and
 * path, so even an unhandled rejection landing in a rendering-error overlay
 * cannot surface secret material.
 *
 * ## Why every collaborator is injected
 *
 * The session, the Locale, `fetch`, the clock and the timer all arrive through
 * {@link ApiClientConfig}. That keeps this module's behaviour — timeout, retry
 * budget, header attachment, refresh routing — observable from a unit test with
 * no network, no fake timers and no module mocking, and it is also what breaks
 * the cycle with the Session_Manager: the Api_Client supplies
 * `exchangeRefreshToken`/`revokeSession` and consumes `onUnauthorized`, so
 * neither module can import the other's instance. {@link createApiRuntime} wires
 * the pair with a late-bound accessor.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.10, 3.11, 3.12, 3.13, 21.9, 21.10.
 */

import createClient, {
  mergeHeaders,
  type Client,
  type ClientPathsWithMethod,
  type FetchResponse,
  type HeadersOptions,
  type MaybeOptionalInit,
} from 'openapi-fetch'

import { env } from '../lib/env'
import {
  isRetryableOutcome,
  REQUEST_TIMEOUT_ERROR,
  retryDelayMs,
  shouldRetryOutcome,
  UPSTREAM_UNAVAILABLE_ERROR,
} from '../lib/retry'
import { activeLocale } from '../i18n'
import {
  createSessionManager,
  tokenPairFrom,
  timeoutScheduler,
  systemClock,
  type CancelScheduled,
  type Clock,
  type Scheduler,
  type SessionManager,
  type SessionManagerConfig,
  type TokenPair,
  type UnauthorizedOutcome,
} from '../session/SessionManager'

import {
  classifyAuthOutcome,
  decodeApiError,
  readHeader,
  readSupportReference,
  UNEXPECTED_RESPONSE_ERROR,
  type ApiError,
} from './errors'
import type { paths } from './generated/schema'

export type { ApiError, FieldViolation } from './errors'

// ── Contract-shaped typing over the generated declarations ────────────────────

/** The HTTP methods an OpenAPI path item may declare. */
export type HttpMethod = 'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace'

/** Any media type, matching the `MediaType` constraint of the generated helpers. */
type MediaTypeLike = `${string}/${string}`

/** The underlying `openapi-fetch` client, typed against the generated `paths`. */
type ContractClient = Client<paths, MediaTypeLike>

/** Every generated path that declares the method `M`. */
export type ApiPath<M extends HttpMethod> = ClientPathsWithMethod<ContractClient, M>

/**
 * The `openapi-fetch` init object for one operation: `params`, `body`, and the
 * `RequestInit` members (`signal`, `headers`, `parseAs`, …).
 */
export type ApiInit<M extends HttpMethod, P extends ApiPath<M>> = MaybeOptionalInit<paths[P], M>

/** The success body of one operation, as the generated declarations describe it. */
export type ApiData<M extends HttpMethod, P extends ApiPath<M>, Init> = NonNullable<
  FetchResponse<ApiOperation<M, P>, Init, MediaTypeLike>['data']
>

/**
 * The generated operation object for method `M` of path `P`.
 *
 * `openapi-typescript` declares every one of the eight methods on every path
 * item, giving the unsupported ones the type `undefined`; the `NonNullable` drops
 * that so the operation satisfies the response-map constraint.
 */
type ApiOperation<M extends HttpMethod, P extends ApiPath<M>> = NonNullable<paths[P][M]>

/**
 * Keys of `T` that a caller must supply.
 *
 * Mirrors the `RequiredKeysOf` helper `openapi-fetch` uses internally. It is
 * restated here rather than imported because `openapi-typescript-helpers` is a
 * transitive dependency this workspace does not declare, and the whole point of
 * the type is to keep {@link ApiClient.request} as strict as the underlying
 * client: an operation with required path parameters or a required body must not
 * type-check without them.
 */
type RequiredKeysOf<T> = {
  // `-?` strips optionality so an all-optional `T` yields `never` rather than
  // `undefined`; `Record<never, never>` is the empty object type, which is
  // assignable to a `Pick` of an optional key and to nothing else.
  [K in keyof T]-?: Record<never, never> extends Pick<T, K> ? never : K
}[keyof T]

/**
 * The init argument of {@link ApiClient.request}: optional when the operation
 * needs nothing, required when it needs parameters or a body.
 */
type ApiInitParam<Init> = RequiredKeysOf<Init> extends never
  ? [init?: Init & ApiRequestExtras]
  : [init: Init & ApiRequestExtras]

// ── Public request and response shapes ────────────────────────────────────────

/**
 * Api_Client-specific init members, accepted alongside the generated `params`
 * and `body`. All are stripped before the init reaches `openapi-fetch`.
 */
export interface ApiRequestExtras {
  /**
   * Whether this request mutates Backend_Api state (Requirement 21 AC10).
   *
   * Defaults to the method: `GET`, `HEAD`, `OPTIONS` and `TRACE` are reads,
   * everything else is a mutation. Override it only for an endpoint whose method
   * misdescribes it — a `POST` search, for instance.
   */
  readonly isMutation?: boolean
  /**
   * Whether a 401 may drive the Session_Manager refresh-and-replay path (AC7).
   *
   * Defaults to `true`. The token exchanges set it to `false`, which is what
   * bounds the recursion: a 401 on `POST /auth/refresh` is a dead
   * Refresh_Token, not something to refresh.
   */
  readonly allowAuthRefresh?: boolean
  /**
   * Access_Token to attach instead of the one the Session_Manager holds.
   *
   * `null` sends no `Authorization` header at all. Needed for
   * `POST /auth/logout`, which the Session_Manager issues with the token it has
   * already discarded from its own state.
   */
  readonly accessToken?: string | null
  /** Overrides the 30-second budget of this one request (AC12). */
  readonly timeoutMs?: number
}

/** A successful Backend_Api response. */
export interface ApiSuccess<T> {
  /** The decoded response body; `undefined` for a `204`. */
  readonly data: T
  /** The raw response, for callers that need a header or a binary body. */
  readonly response: Response
  /**
   * The `X-Request-ID` recorded for this request (AC6).
   *
   * Recorded, never rendered: a Support_Reference is shown to the user on
   * failure only (Requirement 23 AC4).
   */
  readonly supportReference: string | null
}

/**
 * A failed Backend_Api request, as thrown by {@link ApiClient.request}.
 *
 * Extends the decoded {@link ApiError} — `error`, `message`, `details`,
 * `request_id`, `httpStatus`, `supportReference`, `refreshEligible`,
 * `authOutcome`, `fieldViolations` — with the transport facts Requirement 3
 * AC10/AC11 ask the Api_Client to expose and the two request identifiers the
 * Error_Presenter needs for context. It carries no request body, no header and
 * no token (AC13).
 *
 * Thrown as a plain frozen object rather than an `Error` subclass so that the
 * value a feature catches is exactly the decoded envelope every other consumer
 * reads — `decodeApiError` produces that shape, and the Session_Manager
 * classifies a refresh rejection by reading `httpStatus` off it.
 */
export interface ApiFailure extends ApiError {
  /** The request method, lowercased. */
  readonly method: HttpMethod
  /** The OpenAPI path template the request was issued against. */
  readonly path: string
  /** Raw `Retry-After` header value of a 429, when the response carried one (AC10). */
  readonly retryAfter: string | null
  /**
   * `Retry-After` resolved to whole seconds (AC10).
   *
   * Reads the header — numeric seconds or an HTTP-date — and falls back to the
   * `details.retry_after_seconds` member the `rate_limited` envelope carries.
   */
  readonly retryAfterSeconds: number | null
  /** `details.service` of a 503 `upstream_unavailable` envelope (AC11). */
  readonly upstreamService: string | null
  /** Whether the outcome is one the retry policy treats as transient (AC11). */
  readonly retryable: boolean
}

/** Narrows an unknown thrown value to an {@link ApiFailure}. */
export function isApiFailure(value: unknown): value is ApiFailure {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<ApiFailure>
  return typeof candidate.error === 'string' && typeof candidate.httpStatus === 'number'
}

/** The Api_Client surface every feature slice depends on. */
export interface ApiClient {
  /**
   * Issues one Backend_Api request and resolves with its typed body.
   *
   * Rejects with an {@link ApiFailure} for every 400–599 response, for an
   * elapsed timeout and for a transport failure. Propagates an `AbortError`
   * untouched when the caller's own `signal` cancelled the request, so TanStack
   * Query can tell cancellation from failure.
   */
  request<M extends HttpMethod, P extends ApiPath<M>, Init extends ApiInit<M, P>>(
    method: M,
    path: P,
    ...init: ApiInitParam<Init>
  ): Promise<ApiSuccess<ApiData<M, P, Init>>>
  /**
   * `POST /auth/refresh` — the {@link SessionManagerConfig.exchangeRefreshToken}
   * implementation (Requirement 4 AC4, AC5).
   *
   * Rejects with an {@link ApiFailure}; a 4xx is what tells the Session_Manager
   * the Refresh_Token is dead (Requirement 4 AC7).
   */
  exchangeRefreshToken(refreshToken: string): Promise<TokenPair>
  /**
   * `POST /auth/logout` — the {@link SessionManagerConfig.revokeSession}
   * implementation (Requirement 4 AC9).
   */
  revokeSession(accessToken: string): Promise<void>
}

// ── Injected collaborators ────────────────────────────────────────────────────

/**
 * What the Api_Client needs from the Session_Manager: the token to attach (AC2)
 * and the 401 recovery path (AC7).
 *
 * Structural, so a test can pass a two-method stub and a `SessionManager`
 * satisfies it as-is.
 */
export interface SessionAccess {
  /** The held Access_Token, or `null`. */
  getAccessToken(): string | null
  /** One Refresh_Token exchange and, if it succeeds, one replay of `replay`. */
  onUnauthorized<T>(replay: (accessToken: string) => Promise<T>): Promise<UnauthorizedOutcome<T>>
}

/** A session, or a late-bound accessor for one that does not exist yet. */
export type SessionSource = SessionAccess | (() => SessionAccess | null) | null

/** Effects the Api_Client needs but must not reach for itself. */
export interface ApiClientConfig {
  /**
   * Where the Backend_Api is mounted. Defaults to `env.apiBaseUrl`.
   *
   * The generated paths already carry the `/api/v1` mount prefix, so a
   * configured base URL that ends in it is de-duplicated
   * ({@link resolveRequestBaseUrl}).
   */
  readonly baseUrl?: string
  /** The session whose Access_Token is attached to each request (AC2). */
  readonly session?: SessionSource
  /** The active Locale sent as `Accept-Language` (AC3). Defaults to `activeLocale()`. */
  readonly locale?: () => string
  /** `fetch` override. Defaults to `globalThis.fetch` via `openapi-fetch`. */
  readonly fetch?: (request: Request) => Promise<Response>
  /** Request budget in milliseconds (AC12). Defaults to {@link REQUEST_TIMEOUT_MS}. */
  readonly timeoutMs?: number
  /** Timer override, used for the timeout and the retry delay. Defaults to `setTimeout`. */
  readonly schedule?: Scheduler
  /** Clock override, used to resolve an HTTP-date `Retry-After`. Defaults to `Date.now`. */
  readonly now?: Clock
  /**
   * Observes every failure the caller is about to see — the hook the shell uses
   * to retain the most-recent failed Support_Reference (Requirement 21 AC11,
   * Requirement 23 AC3).
   *
   * Not called for a failure that a retry or a 401 replay went on to resolve,
   * and never called on success, so no Support_Reference can leak onto a
   * successful screen (Requirement 23 AC4). Receives an {@link ApiFailure},
   * which carries no secret material (AC13).
   */
  readonly onFailure?: (failure: ApiFailure) => void
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Requirement 3 AC12: the request budget applied to every request. */
export const REQUEST_TIMEOUT_MS = 30_000

/** `httpStatus` used for a failure that never produced a response. */
export const NO_RESPONSE_STATUS = 0

/** Request header carrying the Access_Token (AC2). */
export const AUTHORIZATION_HEADER = 'Authorization'

/** Request header carrying the active Locale (AC3). */
export const ACCEPT_LANGUAGE_HEADER = 'Accept-Language'

/** Response header exposing the retry hint of a 429 (AC10). */
export const RETRY_AFTER_HEADER = 'Retry-After'

/** The mount prefix the generated path templates already include. */
export const CONTRACT_PATH_PREFIX = '/api/v1'

/** Methods that do not mutate Backend_Api state (Requirement 21 AC9, AC10). */
const READ_METHODS: readonly HttpMethod[] = ['get', 'head', 'options', 'trace']

/** Abort reason used when the request budget elapses, distinguishing it from a caller abort. */
const TIMEOUT_REASON = 'api_client_request_timeout'

// ── Base URL reconciliation ───────────────────────────────────────────────────

/**
 * Resolves the base URL `openapi-fetch` prefixes onto a generated path.
 *
 * `VITE_API_BASE_URL` names where the Backend_Api is reachable and defaults to
 * `/api/v1` (Requirement 1 AC10), while every generated path template already
 * starts with `/api/v1`. Concatenating both would produce `/api/v1/api/v1/...`,
 * so a base URL ending in the mount prefix has it removed; anything else is used
 * as given.
 */
export function resolveRequestBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (trimmed.endsWith(CONTRACT_PATH_PREFIX)) {
    return trimmed.slice(0, trimmed.length - CONTRACT_PATH_PREFIX.length)
  }
  return trimmed
}

// ── Failure construction ──────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readDetailsString(details: unknown, key: string): string | null {
  if (!isRecord(details)) {
    return null
  }
  const value = details[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readDetailsNumber(details: unknown, key: string): number | null {
  if (!isRecord(details)) {
    return null
  }
  const value = details[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Resolves a `Retry-After` header value to whole seconds (AC10).
 *
 * Accepts both forms the header is defined with: a non-negative number of
 * seconds, or an HTTP-date, which is resolved against `nowMs` and clamped at
 * zero. An unparseable value yields `null` rather than a nonsense delay.
 */
export function parseRetryAfter(raw: string | null, nowMs: number): number | null {
  if (raw === null) {
    return null
  }
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return null
  }
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10)
  }
  const at = Date.parse(trimmed)
  if (Number.isNaN(at)) {
    return null
  }
  return Math.max(0, Math.ceil((at - nowMs) / 1000))
}

interface FailureContext {
  readonly method: HttpMethod
  readonly path: string
}

function finalizeFailure(
  decoded: ApiError,
  context: FailureContext,
  retryAfter: string | null,
  nowMs: number,
): ApiFailure {
  const upstreamService =
    decoded.error === UPSTREAM_UNAVAILABLE_ERROR ? readDetailsString(decoded.details, 'service') : null
  return Object.freeze({
    ...decoded,
    method: context.method,
    path: context.path,
    retryAfter,
    retryAfterSeconds:
      parseRetryAfter(retryAfter, nowMs) ?? readDetailsNumber(decoded.details, 'retry_after_seconds'),
    upstreamService,
    retryable: isRetryableOutcome(decoded),
  })
}

/**
 * Builds the {@link ApiFailure} for a failure that never produced a response —
 * an elapsed budget (AC12) or a transport error.
 */
function synthesizeFailure(errorKey: string, context: FailureContext): ApiFailure {
  return Object.freeze({
    error: errorKey,
    message: null,
    details: null,
    request_id: null,
    httpStatus: NO_RESPONSE_STATUS,
    supportReference: null,
    refreshEligible: false,
    authOutcome: classifyAuthOutcome(NO_RESPONSE_STATUS),
    fieldViolations: [],
    method: context.method,
    path: context.path,
    retryAfter: null,
    retryAfterSeconds: null,
    upstreamService: null,
    retryable: isRetryableOutcome({ error: errorKey }),
  })
}

// ── Construction ──────────────────────────────────────────────────────────────

/** One resolved request, as the attempt/retry loop passes it around. */
interface RequestSpec {
  readonly method: HttpMethod
  readonly path: string
  /** The `openapi-fetch` init, with the {@link ApiRequestExtras} removed. */
  readonly init: Record<string, unknown>
  readonly isMutation: boolean
  readonly allowAuthRefresh: boolean
  /** Explicit Access_Token, `null` for none, `undefined` to read the session's. */
  readonly accessToken: string | null | undefined
  readonly timeoutMs: number
}

/** A resolved attempt: either the response was a success, or it was decoded. */
type AttemptResult =
  | { readonly ok: true; readonly success: ApiSuccess<unknown> }
  | { readonly ok: false; readonly failure: ApiFailure }

/** The loosely-typed view of `openapi-fetch` used inside the implementation. */
type LooseRequest = (
  method: string,
  path: string,
  init: Record<string, unknown>,
) => Promise<{ data?: unknown; error?: unknown; response: Response }>

function resolveSession(source: SessionSource | undefined): SessionAccess | null {
  if (source == null) {
    return null
  }
  return typeof source === 'function' ? source() : source
}

/**
 * Creates the Api_Client.
 *
 * The application constructs exactly one instance — normally through
 * {@link createApiRuntime}, which also wires the Session_Manager. Tests
 * construct one per case with a stub `fetch`, a stub session and an immediate
 * scheduler.
 */
export function createApiClient(config: ApiClientConfig = {}): ApiClient {
  const baseUrl = resolveRequestBaseUrl(config.baseUrl ?? env.apiBaseUrl)
  const schedule = config.schedule ?? timeoutScheduler
  const now = config.now ?? systemClock
  const readLocale = config.locale ?? (() => activeLocale())
  const defaultTimeoutMs = config.timeoutMs ?? REQUEST_TIMEOUT_MS

  const contractClient: ContractClient = createClient<paths, MediaTypeLike>({
    baseUrl,
    ...(config.fetch === undefined ? {} : { fetch: config.fetch }),
  })
  const issue = contractClient.request as unknown as LooseRequest

  /** Waits `delayMs` on the injected timer (Requirement 21 AC9's increasing delay). */
  function wait(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      schedule(() => {
        resolve()
      }, delayMs)
    })
  }

  /**
   * The headers of one request: the active Locale on every request (AC3) and the
   * Access_Token when one is held (AC2). Caller-supplied headers take priority,
   * so a per-request override stays possible without reaching for `fetch`.
   */
  function requestHeaders(spec: RequestSpec): Headers {
    const token =
      spec.accessToken === undefined ? resolveSession(config.session)?.getAccessToken() ?? null : spec.accessToken
    const defaults: Record<string, string> = { [ACCEPT_LANGUAGE_HEADER]: readLocale() }
    if (token !== null && token.length > 0) {
      defaults[AUTHORIZATION_HEADER] = `Bearer ${token}`
    }
    return mergeHeaders(defaults, spec.init.headers as HeadersOptions | undefined)
  }

  /**
   * Issues one HTTP attempt under the request budget (AC12).
   *
   * Resolves with a decoded failure for any 400–599 response; rejects only for a
   * caller-initiated abort, which is cancellation rather than failure.
   */
  async function attempt(spec: RequestSpec): Promise<AttemptResult> {
    const context: FailureContext = { method: spec.method, path: spec.path }
    const controller = new AbortController()
    const callerSignal = spec.init.signal as AbortSignal | undefined
    let timedOut = false

    const onCallerAbort = (): void => {
      controller.abort(callerSignal?.reason)
    }
    if (callerSignal !== undefined) {
      if (callerSignal.aborted) {
        onCallerAbort()
      } else {
        callerSignal.addEventListener('abort', onCallerAbort, { once: true })
      }
    }

    const cancelTimeout: CancelScheduled = schedule(() => {
      timedOut = true
      controller.abort(TIMEOUT_REASON)
    }, spec.timeoutMs)

    try {
      const { data, error, response } = await issue(spec.method, spec.path, {
        ...spec.init,
        headers: requestHeaders(spec),
        signal: controller.signal,
      })

      if (response.ok) {
        return {
          ok: true,
          success: { data, response, supportReference: readSupportReference(response.headers) },
        }
      }

      const decoded = decodeApiError({ status: response.status, body: error, headers: response.headers })
      const retryAfter = readHeader(response.headers, RETRY_AFTER_HEADER)
      return { ok: false, failure: finalizeFailure(decoded, context, retryAfter, now()) }
    } catch (thrown) {
      if (timedOut) {
        // AC12: the budget elapsed, so there is no response to decode.
        return { ok: false, failure: synthesizeFailure(REQUEST_TIMEOUT_ERROR, context) }
      }
      if (callerSignal?.aborted === true) {
        // The caller cancelled — TanStack Query unmounting a query, for
        // instance. Cancellation is not a failure, so it propagates untouched.
        throw thrown
      }
      // A transport error, or a body the client could not read: no envelope
      // arrived, so the undecodable-response key is the honest classification
      // (AC5). Deliberately not retryable — `../lib/retry.ts` treats only the
      // outcomes the Backend_Api itself describes as transient.
      return { ok: false, failure: synthesizeFailure(UNEXPECTED_RESPONSE_ERROR, context) }
    } finally {
      cancelTimeout()
      callerSignal?.removeEventListener('abort', onCallerAbort)
    }
  }

  /** Surfaces a failure to the caller, notifying the observer exactly once. */
  function fail(failure: ApiFailure): never {
    config.onFailure?.(failure)
    throw failure
  }

  /**
   * Runs one request to a terminal outcome: the retry budget of Requirement 21
   * AC9/AC10 and the 401 refresh-and-replay path of Requirement 3 AC7.
   */
  async function send(spec: RequestSpec, retriesAttempted: number): Promise<ApiSuccess<unknown>> {
    const result = await attempt(spec)
    if (result.ok) {
      return result.success
    }
    const { failure } = result

    if (failure.refreshEligible && spec.allowAuthRefresh) {
      // AC7: a 401 is an authentication failure, so the Session_Manager gets one
      // exchange and one replay. The replay carries the token that exchange
      // produced and may not refresh again, which is what bounds the recursion.
      const session = resolveSession(config.session)
      if (session !== null) {
        const outcome = await session.onUnauthorized((accessToken) =>
          send({ ...spec, allowAuthRefresh: false, accessToken }, 0),
        )
        if (outcome.replayed) {
          return outcome.result
        }
      }
      return fail(failure)
    }

    // AC8: a 403 is an authorization denial. It reaches the caller with no
    // refresh attempted, and `shouldRetryOutcome` would refuse it anyway since
    // `not_authorized` is not a retryable outcome.
    if (shouldRetryOutcome({ isMutation: spec.isMutation, retriesAttempted, outcome: failure })) {
      await wait(retryDelayMs(retriesAttempted))
      return send(spec, retriesAttempted + 1)
    }

    return fail(failure)
  }

  /** Splits the Api_Client extras out of the init and applies their defaults. */
  function toSpec(
    method: HttpMethod,
    path: string,
    init: (ApiRequestExtras & Record<string, unknown>) | undefined,
  ): RequestSpec {
    const { isMutation, allowAuthRefresh, accessToken, timeoutMs, ...passthrough } = init ?? {}
    return {
      method,
      path,
      init: passthrough,
      isMutation: isMutation ?? !READ_METHODS.includes(method),
      allowAuthRefresh: allowAuthRefresh ?? true,
      accessToken,
      timeoutMs: timeoutMs ?? defaultTimeoutMs,
    }
  }

  function request(
    method: HttpMethod,
    path: string,
    init?: ApiRequestExtras & Record<string, unknown>,
  ): Promise<ApiSuccess<unknown>> {
    return send(toSpec(method, path, init), 0)
  }

  async function exchangeRefreshToken(refreshToken: string): Promise<TokenPair> {
    const { data } = await request('post', '/api/v1/auth/refresh', {
      body: { refresh_token: refreshToken },
      // The exchange authenticates with the Refresh_Token in the body, so no
      // Access_Token is attached, and a 401 here means that token is dead.
      accessToken: null,
      allowAuthRefresh: false,
    })
    return tokenPairFrom(data as { access_token: string; refresh_token: string })
  }

  async function revokeSession(accessToken: string): Promise<void> {
    await request('post', '/api/v1/auth/logout', { accessToken, allowAuthRefresh: false })
  }

  return {
    request: request as unknown as ApiClient['request'],
    exchangeRefreshToken,
    revokeSession,
  }
}

// ── Wiring the Api_Client to the Session_Manager ──────────────────────────────

/** Everything {@link createApiRuntime} needs beyond what the two modules supply each other. */
export type ApiRuntimeConfig = Omit<ApiClientConfig, 'session'> &
  Omit<SessionManagerConfig, 'exchangeRefreshToken' | 'revokeSession'>

/** An Api_Client and the Session_Manager it is wired to. */
export interface ApiRuntime {
  readonly api: ApiClient
  readonly session: SessionManager
}

/**
 * Builds the Api_Client and the Session_Manager and wires them to each other.
 *
 * The two are mutually dependent in behaviour but not in imports: the
 * Session_Manager receives the token exchanges the Api_Client implements, and the
 * Api_Client reads the session through a late-bound accessor, so neither module
 * needs the other's instance at module scope and no import cycle exists.
 *
 * The shell calls this once and provides the remaining effects — the TanStack
 * Query cache reset and the login redirect.
 */
export function createApiRuntime(config: ApiRuntimeConfig): ApiRuntime {
  let session: SessionManager | null = null

  const api = createApiClient({
    ...config,
    session: () => session,
  })

  session = createSessionManager({
    ...config,
    exchangeRefreshToken: (refreshToken) => api.exchangeRefreshToken(refreshToken),
    revokeSession: (accessToken) => api.revokeSession(accessToken),
  })

  return { api, session }
}
