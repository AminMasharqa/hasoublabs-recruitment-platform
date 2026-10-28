/**
 * The shell-provided services a feature slice may reach for: the Api_Client, the
 * TanStack Query cache and the cache reset that Requirements 4 AC7/AC9 and 8 AC11
 * hang off.
 *
 * Separate from `AppShell.tsx` because that file exports components only
 * (`react/only-export-components`), and separate from `appRuntime.ts` because
 * this half is the *React* face of the runtime: a context, its hooks and nothing
 * else. No state lives here.
 *
 * ## Why the cache reset is a service rather than a local call
 *
 * "Clear every cached server-state entry" appears three times in the
 * requirements, with three different triggers:
 *
 * | trigger | requirement | who calls |
 * | --- | --- | --- |
 * | logout | 4 AC9, AC10 | `SessionManager.logout` → injected `clearCache` |
 * | refresh refused with a 4xx (session expiry) | 4 AC7 | `SessionManager.clear` → injected `clearCache` |
 * | context switch returns 200 | 8 AC11 | the ContextSwitch control (task 12.2) |
 *
 * The first two are already wired: `appRuntime.ts` hands the Session_Manager the
 * same reset function it publishes here, so those paths cannot forget it. The
 * third is a user action taken inside a component, which has no way to reach the
 * `QueryClient` the shell built — hence {@link useClearServerState}. All three
 * end up in one implementation, so the three triggers cannot drift apart.
 *
 * `useApiClient` exists for the same reason: the Api_Client is constructed in the
 * shell (it needs the Session_Manager, which needs the cache and the router), so
 * a feature cannot import a ready-made instance from a module. Reading it from
 * context also keeps a component test free to supply its own.
 *
 * Requirements: 4.7, 4.9, 8.11.
 */

import { createContext, useContext } from 'react'

import type { QueryClient } from '@tanstack/react-query'

import type { ApiClient } from '../api/client'
import type { SessionEndReason } from '../session/SessionManager'

/**
 * Why the cached server state is being discarded.
 *
 * The two {@link SessionEndReason} values (Req 4 AC7, AC9) plus the context
 * switch of Req 8 AC11, which ends no session — it replaces the `act` claim, so
 * every cached entry read under the previous Active_Context is stale and, worse,
 * may be data the new context is not entitled to see.
 */
export type ServerStateResetReason = SessionEndReason | 'context-switch'

/** The shell-built collaborators published to the component tree. */
export interface AppServices {
  /** The single Api_Client instance (Requirement 3 AC1). */
  readonly api: ApiClient
  /** The single TanStack Query cache (Requirement 1 AC3). */
  readonly queryClient: QueryClient
  /**
   * Discards every cached server-state entry (Req 4 AC7, AC9, Req 8 AC11).
   *
   * Cancels whatever is in flight first, so a read that was already on the wire
   * under the old session or the old Active_Context cannot resolve and repopulate
   * the cache it was just removed from.
   */
  readonly clearServerState: (reason: ServerStateResetReason) => void
}

/**
 * The services context.
 *
 * `null` outside the shell, which the hooks below report as a wiring error rather
 * than returning a silently inert Api_Client.
 */
export const AppServicesContext = createContext<AppServices | null>(null)

/** The shell-provided services. Throws outside the application shell. */
export function useAppServices(): AppServices {
  const value = useContext(AppServicesContext)
  if (value === null) {
    throw new Error('useAppServices must be used within the application shell')
  }
  return value
}

/** The Api_Client every feature slice issues its requests through. */
export function useApiClient(): ApiClient {
  return useAppServices().api
}

/**
 * The cache reset of Req 4 AC7/AC9 and Req 8 AC11.
 *
 * The ContextSwitch control (task 12.2) calls this with `context-switch` before
 * adopting the token pair `POST /auth/context` returned.
 */
export function useClearServerState(): (reason: ServerStateResetReason) => void {
  return useAppServices().clearServerState
}
