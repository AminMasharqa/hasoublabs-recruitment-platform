/**
 * Component tests for the Navigation_Menu (task 11.6).
 *
 * `access.menu.property.test.ts` already proves the derived menu is a subset of
 * the admitted destinations for *any* subject (Property 8). What it cannot prove
 * is the part Requirement 8 AC6–AC8 actually enumerate: **which** destinations
 * each Active_Context gets. That is a property of the catalogue in
 * `destinations.ts`, so it is asserted here against
 * `CONTEXT_DESTINATION_IDS` — the requirement's own enumeration — using a real
 * session whose `roles`/`act` claims come from a real Access_Token.
 *
 * Covered:
 * - **AC6/AC7/AC8** the rendered `data-destination` ids equal the expected set for
 *   a Candidate, a Senior and an Admin session exactly, with no destination from
 *   another context present.
 * - **AC5, AC11** a dual-role account is scoped to its Active_Context, and
 *   adopting a token pair with a different `act` claim rebuilds the menu.
 * - **Req 7 AC5** a `Suspended`, `Rejected` or `Deactivated` session — and any
 *   session whose status is not yet known, and an absent session — gets no menu at
 *   all, which is what leaves the Status_Notice and the logout control as the only
 *   actions.
 * - Accessibility and localization: a `nav` landmark with a catalogue-sourced
 *   accessible name, genuine links in declaration order, `aria-current="page"` on
 *   the current destination (including on a descendant path) and catalogue labels.
 */

import { MantineProvider } from '@mantine/core'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { i18n as I18nextInstance } from 'i18next'
import { useEffect } from 'react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AccountStatus, Role } from '../api/enums'
import { createI18n } from '../i18n'
import { SessionProvider } from '../session/SessionContext'
import { useSession, type SessionContextValue } from '../session/sessionState'
import {
  createSessionManager,
  type SessionManager,
  type SessionManagerConfig,
  type TokenPair,
} from '../session/SessionManager'

import type { ActiveContext } from './access'
import { CONTEXT_DESTINATION_IDS, NAVIGATION_DESTINATIONS } from './destinations'
import { NavigationMenu } from './NavigationMenu'
import { ROUTE_PATHS } from './paths'

// ── Session fixtures ──────────────────────────────────────────────────────────

const NOW_MS = Date.UTC(2026, 0, 15, 12, 0, 0)

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** An unsigned JWT; the Web_Client never verifies the signature. */
function accessToken(overrides: Record<string, unknown> = {}): string {
  const claims = {
    sub: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    exp: NOW_MS / 1000 + 1800,
    act: 'CANDIDATE',
    roles: ['CANDIDATE'],
    session_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    type: 'access',
    ...overrides,
  }
  return `${base64Url('{"alg":"HS256","typ":"JWT"}')}.${base64Url(JSON.stringify(claims))}.sig`
}

function pair(overrides: Record<string, unknown> = {}): TokenPair {
  return { accessToken: accessToken(overrides), refreshToken: 'refresh-1' }
}

function stubManager(overrides: Partial<SessionManagerConfig> = {}): SessionManager {
  return createSessionManager({
    exchangeRefreshToken: () => Promise.reject(new Error('no refresh in this suite')),
    revokeSession: () => Promise.resolve(),
    clearCache: () => undefined,
    redirectToLogin: () => undefined,
    now: () => NOW_MS,
    schedule: () => () => undefined,
    ...overrides,
  })
}

// ── Harness ───────────────────────────────────────────────────────────────────

let i18n: I18nextInstance
/** The session context of the mounted tree, captured for the test to drive. */
let session!: SessionContextValue

beforeEach(() => {
  i18n = createI18n('en')
})

/**
 * Captures the session context so a test can establish a session the way the
 * login screen does. Captured in an effect rather than during render, so the
 * probe itself has no render-time side effect.
 */
function SessionProbe() {
  const value = useSession()
  useEffect(() => {
    session = value
  }, [value])
  return null
}

interface MenuOptions {
  /** Location the menu marks the current destination against. */
  readonly pathname?: string
  readonly onNavigate?: () => void
}

