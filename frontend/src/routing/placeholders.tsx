/**
 * Stand-in elements for routes whose feature slice is not built yet, plus the
 * minimal root layout the router uses until the application shell exists.
 *
 * The route tree is declared in full now — paths, nesting and, above all, the
 * {@link import('./access').RouteAccess} metadata each group is guarded by — so
 * that Requirements 7 and 8 are satisfiable and testable before the screens
 * themselves land. Every element that is still a placeholder is listed in
 * `routes.tsx`, and the feature task named there replaces it; nothing about the
 * guarding changes when it does.
 *
 * A placeholder renders localized copy from the `shell` catalogue (Req 19 AC2)
 * and issues no request, so mounting one can never satisfy or violate a
 * Backend_Api expectation.
 */

import { Container, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation } from 'react-router-dom'

import { RecoveryBoundary } from '../errors/RecoveryBoundary'

/** Namespace the placeholder copy resolves against. */
const NAMESPACES = ['shell'] as const

export interface PlaceholderScreenProps {
  /**
   * Catalogue key naming the destination this placeholder stands in for, e.g.
   * `shell:nav.cvs`. Falls back to the generic placeholder heading.
   */
  readonly labelKey?: string
}

/**
 * The screen rendered for an admitted route whose feature slice is not built yet.
 *
 * Deliberately inert: no query, no mutation, no navigation. It exists so the
 * guarded route tree is complete and so a guard admission is observable.
 */
export function PlaceholderScreen({ labelKey }: PlaceholderScreenProps) {
  const { t } = useTranslation(NAMESPACES)

  return (
    <Container size="sm" py="md" data-testid="placeholder-screen">
      <Stack gap="xs">
        <Title order={1} size="h3">
          {labelKey === undefined ? t('shell:route.placeholder.title') : t(labelKey)}
        </Title>
        <Text c="dimmed">{t('shell:route.placeholder.body')}</Text>
      </Stack>
    </Container>
  )
}

/**
 * The catch-all screen for a URL that matches no declared route.
 *
 * Not an authorization surface: it says the address does not exist, which is
 * true of every session and therefore discloses nothing. A URL that *does* name a
 * route the session may not reach is refused by the Route_Guard with the uniform
 * denied surface instead (Req 8 AC4).
 */
export function NotFoundScreen() {
  const { t } = useTranslation(NAMESPACES)

  return (
    <Container size="sm" py="md" data-testid="not-found-screen">
      <Stack gap="xs">
        <Title order={1} size="h3">
          {t('shell:route.notFound.title')}
        </Title>
        <Text c="dimmed">{t('shell:route.notFound.body')}</Text>
      </Stack>
    </Container>
  )
}

/**
 * The root layout the router falls back to until `src/shell/AppShell.tsx`
 * (task 12.1) supplies the real one.
 *
 * Mounts the {@link RecoveryBoundary} *inside* the layout and around the routed
 * `Outlet`, which is the placement Requirement 21 AC11 needs: a rendering error
 * in a screen replaces only the routed region, and everything the layout renders
 * around it stays mounted and operable. The real shell keeps the boundary in the
 * same position, with its chrome — the Navigation_Menu, the locale and context
 * controls, the sign-out control — above it.
 *
 * `location.key` resets the boundary on navigation, so following a retained
 * Navigation_Menu link out of a crashed screen clears the fallback without a
 * reload.
 */
export function RoutedOutlet() {
  const location = useLocation()

  return (
    <RecoveryBoundary resetKey={location.key}>
      <Outlet />
    </RecoveryBoundary>
  )
}
