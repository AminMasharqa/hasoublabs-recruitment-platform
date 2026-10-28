/**
 * Api_Client secret hygiene, request budget and retry clamp.
 *
 * Three behaviours the Api_Client owns and no other module can be asked to
 * guarantee:
 *
 * 1. **Secret hygiene** (Requirement 3 AC13, Requirement 23 AC7). An
 *    Access_Token, a Refresh_Token, a password, a Verification_Code, an MFA code,
 *    a national ID number and a Residency_Proof value are driven through real
 *    requests while every `console` method is spied on and every egress channel
 *    is watched. None of those values may reach the console, and none may leave
 *    the browser for anywhere other than the Backend_Api.
 * 2. **The request budget** (AC12). A 30-second timeout is armed on every
 *    request; when it elapses the request is aborted and an Error_Envelope with
 *    `error: "request_timeout"` is synthesized. A *caller* abort is
 *    cancellation, not failure, so it propagates untouched.
 * 3. **The retry clamp** (Requirement 21 AC9, AC10 as they manifest in the
 *    client). A retryable read is retried at most twice with increasing delay; a
 *    mutation is never retried; the failure observer sees only the terminal
 *    failure.
 *
 * Everything the client reaches for is injected — `fetch`, the timer, the
 * session, the Locale, the failure observer — so each case is driven with no
 * network, no fake timers and no module mocking. Requests are *recorded*, not
 * mocked away: every assertion below reads a real `Request` the client built.
 *
 * Requirements: 3.12, 3.13, 23.7.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CancelScheduled, Scheduler, UnauthorizedOutcome } from '../session/SessionManager'

import {
  createApiClient,
  isApiFailure,
  NO_RESPONSE_STATUS,
  REQUEST_TIMEOUT_MS,
  type ApiClient,
  type ApiFailure,
} from './client'

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Absolute, because `Request` cannot resolve a relative URL outside a document. */
const BASE_URL = 'https://backend.test/api/v1'

/** The single origin the Web_Client is allowed to talk to (Requirement 23 AC7). */
const BACKEND_ORIGIN = 'https://backend.test'

const ACCOUNT_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

/**
 * One representative value of every kind Requirement 3 AC13 and Requirement 23
 * AC7 name. Each is distinctive enough that a substring scan over console output
 * cannot match it by accident.
 */
const SECRETS = {
  accessToken: 'eyJhbGciOiJIUzI1NiJ9.access-3f9c1d2b7e45a018.sig',
  refreshToken: 'refresh-8c41d9e0-4b7a-4f21-9d33-55e1aa0c7b62',
  password: 'C0rrect-Horse-Battery-42!',
  verificationCode: '481902',
  mfaCode: '730514',
  nationalId: '312345678',
  residencyProof: '+972-54-8813097',
} as const

// ── Injected timer ────────────────────────────────────────────────────────────

/** One scheduled callback, as the fake timer records it. */
interface ArmedTimer {
  readonly delayMs: number
  readonly fire: () => void
  cancelled: boolean
  fired: boolean
}

/**
 * Delay boundary of the fake timer: anything below fires on its own, anything at
 * or above is held for the test to fire.
 *
 * The client arms two kinds of timer through the one injected scheduler — the
 * request budget (30 000 ms, or an override) and the retry delay (250 ms then
 * 500 ms). The retry delays fire on their own so a retrying request completes
 * without waiting in real time; the budget is held so that *elapsing* it is
 * something a test does deliberately rather than something that happens by
 * accident.
 */
const HELD_DELAY_MS = 1_000

function armTimer(armed: ArmedTimer[]): Scheduler {
  return (callback, delayMs): CancelScheduled => {
    const entry: ArmedTimer = {
      delayMs,
      cancelled: false,
      fired: false,
      fire: () => {
        if (entry.cancelled || entry.fired) {
          return
        }
        entry.fired = true
        callback()
      },
    }
    armed.push(entry)
    if (delayMs < HELD_DELAY_MS) {
      queueMicrotask(() => {
        entry.fire()
      })
    }
    return () => {
      entry.cancelled = true
    }
  }
}