function renderMenu({ pathname = ROUTE_PATHS.root, onNavigate }: MenuOptions = {}) {
  render(
    <MantineProvider>
      <I18nextProvider i18n={i18n}>
        <SessionProvider manager={stubManager()}>
          <MemoryRouter initialEntries={[pathname]}>
            <SessionProbe />
            <NavigationMenu onNavigate={onNavigate} />
          </MemoryRouter>
        </SessionProvider>
      </I18nextProvider>
    </MantineProvider>,
  )
}

/**
 * Establishes a session with the given claims and retained Account_Status.
 *
 * The claims arrive the way the real ones do — decoded from an Access_Token — and
 * the status the way `GET /me/status` retains it, so the menu is scoped by exactly
 * the inputs the Route_Guard decides on.
 */
function signIn(
  roles: readonly Role[],
  context: ActiveContext,
  status: AccountStatus | null = 'Approved',
): void {
  act(() => {
    session.establishSession(pair({ roles, act: context }))
    if (status !== null) {
      session.retainStatus({ status, nextStep: null })
    }
  })
}

/** The `data-destination` id of every presented entry, in rendering order. */
function destinationIds(): string[] {
  const menu = screen.queryByTestId('navigation-menu')
  if (menu === null) {
    return []
  }
  return within(menu)
    .getAllByRole('link')
    .map((link) => link.getAttribute('data-destination') ?? '')
}

// ── Requirement 8 AC6, AC7, AC8: per-context scoping ──────────────────────────

describe('NavigationMenu scoping (Requirement 8 AC5, AC6, AC7, AC8)', () => {
  it('presents exactly the Candidate destinations in the CANDIDATE context', () => {
    renderMenu()
    signIn(['CANDIDATE'], 'CANDIDATE')

    expect(destinationIds()).toEqual([...CONTEXT_DESTINATION_IDS.CANDIDATE])
    // AC6 in the negative: no Admin or Senior destination is presented.
    expect(destinationIds().some((id) => id.startsWith('admin-'))).toBe(false)
    expect(destinationIds().some((id) => id.startsWith('senior-'))).toBe(false)
  })

  it('presents exactly the Senior destinations in the SENIOR context', () => {
    renderMenu()
    signIn(['SENIOR'], 'SENIOR')

    expect(destinationIds()).toEqual([...CONTEXT_DESTINATION_IDS.SENIOR])
    expect(destinationIds().some((id) => id.startsWith('admin-'))).toBe(false)
    expect(destinationIds().some((id) => id.startsWith('candidate-'))).toBe(false)
  })

  it('presents exactly the Admin destinations for an Admin account', () => {
    renderMenu()
    signIn(['ADMIN'], 'ADMIN')

    expect(destinationIds()).toEqual([...CONTEXT_DESTINATION_IDS.ADMIN])
    expect(destinationIds().some((id) => id.startsWith('candidate-'))).toBe(false)
    expect(destinationIds().some((id) => id.startsWith('senior-'))).toBe(false)
    // An Admin lists Job_Descriptions through the all-status Admin destination.
    expect(destinationIds()).not.toContain('jobs')
  })

  it('scopes a dual-role account to its Active_Context and rebuilds on a switch', () => {
    renderMenu()
    signIn(['CANDIDATE', 'SENIOR'], 'SENIOR')

    // The role set holds both, so only the `act` claim can be doing the scoping.
    expect(destinationIds()).toEqual([...CONTEXT_DESTINATION_IDS.SENIOR])

    // A context switch adopts a new token pair carrying the new `act` claim
    // (Req 8 AC10, AC11); the retained status is re-read, as it is in the app.
    signIn(['CANDIDATE', 'SENIOR'], 'CANDIDATE')

    expect(destinationIds()).toEqual([...CONTEXT_DESTINATION_IDS.CANDIDATE])
  })

  it('presents every destination it renders from the shared catalogue', () => {
    renderMenu()
    signIn(['ADMIN'], 'ADMIN')

    const catalogued = new Set(NAVIGATION_DESTINATIONS.map((destination) => destination.id))
    for (const id of destinationIds()) {
      expect(catalogued.has(id)).toBe(true)
    }
  })
})

