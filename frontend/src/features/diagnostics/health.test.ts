/**
 * Unit tests for the `GET /health` probe (Requirement 23 AC6) and the bundle
 * version identifier (Requirement 23 AC5).
 *
 * The probe is exercised against a real {@link createApiClient} over a stub
 * `fetch`, not against a stubbed Api_Client: the two things worth proving here
 * are that the probe reaches `/health` at the origin root rather than under the
 * `/api/v1` mount prefix, and that it carries no `Authorization` header. Both are
 * properties of the composition of this module with the Api_Client's base-URL
 * handling, so a stub in between would assert nothing.
 */

import { describe, expect, it } from 'vitest'

import { createApiClient, type SessionAccess } from '../../api/client'
import type { CancelScheduled, Scheduler, UnauthorizedOutcome } from '../../session/SessionManager'

import { bundleVersion, BUNDLE_VERSION_ENV_KEY, normalizeBundleVersion } from './bundleVersion'
import { fetchHealth, healthIndicator, HEALTH_PATH, readHealthStatus } from './health'

// ── Harness ───────────────────────────────────────────────────────────────────

/**
 * A scheduler that fires the retry delays (250 ms, 500 ms) immediately and holds
 * the 30-second request budget, so a retrying request completes without waiting
 * in real time and without the budget elapsing by accident.
 */
const HELD_DELAY_MS = 1_000

const fastRetries: Scheduler = (callback, delayMs): CancelScheduled => {
  if (delayMs < HELD_DELAY_MS) {
    queueMicrotask(callback)
  }
  return () => undefined
}

/** A session holding a token that refuses to refresh. */
function sessionHolding(accessToken: string): SessionAccess {
  return {
    getAccessToken: () => accessToken,
    onUnauthorized: <T,>(): Promise<UnauthorizedOutcome<T>> =>
      Promise.resolve({ replayed: false, refresh: { status: 'no-session' } }),
  }
}

interface Capture {
  readonly requests: Request[]
  readonly fetch: (request: Request) => Promise<Response>
}

/** A `fetch` stub that records every request and answers with `body`. */
function respondWith(body: unknown, status = 200): Capture {
  const requests: Request[] = []
  return {
    requests,
    fetch: (request: Request) => {
      requests.push(request)
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    },
  }
}

// ── Bundle version (AC5) ──────────────────────────────────────────────────────

describe('bundle version identifier (Req 23 AC5)', () => {
  it('reports a recorded identifier verbatim, trimming only surrounding whitespace', () => {
    expect(normalizeBundleVersion('  1.4.2+1a2b3c4\n')).toBe('1.4.2+1a2b3c4')
    expect(bundleVersion({ [BUNDLE_VERSION_ENV_KEY]: '1.4.2+1a2b3c4' })).toBe('1.4.2+1a2b3c4')
  })

  it('reports absence rather than inventing a placeholder', () => {
    expect(normalizeBundleVersion(undefined)).toBeNull()
    expect(normalizeBundleVersion('   ')).toBeNull()
    expect(normalizeBundleVersion(42)).toBeNull()
    expect(bundleVersion({})).toBeNull()
  })
})

// ── Status decoding (AC6) ─────────────────────────────────────────────────────

describe('health status decoding (Req 23 AC6)', () => {
  it('reads the reported status byte-identically', () => {
    expect(readHealthStatus({ status: 'ok' })).toBe('ok')
    // Inner whitespace and casing belong to the service, not to this client.
    expect(readHealthStatus({ status: 'DEGRADED ' })).toBe('DEGRADED ')
  })

  it('reports no status for a body that carries none, rather than throwing', () => {
    expect(readHealthStatus(null)).toBeNull()
    expect(readHealthStatus('ok')).toBeNull()
    expect(readHealthStatus([{ status: 'ok' }])).toBeNull()
    expect(readHealthStatus({ status: 7 })).toBeNull()
    expect(readHealthStatus({ status: '  ' })).toBeNull()
  })

  it('classifies a reported status case-insensitively', () => {
    expect(healthIndicator('ok')).toBe('healthy')
    expect(healthIndicator(' OK ')).toBe('healthy')
    expect(healthIndicator('degraded')).toBe('other')
    expect(healthIndicator(null)).toBe('unknown')
  })
})

// ── The request the probe issues (AC6, Req 3 AC1) ─────────────────────────────

describe('the health probe request', () => {
  it('reaches /health at the origin root, not under the /api/v1 mount prefix', async () => {
    const capture = respondWith({ status: 'ok' })
    const api = createApiClient({
      baseUrl: 'https://api.example.test/api/v1',
      fetch: capture.fetch,
    })

    const report = await fetchHealth(api)

    expect(report).toEqual({ status: 'ok', indicator: 'healthy' })
    expect(capture.requests).toHaveLength(1)
    expect(capture.requests[0]?.url).toBe(`https://api.example.test${HEALTH_PATH}`)
  })

  it('carries the active Locale but no Authorization header', async () => {
    const capture = respondWith({ status: 'ok' })
    const api = createApiClient({
      baseUrl: 'https://api.example.test/api/v1',
      fetch: capture.fetch,
      locale: () => 'he',
      // A held token must still not be put on the wire for an unauthenticated probe.
      session: sessionHolding('access-token'),
    })

    await fetchHealth(api)

    const request = capture.requests[0]
    expect(request?.headers.get('Accept-Language')).toBe('he')
    expect(request?.headers.get('Authorization')).toBeNull()
  })

  it('rejects with the decoded Error_Envelope when the probe fails', async () => {
    const capture = respondWith({ error: 'upstream_unavailable', details: { service: 'db' } }, 503)
    const api = createApiClient({
      baseUrl: 'https://api.example.test/api/v1',
      fetch: capture.fetch,
      // A retryable 503 is retried twice; the delays fire immediately.
      schedule: fastRetries,
    })

    await expect(fetchHealth(api)).rejects.toMatchObject({
      error: 'upstream_unavailable',
      httpStatus: 503,
      upstreamService: 'db',
    })
  })
})
