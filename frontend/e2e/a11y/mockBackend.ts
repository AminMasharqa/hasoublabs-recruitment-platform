/**
 * A generic Backend_Api stand-in for the accessibility gate (Requirement 20
 * AC13).
 *
 * `axe-core` needs every route rendered in a stable, error-free state — it does
 * not need realistic business data. So rather than standing up a real
 * Backend_Api (task 27's concern, for the journey suite) this module intercepts
 * every `**\/api/v1/**` call the running Web_Client issues and answers it with a
 * small, generic response chosen from the request's method and path:
 *
 * - a handful of endpoints the session lifecycle and the Route_Guard depend on
 *   (`POST /auth/login`, `GET /me/status`, `GET /health`, `POST /auth/logout`)
 *   get an exact, contract-shaped answer, because Requirement 7 AC1's gate and
 *   Requirement 4 AC2's session establishment have to succeed before any
 *   guarded route can render at all;
 * - every other `GET` gets an empty, well-formed collection or object, which is
 *   enough for a screen's loading state to resolve into its empty state
 *   (Requirement 21 AC7) — itself a state the gate has to cover, not one it can
 *   skip;
 * - every other mutation (`POST`/`PUT`/`PATCH`/`DELETE`) gets a `204`, since no
 *   scanned route triggers one from a fresh page load.
 *
 * This keeps the fixture small and, importantly, keeps it from drifting out of
 * sync with any one feature's response shape: a screen that reads a field this
 * fixture does not set falls back to its own empty/undefined handling, which is
 * exactly the state Requirement 21 AC6/AC7 already requires it to render
 * accessibly.
 */

import type { Page, Route } from '@playwright/test'

import type { AccountStatus, Role } from '../../src/api/enums'

// ── Access_Token minting ───────────────────────────────────────────────────────

function base64Url(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/**
 * An unsigned Access_Token carrying the claims `src/lib/refresh.ts` decodes.
 *
 * The Web_Client never verifies the signature (see that module's own note), so a
 * `sig` literal is enough to exercise the real decoding path with a real JWT
 * shape.
 */
export function mintAccessToken(roles: readonly Role[], act: Role, accountId = 'e2e-account'): string {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const claims = base64Url(
    JSON.stringify({
      sub: accountId,
      roles,
      act,
      session_id: 'e2e-session',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  )
  return `${header}.${claims}.sig`
}

// ── Per-role fixtures ──────────────────────────────────────────────────────────

/** One signed-in identity the a11y gate scans routes as. */
export interface MockIdentity {
  readonly id: string
  readonly email: string
  readonly password: string
  readonly loginRole: Role
  readonly roles: readonly Role[]
  readonly act: Role
}

export const CANDIDATE_IDENTITY: MockIdentity = Object.freeze({
  id: 'candidate',
  email: 'candidate@example.test',
  password: 'correct-horse-battery',
  loginRole: 'CANDIDATE',
  roles: ['CANDIDATE'] as const,
  act: 'CANDIDATE',
})

export const SENIOR_IDENTITY: MockIdentity = Object.freeze({
  id: 'senior',
  email: 'senior@example.test',
  password: 'correct-horse-battery',
  loginRole: 'SENIOR',
  roles: ['SENIOR'] as const,
  act: 'SENIOR',
})

export const ADMIN_IDENTITY: MockIdentity = Object.freeze({
  id: 'admin',
  email: 'admin@example.test',
  password: 'correct-horse-battery',
  loginRole: 'ADMIN',
  roles: ['ADMIN'] as const,
  act: 'ADMIN',
})

export const MOCK_IDENTITIES: readonly MockIdentity[] = Object.freeze([
  CANDIDATE_IDENTITY,
  SENIOR_IDENTITY,
  ADMIN_IDENTITY,
])

// ── Generic response shaping ───────────────────────────────────────────────────

function jsonBody(body: unknown): { status: number; contentType: string; body: string } {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) }
}

/**
 * A generic paginated-list shape wide enough for the list screens' empty state:
 * `items`, and every "is there a next page" spelling used across the contract
 * (`next_cursor`, `has_next`, `meta.has_more`/`meta.next_after_id`) resolved to
 * "no further page" (Requirement 21 AC7, `src/lib/cursor.ts`).
 */
function emptyListBody(): unknown {
  return {
    items: [],
    next_cursor: null,
    has_next: false,
    meta: { has_more: false, next_after_id: null },
  }
}

function findIdentity(body: string): MockIdentity | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(body.length === 0 ? '{}' : body)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }
  const email = (parsed as Record<string, unknown>).email
  return MOCK_IDENTITIES.find((identity) => identity.email === email) ?? null
}

