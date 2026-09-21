/**
 * The apply gate, asserted through the control it governs (Requirement 9 AC13).
 *
 * AC13 is a statement about apply controls, not about the profile screen: "disable
 * every apply control and present the unmet conditions as the reason". So the
 * subject here is the real `ApplyControl` of the jobs slice mounted under the real
 * `CandidateApplyGateProvider` over a stub Api_Client — the cross-slice wiring is
 * the thing that can be wrong, and a test of the predicate alone would not notice
 * an unwired control.
 *
 * The session is supplied as a context value rather than through a Session_Manager:
 * the only claim this behaviour reads is `act`, and building a manager would add a
 * token exchange, a refresh timer and a router redirect to a test about a disabled
 * button.
 */

import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import type { i18n as I18nextInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiClient } from '../../../api/client'
import { createI18n } from '../../../i18n'
import { SessionContext, type SessionContextValue } from '../../../session/sessionState'
import { AppServicesContext, type AppServices } from '../../../shell/appServices'
import { ApplyControl } from '../../jobs'

import { CandidateApplyGateProvider } from './ApplyGateProvider'
import type { CandidateProfile } from './model'
import { MY_PROFILE_PATH } from './queries'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function profile(overrides: Partial<CandidateProfile> = {}): CandidateProfile {
  return {
    id: 'profile-1',
    account_id: 'account-1',
    full_name: 'Layla Haddad',
    email: 'layla@example.com',
    phone: '+972500000000',
    city: 'Haifa',
    summary: null,
    linkedin_url: null,
    state: 'Draft',
    education: [],
    work_experience: [],
    skills: [],
    languages: [],
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

interface Backend {
  readonly paths: string[]
  readonly api: ApiClient
}

/** An Api_Client answering `GET /me/profile` with a profile, or with a 404. */
function backend(stored: CandidateProfile | null): Backend {
  const paths: string[] = []
  const request = vi.fn((_method: string, path: string) => {
    paths.push(path)
    if (stored === null) {
      return Promise.reject({ error: 'not_found', httpStatus: 404, fieldViolations: [] })
    }
    return Promise.resolve({
      data: stored,
      response: new Response(null, { status: 200 }),
      supportReference: 'req-ok',
    })
  })

  return {
    paths,
    api: {
      request: request as unknown as ApiClient['request'],
      exchangeRefreshToken: () => Promise.reject(new Error('not used')),
      revokeSession: () => Promise.resolve(),
    },
  }
}

/** A session holding one Active_Context and nothing else this behaviour reads. */
function session(act: 'CANDIDATE' | 'SENIOR' | 'ADMIN'): SessionContextValue {
  return {
    authenticated: true,
    principal: null,
    roles: [act],
    act,
    status: 'Approved',
    nextStep: null,
    subject: { roles: [act], act, status: 'Approved' },
    establishSession: () => null,
    retainStatus: () => undefined,
    logout: () => Promise.resolve(),
    clear: () => undefined,
  }
}

let i18n: I18nextInstance

beforeEach(() => {
  i18n = createI18n('en')
})

function mount(api: ApiClient, act: 'CANDIDATE' | 'SENIOR' | 'ADMIN', showReason = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const services: AppServices = { api, queryClient, clearServerState: () => undefined }

  return render(
    <MantineProvider>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <AppServicesContext.Provider value={services}>
            <SessionContext.Provider value={session(act)}>
              <CandidateApplyGateProvider>
                <ApplyControl status="Open" title="Platform engineer" showReason={showReason} />
              </CandidateApplyGateProvider>
            </SessionContext.Provider>
          </AppServicesContext.Provider>
        </QueryClientProvider>
      </I18nextProvider>
    </MantineProvider>,
  )
}

function applyControl(): HTMLElement {
  return screen.getByTestId('job-apply')
}

// ── AC13 ──────────────────────────────────────────────────────────────────────

describe('the apply gate in a Candidate context (Req 9 AC13)', () => {
  it('disables the apply control while the profile state is Draft and names the unmet conditions', async () => {
    const api = backend(profile({ phone: null }))
    mount(api.api, 'CANDIDATE')

    // The itemized conditions appear once the read has answered; the control is
    // disabled from the first frame, before the profile is known.
    expect(applyControl()).toBeDisabled()
    await waitFor(() => {
      expect(screen.getByTestId('job-apply-profile-missing')).toBeInTheDocument()
    })
    expect(applyControl()).toBeDisabled()
    expect(applyControl()).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('job-apply-profile-reason')).toHaveTextContent(
      'Your profile is a draft.',
    )

    const named = [
      ...screen.getByTestId('job-apply-profile-missing').querySelectorAll('[data-missing-field]'),
    ].map((item) => item.getAttribute('data-missing-field'))
    expect(named).toEqual(['phone', 'education', 'skills'])

    // Req 20 AC8: the reason is part of the control's accessible description.
    expect(applyControl().getAttribute('aria-describedby')).toContain('profile-reason')
    expect(api.paths).toContain(MY_PROFILE_PATH)
  })

  it('enables the apply control once the reported state is Complete', async () => {
    mount(backend(profile({ state: 'Complete' })).api, 'CANDIDATE')

    await waitFor(() => {
      expect(applyControl()).toBeEnabled()
    })
    expect(screen.queryByTestId('job-apply-profile-reason')).toBeNull()
  })

  it('keeps the control disabled while no profile is stored yet', async () => {
    mount(backend(null).api, 'CANDIDATE')

    await waitFor(() => {
      expect(screen.getByTestId('job-apply-profile-reason')).toBeInTheDocument()
    })
    expect(applyControl()).toBeDisabled()
  })

  it('states the condition without itemizing it on a dense surface', async () => {
    const api = backend(profile())
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const services: AppServices = {
      api: api.api,
      queryClient,
      clearServerState: () => undefined,
    }

    // Both variants over one gate, so "itemized only where there is room" is
    // asserted against a profile that has demonstrably arrived: the roomy control
    // shows the list, and the dense one beside it does not.
    render(
      <MantineProvider>
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={queryClient}>
            <AppServicesContext.Provider value={services}>
              <SessionContext.Provider value={session('CANDIDATE')}>
                <CandidateApplyGateProvider>
                  <div data-testid="dense-surface">
                    <ApplyControl status="Open" title="Platform engineer" />
                  </div>
                  <div data-testid="roomy-surface">
                    <ApplyControl status="Open" title="Platform engineer" showReason />
                  </div>
                </CandidateApplyGateProvider>
              </SessionContext.Provider>
            </AppServicesContext.Provider>
          </QueryClientProvider>
        </I18nextProvider>
      </MantineProvider>,
    )

    const dense = within(screen.getByTestId('dense-surface'))
    const roomy = within(screen.getByTestId('roomy-surface'))

    await waitFor(() => {
      expect(roomy.getByTestId('job-apply-profile-missing')).toBeInTheDocument()
    })
    expect(dense.getByTestId('job-apply')).toBeDisabled()
    expect(dense.getByTestId('job-apply-profile-reason')).toBeInTheDocument()
    expect(dense.queryByTestId('job-apply-profile-missing')).toBeNull()
  })
})

describe('the apply gate outside a Candidate context (Req 9 AC13)', () => {
  it('issues no profile read and leaves the control to the Job_Description status', async () => {
    const api = backend(profile())
    mount(api.api, 'SENIOR')

    await waitFor(() => {
      expect(applyControl()).toBeEnabled()
    })
    expect(api.paths).toEqual([])
    expect(screen.queryByTestId('job-apply-profile-reason')).toBeNull()
  })
})

describe('a closed Job_Description and a draft profile (Req 12 AC7, Req 9 AC13)', () => {
  it('states both reasons rather than collapsing them into one', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const api = backend(profile())
    const services: AppServices = {
      api: api.api,
      queryClient,
      clearServerState: () => undefined,
    }

    render(
      <MantineProvider>
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={queryClient}>
            <AppServicesContext.Provider value={services}>
              <SessionContext.Provider value={session('CANDIDATE')}>
                <CandidateApplyGateProvider>
                  <ApplyControl status="Closed" title="Platform engineer" showReason />
                </CandidateApplyGateProvider>
              </SessionContext.Provider>
            </AppServicesContext.Provider>
          </QueryClientProvider>
        </I18nextProvider>
      </MantineProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('job-apply-profile-reason')).toBeInTheDocument()
    })
    expect(screen.getByTestId('job-apply-reason')).toHaveTextContent(
      'Applications are closed for this role.',
    )
    expect(applyControl()).toBeDisabled()
  })
})
