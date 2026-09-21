/**
 * Component tests for the Status_Notice screen (task 15.3).
 *
 * Requirement 7:
 * - AC3 the localized description of the retained `status` is rendered, and the
 *   localized next step is rendered exactly where the retained `next_step` member
 *   is present.
 * - AC4 a `PendingVerification` account is offered a control that navigates to
 *   the Verification_Code entry screen.
 * - AC5 a `Suspended`, `Rejected` or `Deactivated` account is offered the status
 *   and nothing to activate — the logout control AC5 pairs with the notice is the
 *   shell's header control, so the screen presenting no action at all is what
 *   makes "no other action" true.
 *
 * The session is supplied as a context value rather than through a
 * Session_Manager: the only thing this screen reads is the retained status, and
 * building a manager would add a token exchange and a refresh timer to a test
 * about rendered text.
 */

import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import type { i18n as I18nextInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import type { AccountStatus } from '../../api/enums'
import { createI18n, RESOURCES } from '../../i18n'
import { VERIFICATION_PATH } from '../../routing/paths'
import { SessionContext, type SessionContextValue } from '../../session/sessionState'

import { StatusNoticeScreen } from './StatusNoticeScreen'

// ── Harness ───────────────────────────────────────────────────────────────────

let i18n: I18nextInstance

beforeEach(() => {
  i18n = createI18n('en')
})

/** A session holding one retained Account_Status and nothing else this screen reads. */
function session(status: AccountStatus | null, nextStep: string | null): SessionContextValue {
  return {
    authenticated: true,
    principal: null,
    roles: ['CANDIDATE'],
    act: 'CANDIDATE',
    status,
    nextStep,
    subject: status === null ? null : { roles: ['CANDIDATE'], act: 'CANDIDATE', status },
    establishSession: () => null,
    retainStatus: () => undefined,
    logout: () => Promise.resolve(),
    clear: () => undefined,
  }
}

function mount(status: AccountStatus | null, nextStep: string | null = 'Backend prose') {
  return render(
    <MantineProvider>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <SessionContext.Provider value={session(status, nextStep)}>
            <StatusNoticeScreen />
          </SessionContext.Provider>
        </MemoryRouter>
      </I18nextProvider>
    </MantineProvider>,
  )
}

// ── AC3: the localized status and next step ───────────────────────────────────

describe('the retained status and next step (Req 7 AC3)', () => {
  it('renders the localized description of the retained status', () => {
    mount('PendingApproval')

    expect(screen.getByTestId('status-notice-status')).toHaveTextContent(
      RESOURCES.en.onboarding.status.PendingApproval,
    )
    expect(screen.getByTestId('status-notice-description')).toHaveTextContent(
      RESOURCES.en.onboarding.description.PendingApproval,
    )
  })

  it('renders the localized next step rather than the prose the Backend_Api sent', () => {
    mount('PendingApproval', 'Your account is awaiting admin review')

    const nextStep = screen.getByTestId('status-notice-next-step')
    expect(nextStep).toHaveTextContent(RESOURCES.en.onboarding.nextStep.PendingApproval)
    expect(nextStep).not.toHaveTextContent('awaiting admin review')
  })

  it('renders no next step when the retained next_step member is absent', () => {
    mount('Approved', null)

    expect(screen.queryByTestId('status-notice-next-step')).toBeNull()
    expect(screen.getByTestId('status-notice-description')).toBeInTheDocument()
  })

  it('renders the status in the active Locale', async () => {
    mount('Suspended')
    await i18n.changeLanguage('ar')

    expect(screen.getByTestId('status-notice-description')).toHaveTextContent(
      RESOURCES.ar.onboarding.description.Suspended,
    )
  })

  /**
   * The contract declares no such status, so this is the "Backend_Api added one
   * after this catalogue was written" case: the retained value is passed through
   * unchanged rather than the next step being dropped.
   */
  it('falls back to the retained value for a status the catalogue does not describe', () => {
    mount('FutureStatus' as AccountStatus, 'Something new happens next')

    expect(screen.getByTestId('status-notice-next-step')).toHaveTextContent(
      'Something new happens next',
    )
  })

  it('reports that the status is not known yet rather than describing one', () => {
    mount(null)

    expect(screen.queryByTestId('status-notice-status')).toBeNull()
    expect(screen.getByTestId('status-notice-screen')).toHaveTextContent(
      RESOURCES.en.onboarding.unknownStatus,
    )
  })
})

// ── AC4: the Verification_Code control ────────────────────────────────────────

describe('the Verification_Code control (Req 7 AC4)', () => {
  it('navigates a PendingVerification account to the verification screen', () => {
    mount('PendingVerification')

    expect(screen.getByTestId('status-notice-verify')).toHaveAttribute('href', VERIFICATION_PATH)
  })

  it.each(['PendingApproval', 'ApprovedPendingMeeting', 'Approved'] as const)(
    'presents no verification control while the status is %s',
    (status) => {
      mount(status)

      expect(screen.queryByTestId('status-notice-verify')).toBeNull()
    },
  )
})

// ── AC5: status and logout only ───────────────────────────────────────────────

describe('a closed-down account (Req 7 AC5)', () => {
  it.each(['Suspended', 'Rejected', 'Deactivated'] as const)(
    'presents the %s status and nothing to activate',
    (status) => {
      mount(status)

      expect(screen.getByTestId('status-notice-description')).toHaveTextContent(
        RESOURCES.en.onboarding.description[status],
      )
      expect(screen.getByTestId('status-notice-closed')).toBeInTheDocument()
      // No verification control, and no other action either: the only control a
      // closed-down account is offered is the shell's sign-out.
      expect(screen.queryByTestId('status-notice-verify')).toBeNull()
      expect(screen.queryAllByRole('link')).toEqual([])
      expect(screen.queryAllByRole('button')).toEqual([])
    },
  )
})
