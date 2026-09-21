/**
 * The application shell: the provider stack, the chrome and the recovery boundary
 * (Requirement 1 AC2, AC3, AC5).
 *
 * Two components, and the split between them is structural rather than stylistic.
 *
 * ```
 * AppShell                          ← mounted by App.tsx, once per browsing context
 *   DirectionProvider               ← dir + lang + Mantine direction (Req 19 AC6, AC7)
 *     MantineProvider               ← the shared theme (Req 1 AC2)
 *       QueryClientProvider         ← the single server-state cache (Req 1 AC3)
 *         SessionProvider           ← session state, never tokens (Req 4 AC3)
 *           AppServicesContext      ← api + cache + cache reset (Req 8 AC11)
 *             CandidateApplyGate    ← profile readiness for apply controls (Req 9 AC13)
 *             RouterProvider        ← the data router (Req 1 AC5)
 *               AppShellLayout      ← the root layout route: the chrome
 *                 header, Navigation_Menu, locale + context controls, sign-out
 *                 main
 *                   RecoveryBoundary  ← Req 21 AC11
 *                     Outlet          ← RouteGuard groups → screens
 * ```
 *
 * ## Why the boundary is here and not one level up
 *
 * `RecoveryBoundary` replaces *its own children* with the recovery notice, and
 * Requirement 21 AC11 says the shell is retained when a rendering error occurs. So
 * the boundary wraps the routed `Outlet` from inside the chrome: a crash in a
 * screen blanks the routed region only, and the header, the Navigation_Menu, the
 * locale control, the context switch and the sign-out control stay mounted and
 * operable — which is what lets the user navigate away instead of reloading.
 * Wrapping the shell instead would take the chrome down with the screen and
 * violate AC11 no matter what the fallback rendered.
 *
 * Everything above the boundary is a provider precisely because the fallback
 * renders *through* it: the notice needs Mantine and i18next to render at all.
 *
 * ## Why the providers are ordered the way they are
 *
 * `DirectionProvider` is outermost because it writes `dir`/`lang` on the document
 * root and seeds Mantine's direction, so no frame is ever painted in the wrong
 * direction. `SessionProvider` sits above the router because the Route_Guard reads
 * the session to decide admission. `AppServicesContext` sits between the session
 * and the router so a screen can reach the Api_Client and the cache reset without
 * either being importable as a module singleton.
 *
 * ## Seams left open on purpose
 *
 * `AppShellLayout` accepts the locale control and the context switch as props,
 * defaulting to the real controls, so a test can render the chrome without
 * either; `useClearServerState` in `appServices.ts` gives the context switch the
 * cache reset Requirement 8 AC11 demands of it.
 *
 * Screens are registered through the route `elements` table in
 * `screenElements.tsx` rather than imported by the router, so a feature slice
 * never depends on `routing/`. Only `/diagnostics` is filled in so far
 * (task 12.3); every other path still renders its placeholder.
 *
 * Accessibility here is structural only — a skip link, a `main` landmark, a real
 * `nav` (in `routing/NavigationMenu.tsx`) and keyboard-operable controls. The full
 * conformance pass is task 26.1.
 *
 * Requirements: 1.2, 1.3, 4.7, 4.9, 8.11.
 */

import {
  AppShell as MantineAppShell,
  Burger,
  Button,
  Group,
  MantineProvider,
  Text,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { QueryClientProvider } from '@tanstack/react-query'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, RouterProvider, useLocation } from 'react-router-dom'

import { RecoveryBoundary } from '../errors/RecoveryBoundary'
import { CandidateApplyGateProvider } from '../features/profiles'
import { initI18n } from '../i18n'
import { DirectionProvider } from '../i18n/DirectionProvider'
import { deriveNavigationMenu } from '../routing/access'
import { NAVIGATION_DESTINATIONS } from '../routing/destinations'
import { NavigationMenu } from '../routing/NavigationMenu'
import { SessionProvider } from '../session/SessionContext'
import { useAccessSubject, useSession } from '../session/sessionState'

import { AppServicesContext, type AppServices } from './appServices'
import { sharedAppRuntime, type AppRuntime } from './appRuntime'
import { ContextSwitch } from './ContextSwitch'
import { LocaleControl } from './LocaleControl'
import { SCREEN_ELEMENTS } from './screenElements'
import { appTheme } from './theme'

