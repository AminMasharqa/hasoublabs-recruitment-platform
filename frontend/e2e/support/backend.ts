/**
 * Direct Backend_Api access for seeding the journey suite (task 27.1).
 *
 * Every screen this suite drives is exercised through the Web_Client's own UI —
 * that is the point of an end-to-end journey. But a journey has to *start*
 * somewhere concrete: a Registration_Link only an Admin can mint, a Job_Description
 * only a Senior owns, a CV_Variant only its Candidate can create. Rather than
 * click through five screens of unrelated setup before every journey's own
 * assertions begin, this module talks to the running Backend_Api directly —
 * plain `fetch` against `E2E_API_BASE_URL`, no `Api_Client`, no session — to
 * arrange that starting state, the same way the a11y gate's `mockBackend.ts`
 * mints tokens directly rather than logging in through the UI for a scan that
 * is not testing login.
 *
 * ## The one precondition this suite cannot create: a seeded Admin
 *
 * The Backend_Api exposes no endpoint that creates the first Admin account —
 * every Registration_Link is minted by `POST /admin/registration-links`, which
 * itself requires an Admin session (`backend/app/modules/identity/router.py`).
 * There is deliberately no bootstrap flow in scope of this frontend spec (it
 * would be a Backend_Api concern, and the backend's own `.env.example` and
 * `docker-compose.yml` define none either). So this suite requires exactly one
 * thing to exist before it runs: one Admin account, MFA-enrolled or not
 * (enrolling is itself journey coverage — see `journeys/admin-accounts.spec.ts`),
 * reachable with the credentials named by {@link SEED_ADMIN}.
 *
 * Provisioning that account is an environment-setup step, not a test — the same
 * category of precondition as "the database migrations have run" or "MinIO is
 * reachable". See `e2e/README.md` for how to create it.
 */

import { currentTotpCode, totpSecretFromProvisioningUri } from './totp'

/** Backend_Api base URL. Overridable so the suite can target any running stack. */
export const API_BASE_URL = process.env.E2E_API_BASE_URL ?? 'http://localhost:8000/api/v1'

/**
 * The one Admin identity this suite assumes already exists (see the module
 * doc). Overridable by environment so a real run can point at whichever Admin
 * account its environment provisioned.
 */
export const SEED_ADMIN = Object.freeze({
  email: process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@example.com',
  password: process.env.E2E_ADMIN_PASSWORD ?? 'correct-horse-battery-staple',
})

/** A minimal Backend_Api error envelope, decoded only far enough to log it. */
interface ErrorEnvelopeLike {
  readonly error?: string
  readonly message?: string | null
  readonly request_id?: string
}

async function request<T>(
  method: string,
  path: string,
  options: {
    readonly token?: string
    readonly body?: unknown
    readonly acceptLanguage?: string
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (options.token !== undefined) {
    headers.Authorization = `Bearer ${options.token}`
  }
  if (options.acceptLanguage !== undefined) {
    headers['Accept-Language'] = options.acceptLanguage
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  if (response.status === 204) {
    return undefined as T
  }
  const text = await response.text()
  const parsed = text === '' ? undefined : (JSON.parse(text) as unknown)
  if (!response.ok) {
    const envelope = parsed as ErrorEnvelopeLike | undefined
    throw new Error(
      `${method} ${path} -> ${response.status} ${envelope?.error ?? 'unknown_error'} ` +
        `(request_id=${envelope?.request_id ?? 'none'})`,
    )
  }
  return parsed as T
}

// ── Tokens ──────────────────────────────────────────────────────────────────

export interface TokenPair {
  readonly access_token: string
  readonly refresh_token: string
}

/** Cached across calls within one test run: enrolling again would invalidate it. */
let cachedAdminTotpSecret: string | null = null

/**
 * Signs in as the seeded Admin, enrolling multi-factor once (and caching the
 * secret) if the account has never been enrolled, then always completing the
 * TOTP step the Backend_Api requires of every Admin login.
 */
export async function establishAdminSession(): Promise<TokenPair> {
  const loginBody = { email: SEED_ADMIN.email, password: SEED_ADMIN.password, role: 'ADMIN' }
  const attempt = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(loginBody),
  })
  if (attempt.ok) {
    return (await attempt.json()) as TokenPair
  }
  const envelope = (await attempt.json()) as ErrorEnvelopeLike
  if (envelope.error !== 'mfa_required') {
    throw new Error(`admin login refused: ${envelope.error ?? attempt.status}`)
  }

  if (cachedAdminTotpSecret === null) {
    // No un-authenticated enrolment path exists — enrolment itself requires a
    // session, and an Admin whose login already returns mfa_required carries no
    // access token to enrol with here. In practice the seeded Admin is enrolled
    // once as part of the same manual provisioning step that creates the
    // account (see e2e/README.md), and E2E_ADMIN_TOTP_SECRET is set to the
    // authenticator secret it was enrolled with.
    const secret = process.env.E2E_ADMIN_TOTP_SECRET
    if (secret === undefined || secret === '') {
      throw new Error(
        'Admin login requires a TOTP code but no E2E_ADMIN_TOTP_SECRET was provided. ' +
          'Set it to the base32 secret the seeded Admin was enrolled with.',
      )
    }
    cachedAdminTotpSecret = secret
  }

  const code = currentTotpCode(cachedAdminTotpSecret)
  const withCode = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...loginBody, mfa_code: code }),
  })
  if (!withCode.ok) {
    throw new Error(`admin login with TOTP code refused: ${withCode.status}`)
  }
  return (await withCode.json()) as TokenPair
}