// ── Requirement 7 AC5 and the absent session: no menu at all ──────────────────

describe('NavigationMenu without full navigation (Requirement 7 AC5, Req 8 AC5)', () => {
  it('renders nothing at all when no session is held', () => {
    renderMenu()

    expect(screen.queryByTestId('navigation-menu')).toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('renders nothing while the retained Account_Status is not yet known', () => {
    renderMenu()
    signIn(['CANDIDATE'], 'CANDIDATE', null)

    // Authenticated, but `GET /me/status` has not resolved: nothing is admitted
    // yet, so nothing is offered.
    expect(screen.queryByTestId('navigation-menu')).toBeNull()
  })

  const gated: readonly AccountStatus[] = [
    'PendingVerification',
    'PendingApproval',
    'ApprovedPendingMeeting',
    'Rejected',
    'Suspended',
    'Deactivated',
  ]

  for (const status of gated) {
    it(`renders no navigation landmark for a ${status} account`, () => {
      renderMenu()
      signIn(['CANDIDATE', 'SENIOR'], 'CANDIDATE', status)

      expect(screen.queryByTestId('navigation-menu')).toBeNull()
      expect(destinationIds()).toEqual([])
    })
  }
})

// ── The current destination ───────────────────────────────────────────────────

describe('NavigationMenu current destination', () => {
  it('marks the destination whose path is the current location', () => {
    renderMenu({ pathname: ROUTE_PATHS.candidateCvs })
    signIn(['CANDIDATE'], 'CANDIDATE')

    const menu = screen.getByTestId('navigation-menu')
    const current = within(menu)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')

    expect(current).toHaveLength(1)
    expect(current[0]).toHaveAttribute('data-destination', 'candidate-cvs')
  })

  it('keeps the destination marked on a descendant path', () => {
    renderMenu({ pathname: `${ROUTE_PATHS.candidateCvs}/7c9e6679` })
    signIn(['CANDIDATE'], 'CANDIDATE')

    expect(
      within(screen.getByTestId('navigation-menu'))
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page')
        .map((link) => link.getAttribute('data-destination')),
    ).toEqual(['candidate-cvs'])
  })

  it('marks nothing when the location belongs to no destination', () => {
    renderMenu({ pathname: ROUTE_PATHS.statusNotice })
    signIn(['CANDIDATE'], 'CANDIDATE')

    expect(
      within(screen.getByTestId('navigation-menu'))
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page'),
    ).toEqual([])
  })
})

// ── Accessibility and localization (Requirement 20, Requirement 19 AC2) ───────

describe('NavigationMenu presentation', () => {
  it('is a named navigation landmark holding a list of links', () => {
    renderMenu()
    signIn(['CANDIDATE'], 'CANDIDATE')

    const menu = screen.getByTestId('navigation-menu')
    expect(menu.tagName).toBe('NAV')
    expect(menu).toHaveAccessibleName(i18n.t('shell:nav.label'))

    const items = within(menu).getAllByRole('listitem')
    expect(items).toHaveLength(CONTEXT_DESTINATION_IDS.CANDIDATE.length)
  })

  it('labels every entry from the catalogue and links to its declared path', () => {
    renderMenu()
    signIn(['CANDIDATE'], 'CANDIDATE')

    const profile = within(screen.getByTestId('navigation-menu')).getByRole('link', {
      name: i18n.t('shell:nav.profile'),
    })
    expect(profile).toHaveAttribute('href', ROUTE_PATHS.candidateProfile)
    expect(profile).toHaveAttribute('data-destination', 'candidate-profile')
  })

  it('reports an activated destination so the shell can close its drawer', async () => {
    const onNavigate = vi.fn()
    renderMenu({ onNavigate })
    signIn(['CANDIDATE'], 'CANDIDATE')

    await userEvent.click(
      within(screen.getByTestId('navigation-menu')).getByRole('link', {
        name: i18n.t('shell:nav.jobs'),
      }),
    )

    expect(onNavigate).toHaveBeenCalledTimes(1)
  })
})
