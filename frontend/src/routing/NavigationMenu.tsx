/**
 * The Navigation_Menu (Requirement 8 AC5–AC8).
 *
 * Presents exactly the destinations the Route_Guard would admit for the current
 * role set, Active_Context and retained Account_Status — and it does so by
 * calling the same decision the guard calls (`deriveNavigationMenu`, which is a
 * filter over `decideRouteAccess`). There is no separate visibility rule here, so
 * a destination can never be presented and then refused on arrival (AC5).
 *
 * Which destinations exist per context (AC6, AC7, AC8) is declared in
 * `destinations.ts`; this component renders whatever survives the filter, in
 * declaration order.
 *
 * Consequences worth naming, all of which fall out of the filter rather than out
 * of code here:
 *
 * - While the retained status is not `Approved`, no feature destination is an
 *   Onboarding_Screen, so the menu is empty — which is what leaves the
 *   Status_Notice and the logout control as the only actions for a `Suspended`,
 *   `Rejected` or `Deactivated` account (Req 7 AC5). The component renders nothing
 *   at all in that case rather than an empty landmark.
 * - With no session the menu is likewise empty, because `decideRouteAccess`
 *   answers `redirect-to-login` for every destination.
 * - After a context switch the `act` claim changes, the memo recomputes and the
 *   menu is rebuilt from the new context (Req 8 AC11).
 *
 * Accessibility (Requirement 20): a `nav` landmark with an accessible name from
 * the catalogue, a real list so assistive technology can announce the count,
 * genuine links (keyboard operable, focusable, in DOM order, which is the visual
 * and direction reading order under the Direction_Provider) and `aria-current`
 * on the current destination. Every label is a catalogue key (Req 19 AC2).
 *
 * Requirements: 8.5, 8.6, 8.7, 8.8.
 */

import { NavLink as MantineNavLink, Stack } from '@mantine/core'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'

import { useAccessSubject } from '../session/sessionState'

import { deriveNavigationMenu } from './access'
import {
  isCurrentDestination,
  NAVIGATION_DESTINATIONS,
  type AppDestination,
} from './destinations'

/** Namespace the labels resolve against. */
const NAMESPACES = ['shell'] as const

export interface NavigationMenuProps {
  /**
   * The catalogue to scope. Defaults to every declared destination; a test or a
   * secondary menu passes its own.
   */
  readonly destinations?: readonly AppDestination[]
  /**
   * Called when a destination is activated — the shell uses it to close the
   * navigation drawer on a narrow viewport (Req 20 AC9).
   */
  readonly onNavigate?: () => void
}

/**
 * The role-, context- and status-scoped Navigation_Menu (AC5).
 *
 * Renders `null` when no destination is admitted, so the shell shows no empty
 * navigation landmark to a signed-out or not-yet-approved user.
 */
export function NavigationMenu({
  destinations = NAVIGATION_DESTINATIONS,
  onNavigate,
}: NavigationMenuProps) {
  const subject = useAccessSubject()
  const { pathname } = useLocation()
  const { t } = useTranslation(NAMESPACES)

  // The subject is identity-stable between session changes, so the menu is
  // derived once per session/status change rather than on every render.
  const visible = useMemo(
    () => deriveNavigationMenu(subject, destinations),
    [subject, destinations],
  )

  if (visible.length === 0) {
    return null
  }

  return (
    <nav aria-label={t('shell:nav.label')} data-testid="navigation-menu">
      <Stack component="ul" gap={2} styles={{ root: { listStyle: 'none', margin: 0, padding: 0 } }}>
        {visible.map((destination) => {
          const current = isCurrentDestination(pathname, destination)
          return (
            <li key={destination.id}>
              <MantineNavLink
                component={Link}
                to={destination.path}
                label={t(destination.labelKey)}
                active={current}
                aria-current={current ? 'page' : undefined}
                onClick={onNavigate}
                data-destination={destination.id}
              />
            </li>
          )
        })}
      </Stack>
    </nav>
  )
}