/** Extracts the base32 TOTP secret from a fresh enrolment, for a from-scratch seed. */
export { totpSecretFromProvisioningUri, currentTotpCode }

// ── Registration links ───────────────────────────────────────────────────────

export type RegistrationLinkRole = 'CANDIDATE' | 'SENIOR'

export interface RegistrationLink {
  readonly token: string
  readonly role: RegistrationLinkRole
  readonly expires_at: string
}

/** Mints one Registration_Link (Requirement 16 AC4), as the seeded Admin. */
export async function createRegistrationLink(
  adminToken: string,
  role: RegistrationLinkRole,
): Promise<RegistrationLink> {
  return request<RegistrationLink>('POST', '/admin/registration-links', {
    token: adminToken,
    body: { role },
  })
}

// ── Test identity naming ─────────────────────────────────────────────────────

/**
 * A unique, disposable email for one test run's registration.
 *
 * Timestamp plus a random suffix, so parallel Playwright workers and repeated
 * local runs never collide on a `UNIQUE` constraint the Backend_Api enforces on
 * `accounts.email`.
 *
 * Uses the `.com` TLD rather than `.test`: the Backend_Api validates email
 * addresses with `pydantic`'s `EmailStr` (backed by the `email-validator`
 * package), which rejects `.test` as a special-use/reserved TLD ineligible for
 * real mail delivery. `.com` is not reserved, and the `e2e-...@` local part
 * still makes these addresses obviously test fixtures.
 */
export function uniqueTestEmail(label: string): string {
  const stamp = Date.now().toString(36)
  const suffix = Math.random().toString(36).slice(2, 8)
  return `e2e-${label}-${stamp}-${suffix}@example.com`
}

// ── Direct account provisioning (registration -> verification -> approval) ──

export interface SeededAccount {
  readonly id: string
  readonly email: string
  readonly password: string
}

/**
 * Registers, verifies and approves one account directly against the Backend_Api,
 * for journeys whose *subject* is not the registration flow itself (job
 * browsing, applications, reviews, CVs) and would otherwise spend most of their
 * run walking a form this suite already covers in `journeys/registration.spec.ts`.
 *
 * Verification_Code retrieval has no Backend_Api read of its own — it is only
 * ever emailed — so this helper reads it from Mailpit's HTTP API
 * (`docker-compose.yml`'s `mailpit` service, port 8025), the same inbox a real
 * registrant's email client would show. `E2E_MAILPIT_BASE_URL` overrides the
 * default when Mailpit is not on `localhost`.
 */