/** Options narrowing the generic mock backend for one scanned route. */
export interface MockBackendOptions {
  /**
   * The `status` member `GET /me/status` answers with (Req 7 AC1).
   *
   * Defaults to `Approved`, which is what every feature route needs to render
   * past the Requirement 7 AC2 gate. The onboarding group is scanned with a
   * non-`Approved` value instead, so `/status` itself renders directly rather
   * than the guard redirecting an already-approved session away from it.
   */
  readonly accountStatus?: AccountStatus
}

/**
 * Installs the mock Backend_Api on every `**\/api/v1/**` request the page issues.
 *
 * One route handler for the whole prefix, dispatching by method and pathname —
 * matching the same "intercept and answer by pathname" convention the unit tests
 * already use for their own `fetch` stand-ins (e.g. `AppShell.test.tsx`,
 * `LoginScreen.test.tsx`), just at the network layer instead of at `fetch`.
 */
export async function installMockBackend(page: Page, options: MockBackendOptions = {}): Promise<void> {
  const accountStatus = options.accountStatus ?? 'Approved'

  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const { pathname } = url
    const method = request.method()

    if (pathname.endsWith('/health')) {
      await route.fulfill(jsonBody({ status: 'ok' }))
      return
    }

    if (pathname.endsWith('/auth/login') && method === 'POST') {
      const identity = findIdentity(request.postData() ?? '')
      if (identity === null) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'invalid_credentials', message: null, details: null, request_id: 'e2e' }),
        })
        return
      }
      await route.fulfill(
        jsonBody({
          access_token: mintAccessToken(identity.roles, identity.act, identity.id),
          refresh_token: `refresh-${identity.id}`,
          token_type: 'bearer',
          expires_in: 3600,
        }),
      )
      return
    }

    if (pathname.endsWith('/auth/logout') || pathname.endsWith('/auth/refresh')) {
      if (pathname.endsWith('/auth/refresh')) {
        // No route under scan lives long enough to hit the refresh window; answered
        // defensively so a stray timer cannot fail the run with an unhandled 404.
        await route.fulfill(
          jsonBody({
            access_token: mintAccessToken(['CANDIDATE'], 'CANDIDATE'),
            refresh_token: 'refresh-e2e',
            token_type: 'bearer',
            expires_in: 3600,
          }),
        )
        return
      }
      await route.fulfill({ status: 204, body: '' })
      return
    }

    if (pathname.endsWith('/me/status')) {
      await route.fulfill(
        jsonBody({
          status: accountStatus,
          next_step: accountStatus === 'Approved' ? null : 'verify_email',
        }),
      )
      return
    }

    if (pathname.includes('/skills') && method === 'GET') {
      await route.fulfill(jsonBody({ items: [] }))
      return
    }

    if (method === 'GET') {
      // Requirement 21 AC7: a resolved read with zero items renders the
      // Web_Client's own accessible empty state, which is the state under scan.
      await route.fulfill(jsonBody(emptyListBody()))
      return
    }

    // No scanned route triggers a mutation from a fresh page load; answered
    // generically so nothing under the mocked prefix ever falls through unhandled.
    await route.fulfill({ status: 204, body: '' })
  })
}
