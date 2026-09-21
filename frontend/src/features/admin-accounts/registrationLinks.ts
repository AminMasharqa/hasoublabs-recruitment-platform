/**
 * The address a Registration_Link token is used at (Requirement 16 AC5,
 * Requirement 6 AC1).
 *
 * Its own module rather than a helper inside `RegistrationLinkPanel.tsx` so that
 * file exports components only, and so the derivation is testable without a
 * renderer.
 *
 * Pure apart from reading the browsing context's origin, which is passed in by any
 * caller that has one.
 *
 * Requirements: 16.5.
 */

import { registrationPath } from '../../routing/paths'

/**
 * The address a registrant opens for `token`.
 *
 * Absolute when an origin is available, so the value can be pasted into a message;
 * the application-relative path otherwise — which is still a usable link inside the
 * application and is never a link to somewhere else.
 */
export function registrationLinkUrl(token: string, origin?: string | null): string {
  const path = registrationPath(token)
  const base = origin ?? (typeof window === 'undefined' ? null : window.location.origin)
  if (base === null || base === '' || base === 'null') {
    return path
  }
  try {
    return new URL(path, base).toString()
  } catch {
    return path
  }
}