/** Fires the timer armed at `delayMs`, failing the test when none is pending. */
function elapse(armed: readonly ArmedTimer[], delayMs: number): void {
  const pending = armed.find((entry) => entry.delayMs === delayMs && !entry.fired && !entry.cancelled)
  expect(pending, `no timer is armed at ${delayMs}ms`).toBeDefined()
  pending?.fire()
}

/**
 * Lets every pending continuation run.
 *
 * A retried request advances through a chain of microtasks — the abort, the
 * rejected `fetch`, the synthesized failure, the retry decision, the retry delay
 * — before the next attempt arms its budget, so a test that elapses one budget
 * per attempt has to yield the queue in between. A zero-delay macrotask drains
 * the whole microtask queue, which is exactly that.
 */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

/** The delays of the timers the retry path waited on, in the order they were armed. */
function retryDelays(armed: readonly ArmedTimer[]): number[] {
  return armed.filter((entry) => entry.delayMs < HELD_DELAY_MS).map((entry) => entry.delayMs)
}

// ── Injected transport ────────────────────────────────────────────────────────

/** Answers one attempt. `attempt` is 0 for the first request, 1 for the first retry, … */
type Responder = (request: Request, attempt: number) => Response

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/** What `fetch` rejects with when a request is aborted. */
function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError')
}

// ── Harness ───────────────────────────────────────────────────────────────────

interface HarnessOptions {
  /** Answers each attempt. Omitted: the request hangs until it is aborted. */
  readonly respond?: Responder
  /** The Access_Token the stub session holds. */
  readonly accessToken?: string | null
  /** Client-wide budget override. */
  readonly timeoutMs?: number
}

interface Harness {
  readonly api: ApiClient
  /** Every `Request` the injected `fetch` saw, in order. */
  readonly requests: Request[]
  readonly armed: ArmedTimer[]
  /** Failures the `onFailure` observer was notified of. */
  readonly failures: ApiFailure[]
  /** How many times the 401 path asked the Session_Manager to refresh. */
  readonly refreshes: () => number
}