export async function registerVerifiedApprovedAccount(
  adminToken: string,
  role: RegistrationLinkRole,
  label: string,
): Promise<SeededAccount> {
  const link = await createRegistrationLink(adminToken, role)
  const email = uniqueTestEmail(label)
  const password = 'Correct-Horse-Battery-Staple-9'

  const registerPath = role === 'CANDIDATE' ? '/register/candidate' : '/register/senior'
  const account = await request<{ readonly id: string }>('POST', registerPath, {
    body: {
      role,
      full_name: `E2E ${label}`,
      email,
      password,
      language_preference: 'en',
      residency_proof_type: 'MobilePhone',
      // A real Israeli mobile number (validated via the `phonenumbers` library
      // server-side, not just prefix-shaped) — sequential placeholders like
      // 0501234567 parse but fail is_valid_number() and are rejected with
      // residency_validation_failed.
      residency_proof_value: '0502345678',
      link_token: link.token,
    },
  })

  const code = await readVerificationCodeFromMailpit(email)
  await request('POST', '/verify/code', { body: { account_id: account.id, code } })
  // fast_track skips ApprovedPendingMeeting, landing the seeded account at
  // Approved directly — this suite is not exercising the meeting step here.
  await request('POST', `/admin/accounts/${account.id}:approve`, {
    token: adminToken,
    body: { fast_track: true },
  })

  return { id: account.id, email, password }
}

const MAILPIT_BASE_URL = process.env.E2E_MAILPIT_BASE_URL ?? 'http://localhost:8025'

/**
 * Reads the most recent Verification_Code Mailpit captured for `email`,
 * retrying briefly.
 *
 * The Backend_Api queues and sends the email asynchronously, so it may not be
 * in Mailpit's index in the instant right after the request that queued it
 * resolves — the retry loop is what makes this safe to call immediately after
 * registering, rather than the caller having to know to wait first. The code
 * itself is matched with a plain 6-digit pattern rather than parsed against the
 * email template, so a template wording change does not also require this
 * helper to change.
 *
 * Exported for direct use by journeys that read a Verification_Code themselves
 * (registration, resend); {@link registerVerifiedApprovedAccount} calls it too.
 */
export async function readVerificationCodeFromMailpit(
  email: string,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const search = new URLSearchParams({ query: `to:${email}` })
    const list = await fetch(`${MAILPIT_BASE_URL}/api/v1/search?${search.toString()}`)
    if (list.ok) {
      const { messages } = (await list.json()) as {
        readonly messages: readonly { readonly ID: string }[]
      }
      const latest = messages[0]
      if (latest !== undefined) {
        const message = await fetch(`${MAILPIT_BASE_URL}/api/v1/message/${latest.ID}`)
        const body = (await message.json()) as { readonly Text?: string; readonly HTML?: string }
        const match = /\b(\d{6})\b/.exec(`${body.Text ?? ''} ${body.HTML ?? ''}`)
        if (match !== null) {
          return match[1]
        }
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(`No Verification_Code found for ${email} within ${timeoutMs}ms. Is Mailpit reachable?`)
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

// ── Job_Description seeding ──────────────────────────────────────────────────

export interface SeededJob {
  readonly id: string
  readonly title: string
}

/** Creates and publishes one Open Job_Description as the given Senior. */
export async function createOpenJob(
  seniorToken: string,
  overrides: { readonly title?: string; readonly company?: string } = {},
): Promise<SeededJob> {
  const title = overrides.title ?? `E2E Role ${Date.now().toString(36)}`
  const created = await request<{ readonly id: string; readonly title: string }>(
    'POST',
    '/jobs',
    {
      token: seniorToken,
      body: {
        title,
        company: overrides.company ?? 'HasoubLabs E2E',
        description: 'Seeded by the Playwright journey suite.',
        application_channel: 'Senior_Dashboard',
      },
    },
  )
  await request('POST', `/jobs/${created.id}:publish`, { token: seniorToken, body: {} })
  return created
}

/**
 * Grants a second role to an already-approved account, as the seeded Admin
 * (Requirement 16 AC13, `PUT /admin/accounts/{account_id}/roles`).
 *
 * Used only to seed a dual-role account for the context-switch journey
 * (`journeys/auth-session.spec.ts`) — the Admin-exclusivity block itself is
 * covered by that journey driving the roles control through the UI, not by this
 * helper, which exists purely to reach the *starting* state faster.
 */
export async function grantRole(
  adminToken: string,
  accountId: string,
  roles: readonly RegistrationLinkRole[],
): Promise<void> {
  await request('PUT', `/admin/accounts/${accountId}/roles`, {
    token: adminToken,
    body: { roles },
  })
}

// ── Session helpers shared by journeys ───────────────────────────────────────

/** Logs in as an already-approved account, no MFA (Candidate/Senior, not Admin). */
export async function login(
  email: string,
  password: string,
  role: 'CANDIDATE' | 'SENIOR',
): Promise<TokenPair> {
  return request<TokenPair>('POST', '/auth/login', { body: { email, password, role } })
}
