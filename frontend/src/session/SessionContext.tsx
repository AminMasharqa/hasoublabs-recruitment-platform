/**
 * The React face of the Session_Manager: session *state* for the component tree,
 * and no token material anywhere near it (Requirement 4 AC3, AC11).
 *
 * ## What this provider is, and what it deliberately is not
 *
 * `SessionManager.ts` owns the session: the two tokens, the decoded principal,
 * the refresh schedule and the single-flight exchange, all in closure variables.
 * This module holds *no session state of its own* except the retained
 * Account_Status (below). It subscribes to the manager's
 * `subscribe`/`getSnapshot` pair through `useSyncExternalStore` and republishes
 * the resulting `SessionSnapshot` as context, so there is one source of truth and
 * no second copy to drift.
 *
 * The context value therefore carries the principal, the `roles`/`act` claims,
 * `authenticated`, the retained Account_Status and the operations that end or
 * re-establish a session — and **not** the Access_Token, the Refresh_Token or the
 * manager itself:
 *
 * - No token is exposed, so no token can reach component props, a React DevTools
 *   tree, a rendering-error overlay or a serialized state dump (AC3).
 * - The manager is not exposed either, because `getAccessToken` is a token
 *   accessor: handing the manager to anything that calls `useSession` would hand
 *   every component the token. The Api_Client receives the manager directly at
 *   construction time in the shell — it is the one collaborator that needs the
 *   token, and it is not a component.
 * - This module reads and writes no `localStorage`, no `sessionStorage`, no cookie
 *   and no IndexedDB. Nothing is persisted, so a page reload produces a tree with
 *   no session at all, which is AC11.
 *
 * The value shape, the hooks that read it and the retained-status helpers live in
 * `sessionState.ts`, so this file exports components only.
 *
 * ## Retained Account_Status (Req 7 AC1, AC6)
 *
 * The Route_Guard admits a route on `roles ∩ requiredRoles`, the `act` claim and
 * the retained Account_Status (`src/routing/access.ts`). The first two are token
 * claims; the status is not — it comes from `GET /me/status` when a session is
 * established (Req 7 AC1) and is replaced from `details.status` whenever an
 * `account_not_approved` envelope arrives anywhere in the app (Req 7 AC6).
 *
 * It lives here because it is session-scoped state that outlives any single route
 * and belongs to no feature slice. `SessionContextValue.subject` assembles it with
 * the claims into the `AccessSubject` the guard and the Navigation_Menu consume,
 * so neither has to know where each half came from.
 *
 * The retained value is bound to the account it describes (the `sub` claim) and is
 * discarded whenever a session is established, so a status observed before a
 * logout can never be read back after the next login. Binding it to `session_id`
 * would be wrong: the Backend_Api mints a fresh `session_id` on every
 * Refresh_Token exchange, which would drop the status — and bounce the user into a
 * loading state — on every proactive refresh.
 *
 * Requirements: 4.3.
 */

import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

import type { Role } from '../api/enums'
import { applySessionLocale } from '../i18n'

import {
  SessionContext,
  type EstablishSessionOptions,
  type LocaleApplier,
  type RetainedStatus,
  type SessionContextValue,
} from './sessionState'
import type {
  Principal,
  SessionEndReason,
  SessionManager,
  SessionSnapshot,
  TokenPair,
} from './SessionManager'

const NO_ROLES: readonly Role[] = Object.freeze([])

export interface SessionProviderProps {
  /**
   * The single Session_Manager instance, constructed by the shell with its cache
   * reset and its navigation wired in.
   *
   * Injected rather than created here: the manager's collaborators (the
   * Api_Client's token exchanges, the TanStack Query cache, the router) are not
   * available to this module, and a provider that constructed its own manager
   * would start a second session on every remount.
   */
  readonly manager: SessionManager
  /**
   * Locale application override. Defaults to `applySessionLocale`, which writes to
   * the shared i18next instance.
   */
  readonly applyLocale?: LocaleApplier
  readonly children?: ReactNode
}

/** The retained status together with the `sub` claim it was observed for. */
interface StatusBinding {
  readonly sub: string | null
  readonly retained: RetainedStatus | null
}

const NO_STATUS: StatusBinding = Object.freeze({ sub: null, retained: null })

/**
 * Publishes the session state of a {@link SessionManager} to the tree.
 *
 * Mount once, above the router. Reads the manager through `useSyncExternalStore`,
 * so every consumer re-renders on a login, a refresh that changes the claims, a
 * logout and an expiry — and on nothing else, because the manager replaces its
 * snapshot only when the session actually changes.
 */
export function SessionProvider({
  manager,
  applyLocale = applySessionLocale,
  children,
}: SessionProviderProps) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => manager.subscribe(onStoreChange),
    [manager],
  )
  const getSnapshot = useCallback(() => manager.getSnapshot(), [manager])
  const snapshot: SessionSnapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const [binding, setBinding] = useState<StatusBinding>(NO_STATUS)

  const principal = snapshot.principal
  const sub = principal === null ? null : principal.sub
  // Read the retained status only for the account it was observed for, so a value
  // belonging to an ended session can never gate the current one.
  const retained = binding.sub !== null && binding.sub === sub ? binding.retained : null

  const retainStatus = useCallback(
    (next: RetainedStatus | null) => {
      // Read the `sub` from the manager rather than from the render scope: the
      // status often arrives in the same turn as the session it describes.
      const owner = manager.getPrincipal()
      setBinding(next === null || owner === null ? NO_STATUS : { sub: owner.sub, retained: next })
    },
    [manager],
  )

  const establishSession = useCallback(
    (pair: TokenPair, options: EstablishSessionOptions = {}): Principal | null => {
      setBinding(NO_STATUS)
      const adopted = manager.login(pair)
      if (options.languagePreference !== undefined) {
        // Locale application is a presentation concern and must not delay — or
        // fail — the session establishment the caller is about to navigate on.
        void applyLocale(options.languagePreference)
      }
      return adopted
    },
    [manager, applyLocale],
  )

  const logout = useCallback(async () => {
    setBinding(NO_STATUS)
    await manager.logout()
  }, [manager])

  const clear = useCallback(
    (reason: SessionEndReason) => {
      setBinding(NO_STATUS)
      manager.clear(reason)
    },
    [manager],
  )

  const value = useMemo<SessionContextValue>(() => {
    const status = retained === null ? null : retained.status
    return {
      authenticated: snapshot.authenticated,
      principal,
      roles: principal === null ? NO_ROLES : principal.roles,
      act: principal === null ? null : principal.act,
      status,
      nextStep: retained === null ? null : retained.nextStep,
      subject: principal === null ? null : { roles: principal.roles, act: principal.act, status },
      establishSession,
      retainStatus,
      logout,
      clear,
    }
  }, [snapshot, principal, retained, establishSession, retainStatus, logout, clear])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