function harness(options: HarnessOptions = {}): Harness {
  const requests: Request[] = []
  const armed: ArmedTimer[] = []
  const failures: ApiFailure[] = []
  let refreshes = 0

  const fetchImpl = (request: Request): Promise<Response> => {
    const attempt = requests.length
    requests.push(request)
    const { respond } = options
    if (respond !== undefined) {
      return Promise.resolve(respond(request, attempt))
    }
    // No responder: hang until the client (or the caller) aborts, which is what
    // a request that outlives its budget looks like from the socket's side.
    return new Promise<Response>((_resolve, reject) => {
      const onAbort = (): void => {
        reject(abortError())
      }
      if (request.signal.aborted) {
        onAbort()
        return
      }
      request.signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  const api = createApiClient({
    baseUrl: BASE_URL,
    locale: () => 'ar',
    session: {
      getAccessToken: () => options.accessToken ?? null,
      onUnauthorized: <T,>(): Promise<UnauthorizedOutcome<T>> => {
        refreshes += 1
        return Promise.resolve({ replayed: false, refresh: { status: 'no-session' } })
      },
    },
    fetch: fetchImpl,
    schedule: armTimer(armed),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    onFailure: (failure) => {
      failures.push(failure)
    },
  })

  return { api, requests, armed, failures, refreshes: () => refreshes }
}

/** Settles a request without ever leaving an unhandled rejection behind. */
function settle(pending: Promise<unknown>): Promise<unknown> {
  return pending.catch((thrown: unknown) => thrown)
}

/** Asserts the thrown value is an {@link ApiFailure} and narrows it. */
function asFailure(thrown: unknown): ApiFailure {
  expect(isApiFailure(thrown), `expected an ApiFailure, got ${String(thrown)}`).toBe(true)
  return thrown as ApiFailure
}

// ── Deep scanning ─────────────────────────────────────────────────────────────

/**
 * Every primitive reachable from `value`, rendered for substring scanning.
 *
 * Walks arrays, plain objects, `Map`, `Set`, `Error` (including `cause`) and the
 * web types a console argument might be — `Headers`, `Request`, `Response` —
 * because their interesting state lives behind accessors rather than in
 * enumerable properties, so `JSON.stringify` alone would report an empty object
 * and a secret could hide there. Parts are joined with a newline so no match can
 * straddle two unrelated values.
 */
function renderDeep(value: unknown): string {
  const parts: string[] = []
  const seen = new WeakSet<object>()

  const walk = (current: unknown): void => {
    if (current === null || current === undefined) {
      parts.push(String(current))
      return
    }
    if (typeof current === 'function') {
      parts.push(current.name)
      return
    }
    if (typeof current !== 'object') {
      parts.push(String(current))
      return
    }
    if (seen.has(current)) {
      return
    }
    seen.add(current)

    if (current instanceof Headers) {
      for (const [name, headerValue] of current.entries()) {
        parts.push(name, headerValue)
      }
      return
    }
    if (current instanceof Request) {
      parts.push(current.method, current.url)
      walk(current.headers)
      return
    }
    if (current instanceof Response) {
      parts.push(String(current.status), current.url)
      walk(current.headers)
      return
    }
    if (current instanceof Error) {
      parts.push(current.name, current.message, current.stack ?? '')
      walk((current as { cause?: unknown }).cause)
      return
    }
    if (current instanceof Map) {
      for (const [key, entry] of current) {
        walk(key)
        walk(entry)
      }
      return
    }
    if (current instanceof Set || Array.isArray(current)) {
      for (const entry of current as Iterable<unknown>) {
        walk(entry)
      }
      return
    }
    for (const [key, entry] of Object.entries(current)) {
      parts.push(key)
      walk(entry)
    }
  }

  walk(value)
  return parts.join('\n')
}

/** Asserts no sensitive value is reachable from `value`, by any route. */
function expectNoSecrets(value: unknown, what: string): void {
  const rendered = renderDeep(value)
  let serialized = ''
  try {
    serialized = JSON.stringify(value) ?? ''
  } catch {
    serialized = ''
  }
  for (const [name, secret] of Object.entries(SECRETS)) {
    expect(rendered, `${what} exposes the ${name}`).not.toContain(secret)
    expect(serialized, `${what} serializes the ${name}`).not.toContain(secret)
  }
}

// ── Console capture ───────────────────────────────────────────────────────────

/**
 * Every writing method of the console. Over-inclusive on purpose: AC13 is about
 * *the console*, not about `console.log`, so a hypothetical
 * `console.table({ token })` has to be caught as surely as a plain log line.
 */
const CONSOLE_METHODS = [
  'log',
  'info',
  'warn',
  'error',
  'debug',
  'trace',
  'dir',
  'dirxml',
  'table',
  'group',
  'groupCollapsed',
  'groupEnd',
  'assert',
  'count',
  'countReset',
  'time',
  'timeEnd',
  'timeLog',
] as const

interface ConsoleCall {
  readonly method: string
  readonly args: readonly unknown[]
}

/**
 * Spies on every console method, recording the arguments instead of writing them.
 *
 * `restoreMocks` in the Vitest configuration puts the real methods back after
 * each test. The console is reached through `globalThis` rather than the bare
 * `console` identifier so that the `no-console` rule the Build_Pipeline enforces
 * over `src/api/**` stays satisfied: this file asserts *about* console output,
 * it never produces any.
 */
function captureConsole(): { readonly calls: readonly ConsoleCall[]; readonly methods: readonly string[] } {
  const target = globalThis.console as unknown as Record<string, (...args: unknown[]) => void>
  const calls: ConsoleCall[] = []
  const methods: string[] = []
  for (const method of CONSOLE_METHODS) {
    if (typeof target[method] !== 'function') {
      continue
    }
    methods.push(method)
    vi.spyOn(target, method).mockImplementation((...args: unknown[]) => {
      calls.push({ method, args })
    })
  }
  return { calls, methods }
}

// ── Egress guard ──────────────────────────────────────────────────────────────

/**
 * Watches the egress channels a browser offers besides the injected `fetch`.
 *
 * Requirement 23 AC7 is a statement about destinations, so it is not enough that
 * the recorded Backend_Api requests look right: nothing may go anywhere else
 * *at all*. The global `fetch`, `XMLHttpRequest` and `sendBeacon` are the three
 * channels available in this environment; each must stay untouched.
 */
function guardEgress(): { readonly assertSilent: () => void } {
  const assertions: (() => void)[] = []

  const fetchSpy = vi.spyOn(globalThis, 'fetch')
  assertions.push(() => {
    expect(fetchSpy, 'the global fetch was used instead of the injected one').not.toHaveBeenCalled()
  })

  if (typeof XMLHttpRequest === 'function') {
    const openSpy = vi.spyOn(XMLHttpRequest.prototype, 'open')
    assertions.push(() => {
      expect(openSpy, 'an XMLHttpRequest was opened').not.toHaveBeenCalled()
    })
  }

  const beaconTarget = navigator as Navigator & { sendBeacon?: (url: string) => boolean }
  if (typeof beaconTarget.sendBeacon === 'function') {
    const beaconSpy = vi.spyOn(beaconTarget, 'sendBeacon')
    assertions.push(() => {
      expect(beaconSpy, 'a beacon was sent').not.toHaveBeenCalled()
    })
  }

  return {
    assertSilent: () => {
      for (const assertion of assertions) {
        assertion()
      }
    },
  }
}

/** Asserts every recorded request went to the Backend_Api and nowhere else. */
function expectBackendOnly(requests: readonly Request[]): void {
  expect(requests.length).toBeGreaterThan(0)
  for (const request of requests) {
    const url = new URL(request.url)
    expect(url.origin, `request to ${request.url} left the Backend_Api origin`).toBe(BACKEND_ORIGIN)
    expect(url.pathname.startsWith('/api/v1/'), `unexpected path ${url.pathname}`).toBe(true)
  }
}

// ── Driving every kind of sensitive value ─────────────────────────────────────

/**
 * Issues one request for each kind of sensitive value, half of them failing.
 *
 * Both outcomes matter: a success must not log the credential it carried, and a
 * failure must not carry it into the thrown value that a rendering-error overlay
 * or an unhandled-rejection handler could print.
 */
async function driveSecretCarryingRequests(api: ApiClient): Promise<unknown[]> {
  const outcomes: unknown[] = []

  // Password and MFA code, refused.
  outcomes.push(
    await settle(
      api.request('post', '/api/v1/auth/login', {
        body: {
          email: 'candidate@example.test',
          password: SECRETS.password,
          mfa_code: SECRETS.mfaCode,
          role: 'CANDIDATE',
        },
      }),
    ),
  )

  // Verification_Code, refused as a validation failure.
  outcomes.push(
    await settle(
      api.request('post', '/api/v1/verify/code', {
        body: { account_id: ACCOUNT_ID, code: SECRETS.verificationCode },
      }),
    ),
  )

  // Residency_Proof value (a mobile phone number), refused.
  outcomes.push(
    await settle(
      api.request('post', '/api/v1/register/candidate', {
        body: {
          email: 'candidate@example.test',
          full_name: 'Test Candidate',
          language_preference: 'ar',
          link_token: 'link-token-value',
          password: SECRETS.password,
          residency_proof_type: 'MobilePhone',
          residency_proof_value: SECRETS.residencyProof,
          role: 'CANDIDATE',
        },
      }),
    ),
  )

  // Residency_Proof value (a national ID number), refused.
  outcomes.push(
    await settle(
      api.request('post', '/api/v1/register/senior', {
        body: {
          email: 'senior@example.test',
          full_name: 'Test Senior',
          language_preference: 'en',
          link_token: 'link-token-value',
          password: SECRETS.password,
          residency_proof_type: 'NationalId',
          residency_proof_value: SECRETS.nationalId,
          role: 'SENIOR',
        },
      }),
    ),
  )

  // Refresh_Token, refused — the dead-token case.
  outcomes.push(await settle(api.exchangeRefreshToken(SECRETS.refreshToken)))

  // Access_Token on a successful read.
  outcomes.push(await settle(api.request('get', '/api/v1/me/status')))

  // Access_Token on a successful mutation, passed explicitly.
  outcomes.push(await settle(api.revokeSession(SECRETS.accessToken)))

  return outcomes
}

/** Answers each secret-carrying request: refusals that echo nothing back. */
const secretScenario: Responder = (request) => {
  const { pathname } = new URL(request.url)
  if (pathname.endsWith('/auth/login')) {
    return json({ error: 'invalid_credentials', message: 'Email or password is incorrect' }, 401)
  }
  if (pathname.endsWith('/verify/code')) {
    return json(
      {
        error: 'validation_failed',
        message: 'The code is not valid',
        details: [{ path: 'code', code: 'code_mismatch', message: 'Incorrect code' }],
      },
      422,
    )
  }
  if (pathname.endsWith('/register/candidate') || pathname.endsWith('/register/senior')) {
    return json({ error: 'conflicting_state', message: 'That email is already registered' }, 409)
  }
  if (pathname.endsWith('/auth/refresh')) {
    return json({ error: 'invalid_token', message: 'The refresh token is no longer valid' }, 401)
  }
  if (pathname.endsWith('/auth/logout')) {
    return new Response(null, { status: 204 })
  }
  return json({ status: 'Approved', next_step: null }, 200, { 'X-Request-ID': 'req-ok' })
}

afterEach(() => {
  // Nothing sensitive may have been parked in storage on the way past, either.
  expect(localStorage.length).toBe(0)
  expect(sessionStorage.length).toBe(0)
})

// ── Secret hygiene (AC13, Requirement 23 AC7) ─────────────────────────────────

describe('Api_Client secret hygiene', () => {
  it('detects a planted secret on every console method and behind an opaque value', () => {
    // A negative control. Every assertion in this describe block is an assertion
    // that something did *not* happen, so each one would also pass if the spy
    // observed nothing and the scanner matched nothing. This case plants what the
    // others forbid and proves both halves react.
    const captured = captureConsole()
    const target = globalThis.console as unknown as Record<string, (...args: unknown[]) => void>

    for (const method of captured.methods) {
      target[method]?.('planted', { token: SECRETS.accessToken })
    }

    expect(captured.calls).toHaveLength(captured.methods.length)
    expect(captured.methods.length).toBeGreaterThanOrEqual(CONSOLE_METHODS.length - 2)
    expect(() => {
      expectNoSecrets(captured.calls, 'the planted console output')
    }).toThrow()

    // And the walk reaches state that `JSON.stringify` alone reports as `{}`.
    const headers = new Headers({ Authorization: `Bearer ${SECRETS.accessToken}` })
    expect(JSON.stringify([headers])).toBe('[{}]')
    expect(() => {
      expectNoSecrets([headers], 'a planted header')
    }).toThrow()
  })

  it('writes no sensitive value — and nothing at all — to the console (AC13)', async () => {
    const console = captureConsole()
    const { api } = harness({ respond: secretScenario, accessToken: SECRETS.accessToken })

    await driveSecretCarryingRequests(api)

    expectNoSecrets(console.calls, 'console output')
    // The Api_Client holds no logger at all, so the record is not merely
    // secret-free, it is empty. Asserting that is what makes the case fail the
    // moment a diagnostic `console.log` is added anywhere on the request path.
    expect(console.calls).toEqual([])
  })

  it('keeps sensitive values out of every thrown failure (AC13)', async () => {
    const { api } = harness({ respond: secretScenario, accessToken: SECRETS.accessToken })

    const outcomes = await driveSecretCarryingRequests(api)
    const failures = outcomes.filter((outcome) => isApiFailure(outcome))

    // Login, verify, both registrations and the refresh exchange were refused.
    expect(failures).toHaveLength(5)
    for (const failure of failures) {
      expectNoSecrets(failure, `the ${failure.error} failure`)
    }
    expectNoSecrets(outcomes, 'the set of request outcomes')
  })

  it('carries only the decoded envelope and the request identifiers (AC13)', async () => {
    const { api } = harness({ respond: secretScenario, accessToken: SECRETS.accessToken })

    const thrown = await settle(
      api.request('post', '/api/v1/auth/login', {
        body: { email: 'candidate@example.test', password: SECRETS.password, role: 'CANDIDATE' },
      }),
    )

    // An exhaustive key list, so a future member that copied a body, a header or
    // a token onto the failure would fail this case rather than pass unnoticed.
    expect(Object.keys(asFailure(thrown)).sort()).toEqual(
      [
        'authOutcome',
        'details',
        'error',
        'fieldViolations',
        'httpStatus',
        'message',
        'method',
        'path',
        'refreshEligible',
        'request_id',
        'retryAfter',
        'retryAfterSeconds',
        'retryable',
        'supportReference',
        'upstreamService',
      ].sort(),
    )
  })

  it('sends sensitive values to the Backend_Api and to no other destination (Req 23 AC7)', async () => {
    const egress = guardEgress()
    const { api, requests } = harness({ respond: secretScenario, accessToken: SECRETS.accessToken })

    await driveSecretCarryingRequests(api)

    expect(requests).toHaveLength(7)
    expectBackendOnly(requests)
    egress.assertSilent()
  })

  it('attaches the Access_Token to the Backend_Api request and nowhere else (Req 23 AC7)', async () => {
    const { api, requests } = harness({ respond: secretScenario, accessToken: SECRETS.accessToken })

    await settle(api.request('get', '/api/v1/me/status'))

    const sent = requests[0]
    expect(sent?.headers.get('Authorization')).toBe(`Bearer ${SECRETS.accessToken}`)
    expect(new URL(sent?.url ?? '').origin).toBe(BACKEND_ORIGIN)
    // The URL is the part of a request that ends up in a referrer, a proxy log or
    // a browser history entry, so no credential may be encoded into it.
    expectNoSecrets(sent?.url, 'the request URL')
  })
})

// ── The request budget (AC12) ─────────────────────────────────────────────────

describe('Api_Client request budget', () => {
  it('arms every request with the 30-second budget and releases it on completion (AC12)', async () => {
    const { api, armed } = harness({ respond: () => json({ items: [] }, 200) })

    await api.request('get', '/api/v1/skills', { params: { query: { q: 'sql' } } })

    expect(REQUEST_TIMEOUT_MS).toBe(30_000)
    const budgets = armed.filter((entry) => entry.delayMs === REQUEST_TIMEOUT_MS)
    expect(budgets).toHaveLength(1)
    // Cancelled rather than left pending: a completed request must not hold a
    // timer that could abort a later one.
    expect(budgets[0]?.cancelled).toBe(true)
    expect(budgets[0]?.fired).toBe(false)
  })

  it('synthesizes request_timeout when the budget elapses (AC12)', async () => {
    const { api, armed, requests, failures } = harness()

    const settled = settle(
      api.request('post', '/api/v1/verify/resend', { body: { account_id: ACCOUNT_ID } }),
    )
    elapse(armed, REQUEST_TIMEOUT_MS)
    const failure = asFailure(await settled)

    expect(failure.error).toBe('request_timeout')
    expect(failure.httpStatus).toBe(NO_RESPONSE_STATUS)
    expect(failure.httpStatus).toBe(0)
    // No response arrived, so there is nothing to decode and nothing to quote.
    expect(failure.message).toBeNull()
    expect(failure.details).toBeNull()
    expect(failure.supportReference).toBeNull()
    expect(failure.refreshEligible).toBe(false)
    expect(failure.method).toBe('post')
    expect(failure.path).toBe('/api/v1/verify/resend')
    // A timeout is transient by nature, which is what makes a read worth retrying.
    expect(failure.retryable).toBe(true)
    expect(failures).toEqual([failure])
    // The budget aborts the request rather than abandoning it, so the socket is
    // released instead of being left to complete unobserved.
    expect(requests[0]?.signal.aborted).toBe(true)
  })

  it('honours a per-request timeout override (AC12)', async () => {
    const { api, armed } = harness()
    const override = 5_000

    const settled = settle(
      api.request('post', '/api/v1/verify/resend', {
        body: { account_id: ACCOUNT_ID },
        timeoutMs: override,
      }),
    )

    expect(armed.map((entry) => entry.delayMs)).toEqual([override])
    elapse(armed, override)
    expect(asFailure(await settled).error).toBe('request_timeout')
  })

  it('applies a client-wide budget override to every request (AC12)', async () => {
    const { api, armed } = harness({ respond: () => json({ items: [] }, 200), timeoutMs: 8_000 })

    await api.request('get', '/api/v1/skills', { params: { query: { q: 'sql' } } })

    expect(armed.map((entry) => entry.delayMs)).toEqual([8_000])
  })

  it('propagates a caller abort as cancellation rather than as a failure (AC12)', async () => {
    const { api, armed, failures } = harness()
    const controller = new AbortController()

    const settled = settle(api.request('get', '/api/v1/me/status', { signal: controller.signal }))
    controller.abort()
    const thrown = await settled

    expect(isApiFailure(thrown)).toBe(false)
    expect(thrown).toBeInstanceOf(DOMException)
    expect((thrown as DOMException).name).toBe('AbortError')
    // Cancellation is not a failure: no Error_Envelope is synthesized, so the
    // observer that retains the most-recent failed Support_Reference stays quiet.
    expect(failures).toEqual([])
    // And the budget timer is released rather than left to fire later.
    expect(armed.every((entry) => entry.cancelled || entry.fired)).toBe(true)
  })

  it('classifies a transport failure as unexpected_response, not as a timeout (AC12)', async () => {
    const { api, requests } = harness({
      respond: () => {
        throw new TypeError('Failed to fetch')
      },
    })

    const failure = asFailure(await settle(api.request('get', '/api/v1/me/status')))

    expect(failure.error).toBe('unexpected_response')
    expect(failure.httpStatus).toBe(NO_RESPONSE_STATUS)
    // Not retryable, so the transport error is surfaced on the first attempt
    // rather than spending the read budget on a request that never reached the
    // Backend_Api.
    expect(failure.retryable).toBe(false)
    expect(requests).toHaveLength(1)
  })
})

// ── The retry clamp (Requirement 21 AC9, AC10) ────────────────────────────────

describe('Api_Client retry clamp', () => {
  it('retries a retryable read at most twice, with increasing delay', async () => {
    const { api, armed, requests, failures } = harness({
      respond: () => json({ error: 'upstream_unavailable', details: { service: 'clamav' } }, 503),
    })

    const failure = asFailure(await settle(api.request('get', '/api/v1/me/status')))

    expect(requests).toHaveLength(3)
    expect(retryDelays(armed)).toEqual([250, 500])
    expect(retryDelays(armed)[1]).toBeGreaterThan(retryDelays(armed)[0] ?? 0)
    expect(failure.error).toBe('upstream_unavailable')
    expect(failure.upstreamService).toBe('clamav')
    // One notification for the terminal failure; the two retried attempts are
    // the client's business, not the shell's.
    expect(failures).toHaveLength(1)
    expect(failures[0]).toBe(failure)
  })

  it('never retries a mutation, however retryable the outcome', async () => {
    const { api, armed, requests, failures } = harness({
      respond: () => json({ error: 'upstream_unavailable', details: { service: 'clamav' } }, 503),
    })

    const failure = asFailure(
      await settle(api.request('post', '/api/v1/verify/resend', { body: { account_id: ACCOUNT_ID } })),
    )

    expect(requests).toHaveLength(1)
    expect(retryDelays(armed)).toEqual([])
    expect(failure.retryable).toBe(true)
    expect(failures).toHaveLength(1)
  })

  it('retries a read that keeps timing out at most twice (AC12, AC9)', async () => {
    const { api, armed, requests } = harness()

    const settled = settle(api.request('get', '/api/v1/me/status'))
    for (let attempt = 0; attempt < 3; attempt += 1) {
      // Each attempt arms its own budget; elapsing all three exhausts the retries.
      await flush()
      elapse(armed, REQUEST_TIMEOUT_MS)
    }
    const failure = asFailure(await settled)

    expect(failure.error).toBe('request_timeout')
    expect(requests).toHaveLength(3)
    expect(retryDelays(armed)).toEqual([250, 500])
  })

  it('does not retry a non-retryable read', async () => {
    const { api, armed, requests, failures } = harness({
      respond: () => json({ error: 'internal_error', message: 'Something broke' }, 500),
    })

    const failure = asFailure(await settle(api.request('get', '/api/v1/me/status')))

    expect(requests).toHaveLength(1)
    expect(retryDelays(armed)).toEqual([])
    expect(failure.retryable).toBe(false)
    expect(failures).toHaveLength(1)
  })

  it('notifies the observer only for the terminal outcome, never for a recovered attempt', async () => {
    const { api, requests, failures } = harness({
      respond: (_request, attempt) =>
        attempt < 2
          ? json({ error: 'upstream_unavailable', details: { service: 'clamav' } }, 503)
          : json({ status: 'Approved', next_step: null }, 200, { 'X-Request-ID': 'req-ok' }),
    })

    const result = await api.request('get', '/api/v1/me/status')

    expect(requests).toHaveLength(3)
    expect(result.supportReference).toBe('req-ok')
    // The two failed attempts were recovered from, so nothing was surfaced: a
    // Support_Reference must not reach a screen that ended up succeeding.
    expect(failures).toEqual([])
  })

  it('does not retry a 429, whose Retry-After the user is shown instead', async () => {
    const { api, armed, requests } = harness({
      respond: () => json({ error: 'rate_limited' }, 429, { 'Retry-After': '30' }),
    })

    const failure = asFailure(await settle(api.request('get', '/api/v1/me/status')))

    expect(requests).toHaveLength(1)
    expect(retryDelays(armed)).toEqual([])
    expect(failure.retryAfterSeconds).toBe(30)
  })

  it('leaves the 401 refresh path outside the retry budget', async () => {
    const { api, armed, requests, refreshes } = harness({
      respond: () => json({ error: 'invalid_token' }, 401),
      accessToken: SECRETS.accessToken,
    })

    const failure = asFailure(await settle(api.request('get', '/api/v1/me/status')))

    expect(failure.refreshEligible).toBe(true)
    // One exchange attempt, no replay (the stub session holds no Refresh_Token)
    // and no retry: a 401 is an authentication failure, not a transient one.
    expect(refreshes()).toBe(1)
    expect(requests).toHaveLength(1)
    expect(retryDelays(armed)).toEqual([])
  })
})
