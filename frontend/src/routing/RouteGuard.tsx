/**
 * The Route_Guard: one decision, rendered (Requirement 7, Requirement 8).
 *
 * Mounted as a **layout route** wrapping a group of routes that share the same
 * access metadata, so the decision is taken once for the group and the routed
 * element renders only when the group is admitted.
 *
 * The decision itself is `decideRouteAccess` in `access.ts` — pure, property
 * tested, and the only place the rules live. This component does four things with
 * its answer and nothing else:
 *
 * | outcome | rendered |
 * | --- | --- |
 * | `redirect-to-login` | `Navigate` to the login screen, retaining the requested location (Req 8 AC2) |
 * | `await-status` | the loading state, or the error state once the status read failed (Req 21 AC6, AC8) |
 * | `redirect-to-status-notice` | `Navigate` to the Status_Notice (Req 7 AC2) |
 * | `deny` | the uniform authorization-denied surface (Req 8 AC4) |
 * | `admit` | the routed `Outlet` (Req 8 AC3, Req 7 AC7) |
 *
 * It also mounts the two retained-status effects of Requirement 7:
 * `GET /me/status` when a session is established (AC1) and the
 * `account_not_approved` replacement (AC6), both in `accountStatus.ts`.
 *
 * ## "SHALL NOT issue the request the target route would have made" (Req 8 AC4)
 *
 * This holds **structurally**, and the structure is the point — keep it.
 *
 * On any outcome other than `admit` this component returns a redirect, a state or
 * the denied surface *instead of* `<Outlet />`. The target route's element is
 * therefore never created, so its `useQuery`/`useEffect` never run and no request
 * is issued. There is no ordering to get right, no "cancel it afterwards" and no
 * loader to keep clean: a refused route cannot reach the network because it never
 * mounts. Anything that moves a target route's fetch *above* this component —
 * into a router `loader`, into the shell, into a parent layout — breaks AC4, which
 * is why the route tree in `routes.tsx` declares no loaders at all.
 *
 * The complement holds too: the guard decides from the session and the retained
 * status, both of which are already in memory, so refusing costs no request
 * either.
 *
 * ## Why the denied surface, not a redirect (Req 8 AC4, Req 21 AC3–AC5)
 *
 * A refusal for an authenticated session renders `AuthorizationDeniedNotice`
 * in place, at the requested URL. That component takes no props, so the guard
 * cannot pass it the route, the resource id or a tailored message: every denial
 * is identical in text, in available actions and in the work done to produce it,
 * whatever was requested (Req 21 AC3–AC5). Redirecting instead would leak the
 * refusal into the address bar and the history entry.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.6, 7.7, 8.1, 8.2, 8.3, 8.4, 8.5.
 */

import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import type { ApiClient } from '../api/client'
import { AuthorizationDeniedNotice, ErrorState, LoadingState } from '../errors/ErrorPresenter'
import { useSession } from '../session/sessionState'

import { decideRouteAccess, type RouteAccess } from './access'
import { useAccountNotApprovedSync, useAccountStatusSync } from './accountStatus'
import { landingPathFor, loginRedirectState, LOGIN_PATH, STATUS_NOTICE_PATH } from './paths'

export interface RouteGuardProps {
  /**
   * What the guarded group requires (Req 8 AC1).
   *
   * Declared on the layout route in `routes.tsx` and shared with the
   * Navigation_Menu destination that points into the group, so the menu and the
   * guard cannot disagree (Req 8 AC5).
   */
  readonly access: RouteAccess
  /**
   * The Api_Client, used for the `GET /me/status` read of Requirement 7 AC1.
   *
   * Optional: a guard rendered without one issues nothing and simply waits, which
   * is what a component test that supplies the retained status directly wants.
   */
  readonly api?: ApiClient | null
  /**
   * What to render when the group is admitted. Defaults to the routed `Outlet`,
   * which is how the guard is used as a layout route; pass children to guard a
   * single element.
   */
  readonly children?: ReactNode
}

/**
 * Admits or refuses one navigation attempt.
 *
 * Renders nothing of its own when it admits: the routed content takes over, and
 * the guard stays mounted so a status change — an `account_not_approved` envelope
 * from a request the admitted screen made, or a logout — is re-decided on the
 * next render.
 */
export function RouteGuard({ access, api, children }: RouteGuardProps) {
  const { subject } = useSession()
  const location = useLocation()

  // Requirement 7 AC1 and AC6. Called unconditionally and before the decision:
  // the retained status is an input to that decision, and hooks may not be
  // skipped on a redirect render.
  const statusSync = useAccountStatusSync(api)
  useAccountNotApprovedSync()

  const outcome = decideRouteAccess(subject, access)

  switch (outcome) {
    case 'redirect-to-login':
      // Req 8 AC2: the requested location rides along in router state so the
      // login screen can return the user to it.
      return <Navigate to={LOGIN_PATH} replace state={loginRedirectState(location)} />

    case 'await-status':
      // The status read has not resolved, so no gate decision exists yet. A
      // failed read gets the error state with its retry control (Req 21 AC8)
      // rather than an indefinite spinner.
      if (statusSync.error !== null) {
        return <ErrorState error={statusSync.error} onRetry={statusSync.retry} />
      }
      return <LoadingState showLabel />

    case 'redirect-to-status-notice':
      // Req 7 AC2/AC6: not approved, and this is not an Onboarding_Screen.
      return <Navigate to={STATUS_NOTICE_PATH} replace />

    case 'deny':
      // Req 8 AC4 with Req 21 AC3–AC5. No props: nothing about the refused
      // route can reach the rendered surface.
      return <AuthorizationDeniedNotice />

    case 'admit':
      return <>{children ?? <Outlet />}</>
  }
}

/**
 * The index route: sends an admitted session to the landing destination of its
 * Active_Context (Req 8 AC11).
 *
 * Declared *inside* a guarded group, so authentication, the Account_Status gate
 * and the loading state are already handled by the guard above it and this
 * component only ever sees an approved session. A missing `act` claim — which an
 * admitted session cannot have — falls back to the login screen rather than
 * rendering a blank page.
 */
export function LandingRedirect() {
  const { act } = useSession()
  return <Navigate to={landingPathFor(act)} replace />
}
