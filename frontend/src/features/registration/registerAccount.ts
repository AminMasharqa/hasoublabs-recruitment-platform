/**
 * Submitting a self-registration (Requirement 6 AC6, AC7, AC8).
 *
 * Two operations, one per self-registerable role, differing only in their path —
 * which is the whole point of Requirement 6 AC6 and AC7: the role is not a member
 * the caller chooses, it is the endpoint the validated Registration_Link's role
 * selects. {@link submitRegistration} therefore takes the
 * {@link RegistrationTarget} the link produced and derives the path from it
 * through {@link registrationEndpoint}, so there is exactly one mapping from role
 * to endpoint in the slice.
 *
 * Like the link validation, the request carries no credential: the route is
 * unauthenticated and the `link_token` in the body is what authorizes the call, so
 * `accessToken: null` keeps any leftover Access_Token off the wire and
 * `allowAuthRefresh: false` keeps a refusal from driving a Refresh_Token exchange.
 *
 * Nothing here logs: the body carries a password and a Residency_Proof value
 * (Requirement 3 AC13, Requirement 23 AC7), and the `ApiFailure` a rejection
 * carries holds neither.
 */

import type { ApiClient } from '../../api/client'

import {
  REGISTRATION_PATHS,
  registrationEndpoint,
  toRegistrationRequest,
  type RegistrationFormValues,
  type RegistrationTarget,
} from './registrationFormModel'
import type { RegisteredAccount } from './verificationHandoff'

/**
 * Registers the account and resolves with the created `AccountDTO` (AC6, AC7).
 *
 * Rejects with the decoded `ApiFailure` on any refusal — a 422 carrying
 * Field_Violations (AC14), a `conflicting_state` naming an email conflict (AC13),
 * or anything else the Error_Presenter renders.
 */
export async function submitRegistration(
  api: ApiClient,
  values: RegistrationFormValues,
  target: RegistrationTarget,
): Promise<RegisteredAccount> {
  const init = {
    body: toRegistrationRequest(values, target),
    accessToken: null,
    allowAuthRefresh: false,
  }
  // Switching on the resolved path rather than on the role keeps the role →
  // endpoint mapping in `registrationEndpoint` alone, while still handing the
  // Api_Client the literal path its generated typing needs.
  const { data } =
    registrationEndpoint(target.role) === REGISTRATION_PATHS.CANDIDATE
      ? await api.request('post', REGISTRATION_PATHS.CANDIDATE, init)
      : await api.request('post', REGISTRATION_PATHS.SENIOR, init)
  return data
}
