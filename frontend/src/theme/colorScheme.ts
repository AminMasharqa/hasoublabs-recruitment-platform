/**
 * The look of each active context: dark for an Administrator on every screen, light
 * for everyone else, plus a `data-app-context` marker on the document that the role
 * styles in `theme.css` read. It sits on the document, not the shell, because dialogs
 * render outside the shell.
 *
 * Decided by the active context, never by a user toggle, the operating system or the
 * URL, so it follows a context switch, and Administrator screens outside `/admin`
 * (`/account`, `/diagnostics`) still match. This is presentation only;
 * `routing/RouteGuard` still decides access.
 */

import { type MantineColorSchemeManager, useMantineColorScheme } from '@mantine/core'
import { useLayoutEffect } from 'react'

import type { ActiveContext } from '../routing/access'

type AppColorScheme = 'light' | 'dark'

/** The scheme for the active context; `null` means nobody is signed in. */
export function colorSchemeForContext(context: ActiveContext | null): AppColorScheme {
  return context === 'ADMIN' ? 'dark' : 'light'
}

/** No persistence: the session is the source of truth, so nothing goes to localStorage. */
export const contextSchemeManager: MantineColorSchemeManager = {
  get: (defaultValue) => defaultValue,
  set: () => {},
  subscribe: () => {},
  unsubscribe: () => {},
  clear: () => {},
}

const CONTEXT_ATTRIBUTE = 'data-app-context'

/** Keeps the colour scheme and the role marker equal to what the active context calls for. */
export function useContextAppearance(context: ActiveContext | null): void {
  const scheme = colorSchemeForContext(context)
  const { colorScheme, setColorScheme } = useMantineColorScheme()
  useLayoutEffect(() => {
    if (colorScheme !== scheme) {
      setColorScheme(scheme)
    }
  }, [scheme, colorScheme, setColorScheme])

  useLayoutEffect(() => {
    if (context === null) {
      return
    }
    const root = document.documentElement
    root.setAttribute(CONTEXT_ATTRIBUTE, context.toLowerCase())
    return () => {
      root.removeAttribute(CONTEXT_ATTRIBUTE)
    }
  }, [context])
}