import './shell.css'

/**
 * Initializes the shared i18next instance as soon as the shell module is loaded.
 *
 * Idempotent (`initI18n` leaves an initialized instance alone), and done at module
 * scope rather than in a component so that no provider — `DirectionProvider`
 * reads the active Locale during its first render — ever sees an uninitialized
 * instance.
 */
initI18n()

/** Namespaces the chrome resolves its strings against (Requirement 19 AC2). */
const NAMESPACES = ['shell'] as const

/** Anchor target of the skip link and id of the `main` landmark (Req 20 AC1). */
export const MAIN_CONTENT_ID = 'main-content'

/** Header height in px, shared by the layout and the navbar offset. */
const HEADER_HEIGHT = 56

/** Navbar width in px on viewports at or above the collapse breakpoint. */
const NAVBAR_WIDTH = 260

/** Viewport below which the Navigation_Menu collapses behind the burger control. */
const NAVBAR_BREAKPOINT = 'sm'

/**
 * The logout control (Requirement 4 AC9, AC10).
 *
 * Renders nothing without a session, so the header of the login screen carries no
 * sign-out affordance. The whole teardown — `POST /auth/logout`, discarding both
 * tokens, clearing every cached server-state entry and redirecting to the login
 * screen, in that order and regardless of the response status — belongs to
 * `SessionManager.logout` and the effects `appRuntime.ts` injected into it. This
 * component only invokes it, which is why AC10 cannot be forgotten at the call
 * site.
 */
function SignOutControl() {
  const { authenticated, logout } = useSession()
  const { t } = useTranslation(NAMESPACES)

  if (!authenticated) {
    return null
  }

  return (
    <Button
      type="button"
      variant="subtle"
      size="compact-sm"
      onClick={() => {
        // `logout` swallows a failing revoke call itself (AC10), so there is
        // nothing here that could reject.
        void logout()
      }}
      data-testid="sign-out"
    >
      {t('shell:session.signOut')}
    </Button>
  )
}

export interface AppShellLayoutProps {
  /**
   * The locale control (Requirement 19 AC5). Defaults to {@link LocaleControl};
   * pass `null` to render no locale control at all.
   */
  readonly localeControl?: ReactNode
  /**
   * The context-switch control (Requirement 8 AC10–AC12). Defaults to
   * {@link ContextSwitch}, whose own gate decides it should not be presented at
   * all — for a single-role account, or for an account holding the Admin role —
   * so the shell passes no session information into this slot.
   */
  readonly contextSwitch?: ReactNode
}

/**
 * The root layout route: the chrome, and the recovery boundary around the routed
 * content.
 *
 * Passed to `createAppRouter` as `shellElement`, so it is the parent of every
 * route in the application and stays mounted across navigation — which is what
 * makes the Navigation_Menu, the controls and the header persistent rather than
 * re-rendered per screen.
 *
 * The navbar is rendered only when the derived Navigation_Menu has at least one
 * entry, using the same `deriveNavigationMenu` the menu itself calls. So a
 * signed-out visitor and a not-yet-approved account (Req 7 AC5: Status_Notice and
 * logout only) see no empty navigation region at all, and no separate visibility
 * rule can disagree with the menu's own (Req 8 AC5).
 */
