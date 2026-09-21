/**
 * Registration_Link validation (Requirement 6 AC1, AC2, AC3).
 *
 * The unauthenticated `/register/:token` route asks the Backend_Api whether the
 * token in the address is a live Registration_Link before it renders anything:
 * `GET /api/v1/registration-links/{token}`. A 200 names the role the link was
 * issued for, and that role is what the form is built for — there is no role
 * control (AC2), so the only way a role reaches the form is through this read.
 *
 * ## Why the read carries no credential
 *
 * The route is reachable without a session, and the endpoint authenticates the
 * *token*, not the caller. `accessToken: null` therefore sends no
 * `Authorization` header — a stale token left in memory by a previous session has
 * no business on this request — and `allowAuthRefresh: false` follows: a 401 here
 * says the link is not usable, not that a Refresh_Token needs exchanging.
 *
 * ## Why an `ADMIN` link is not a valid link
 *
 * The contract types `RegistrationLinkDTO.role` as the full {@link Role} union,
 * but self-registration exists only for `CANDIDATE` and `SENIOR` — those are the
 * two endpoints the contract declares (AC6, AC7) and the two members
 * `SELF_REGISTRATION_ROLE_VALUES` admits. A link naming any other role has no
 * form to render and no endpoint to submit to, so {@link selfRegistrationRole}
 * reports `null` and the screen renders the invalid-or-expired surface. Narrowing
 * here rather than in the form is what makes the form's role structurally fixed:
 * it cannot be constructed with a role the Backend_Api would refuse.
 */

import { isApiFailure } from '../../api/client'
import type { ApiClient } from '../../api/client'
import type { components } from '../../api/generated/schema'
import { SELF_REGISTRATION_ROLE_VALUES } from '../../forms/validators'

/** Registration_Link metadata, exactly as the contract declares it. */
export type RegistrationLink = components['schemas']['RegistrationLinkDTO']

/**
 * A role a Registration_Link can usefully name: the two self-registerable roles.
 *
 * Keyed off the contract through `SELF_REGISTRATION_ROLE_VALUES`, so a change to
 * the `Role` union lands here as a typecheck failure.
 */
export type SelfRegistrationRole = (typeof SELF_REGISTRATION_ROLE_VALUES)['values'][number]

/** The contract path the token is validated against (AC1). */
export const REGISTRATION_LINK_PATH = '/api/v1/registration-links/{token}' as const

/**
 * TanStack Query key of one token's validation.
 *
 * Keyed by the token so two different links never share a cache entry. The entry
 * holds link metadata only — the raw token is already in the address bar and the
 * response never re-exposes it.
 */
export function registrationLinkQueryKey(token: string): readonly unknown[] {
  return ['registration', 'link', token]
}

/**
 * Validates a Registration_Link token (AC1).
 *
 * Resolves with the link metadata on 200 and rejects with the decoded
 * `ApiFailure` for every 400–599, which {@link isLinkRejection} classifies for
 * the screen.
 */
export async function fetchRegistrationLink(
  api: ApiClient,
  token: string,
  signal?: AbortSignal,
): Promise<RegistrationLink> {
  const { data } = await api.request('get', REGISTRATION_LINK_PATH, {
    params: { path: { token } },
    ...(signal === undefined ? {} : { signal }),
    accessToken: null,
    allowAuthRefresh: false,
  })
  return data
}

/**
 * The role the form is fixed to, or `null` when the link names none the client
 * can register (AC2).
 */
export function selfRegistrationRole(
  link: RegistrationLink | null | undefined,
): SelfRegistrationRole | null {
  const role = link?.role
  return SELF_REGISTRATION_ROLE_VALUES.includes(role) ? role : null
}

/**
 * Whether a failed validation is the Backend_Api refusing the link (AC3) rather
 * than the request never arriving.
 *
 * AC3 is scoped to a status code in the range 400 to 599: that is the Backend_Api
 * saying the link is not usable, and the invalid-or-expired screen is the honest
 * response. A timeout or a transport failure carries no status
 * (`httpStatus === 0`) and says nothing about the link, so it surfaces as a
 * retryable read failure instead of accusing the user's link of being expired.
 */
export function isLinkRejection(error: unknown): boolean {
  return isApiFailure(error) && error.httpStatus >= 400 && error.httpStatus <= 599
}