export function AppShellLayout({
  localeControl = <LocaleControl />,
  contextSwitch = <ContextSwitch />,
}: AppShellLayoutProps) {
  const location = useLocation()
  const subject = useAccessSubject()
  const { t } = useTranslation(NAMESPACES)
  const [navOpened, { toggle: toggleNav, close: closeNav }] = useDisclosure(false)

  // The subject is identity-stable between session and status changes, so this is
  // derived once per change rather than on every render.
  const hasMenu = useMemo(
    () => deriveNavigationMenu(subject, NAVIGATION_DESTINATIONS).length > 0,
    [subject],
  )

  return (
    <>
      {/*
       * First focusable element in the document (Req 20 AC1, AC4). A plain
       * fragment anchor rather than a router `Link`: the target is a position in
       * the current document, not a destination.
       */}
      <a className="shell-skip-link" href={`#${MAIN_CONTENT_ID}`} data-testid="skip-to-content">
        {t('shell:app.skipToContent')}
      </a>

      <MantineAppShell
        header={{ height: HEADER_HEIGHT }}
        navbar={
          hasMenu
            ? {
                width: NAVBAR_WIDTH,
                breakpoint: NAVBAR_BREAKPOINT,
                collapsed: { mobile: !navOpened },
              }
            : undefined
        }
        padding="md"
      >
        <MantineAppShell.Header>
          <Group h="100%" px="md" gap="sm" justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              {hasMenu ? (
                <Burger
                  opened={navOpened}
                  onClick={toggleNav}
                  hiddenFrom={NAVBAR_BREAKPOINT}
                  size="sm"
                  aria-label={navOpened ? t('shell:nav.close') : t('shell:nav.open')}
                  aria-expanded={navOpened}
                  aria-controls="shell-navigation"
                  data-testid="navigation-toggle"
                />
              ) : null}
              <Text component="span" fw={600} className="shell-brand">
                {t('shell:app.name')}
              </Text>
            </Group>
            <Group gap="xs" wrap="nowrap">
              {/* Req 19 AC5 and Req 8 AC10–AC12; both default to their own control. */}
              {localeControl}
              {contextSwitch}
              <SignOutControl />
            </Group>
          </Group>
        </MantineAppShell.Header>

        {hasMenu ? (
          <MantineAppShell.Navbar id="shell-navigation" p="md">
            {/* Closing the drawer on activation keeps a narrow viewport usable (Req 20 AC9). */}
            <NavigationMenu onNavigate={closeNav} />
          </MantineAppShell.Navbar>
        ) : null}

        <MantineAppShell.Main id={MAIN_CONTENT_ID} tabIndex={-1} className="shell-main">
          {/*
           * Req 21 AC11. Inside the chrome, around the routed content — see the
           * module note. `location.key` discards a caught error on navigation, so
           * following a retained Navigation_Menu link out of a crashed screen
           * clears the notice without a reload.
           */}
          <RecoveryBoundary resetKey={location.key}>
            <Outlet />
          </RecoveryBoundary>
        </MantineAppShell.Main>
      </MantineAppShell>
    </>
  )
}

export interface AppShellProps {
  /**
   * A pre-built runtime, for a test that needs to drive the session, inspect the
   * cache or supply real feature screens. Built internally when omitted.
   */
  readonly runtime?: AppRuntime
}

/**
 * The root of the Web_Client: the provider stack and the router.
 *
 * Mounted once by `App.tsx`. Everything it provides is created by
 * `appRuntime.ts`, which also wires the cache reset and the login redirect the
 * Session_Manager needs (Req 4 AC7, AC9) and the failure observers Requirements 7
 * AC6 and 23 AC3 depend on.
 */
export function AppShell({ runtime }: AppShellProps) {
  // The runtime is browsing-context-scoped, not render-scoped: `sharedAppRuntime`
  // builds it on first use and returns the same instance thereafter, so neither a
  // re-render nor React's double-invoked initial render starts a second session.
  const active =
    runtime ??
    sharedAppRuntime({ shellElement: <AppShellLayout />, elements: SCREEN_ELEMENTS })

  const services = useMemo<AppServices>(
    () => ({
      api: active.api,
      queryClient: active.queryClient,
      clearServerState: active.clearServerState,
    }),
    [active],
  )

  return (
    <DirectionProvider>
      <MantineProvider theme={appTheme}>
        <QueryClientProvider client={active.queryClient}>
          <SessionProvider manager={active.session}>
            <AppServicesContext.Provider value={services}>
              {/*
               * Req 9 AC13: one reading of the Candidate's profile governs every
               * apply control in the tree. Below the services (it reads through
               * the Api_Client) and above the router (the controls it governs are
               * on routed screens).
               */}
              <CandidateApplyGateProvider>
                <RouterProvider router={active.router} />
              </CandidateApplyGateProvider>
            </AppServicesContext.Provider>
          </SessionProvider>
        </QueryClientProvider>
      </MantineProvider>
    </DirectionProvider>
  )
}
