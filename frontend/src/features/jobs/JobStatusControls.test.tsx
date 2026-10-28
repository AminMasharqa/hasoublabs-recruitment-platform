/**
 * Component tests for the apply control's identifier wiring (Req 12 AC7, Req 14 AC1).
 *
 * AC1 asks for a single apply control on the Job_Description that opens the apply
 * flow; AC7 puts that control in the list entry as well as in the detail view. So the
 * subject here is *which role* the control knows it is applying to:
 *
 * - a list entry names its own identifier, because `/jobs` carries no `:jdId`
 *   parameter to fall back on — the dialog must open on the entry that was pressed;
 * - a control mounted with no identifier at all keeps the spoken "not available"
 *   notice, which is the only remaining path to the fallback and is what keeps an
 *   unwired control from silently ignoring a click.
 *
 * The CV_Variant list the dialog reads is answered empty: the dialog's own behaviour
 * is Requirement 14's tests, and all that is asserted here is that it opened against
 * the right Job_Description.
 */

import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { i18n as I18nextInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiClient, ApiSuccess } from '../../api/client'
import { createI18n } from '../../i18n'
import { AppServicesContext, type AppServices } from '../../shell/appServices'

import { JobCard } from './JobCard'
import type { JobDescription } from './jobsApi'
import { ApplyControl } from './JobStatusControls'

// ── Harness ───────────────────────────────────────────────────────────────────

let i18n: I18nextInstance

beforeEach(() => {
  i18n = createI18n('en')
})

function jobFixture(overrides: Partial<JobDescription> = {}): JobDescription {
  return {
    application_channel: 'Senior_Dashboard',
    closed_at: null,
    company: 'HasoubLabs',
    created_at: '2024-04-01T08:00:00Z',
    creator_account_id: 'acc-1',
    description: 'Build the platform.',
    employment_type: 'Full-time',
    experience_level: 'Mid-level',
    external_url: null,
    id: 'jd-7',
    location: 'Haifa',
    published_at: '2024-04-02T09:30:00Z',
    required_skill_ids: [],
    status: 'Open',
    title: 'Platform engineer',
    updated_at: '2024-04-02T09:30:00Z',
    work_model: 'Hybrid',
    ...overrides,
  }
}

/** An Api_Client answering every read with an empty collection. */
function emptyApi(): { readonly api: ApiClient; readonly paths: string[] } {
  const paths: string[] = []
  const request = vi.fn((_method: string, path: string) => {
    paths.push(path)
    return Promise.resolve({
      data: [],
      response: new Response(null, { status: 200 }),
      supportReference: 'req-ok',
    } satisfies ApiSuccess<unknown>)
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

/** Mounts one element under the providers the control and the dialog need. */
function mount(api: ApiClient, element: React.ReactNode, routed = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const services: AppServices = { api, queryClient, clearServerState: () => undefined }

  return render(
    <MantineProvider>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <AppServicesContext.Provider value={services}>
            {/* `/jobs` deliberately carries no `:jdId`, as the browse list does not. */}
            {routed ? <MemoryRouter initialEntries={['/jobs']}>{element}</MemoryRouter> : element}
          </AppServicesContext.Provider>
        </QueryClientProvider>
      </I18nextProvider>
    </MantineProvider>,
  )
}

// ── Req 14 AC1 in the list entry ──────────────────────────────────────────────

describe('the apply control of a list entry (Req 12 AC7, Req 14 AC1)', () => {
  it('opens the apply flow against the entry it was rendered for', async () => {
    const user = userEvent.setup()
    mount(emptyApi().api, <JobCard job={jobFixture()} />)

    await user.click(screen.getByTestId('job-apply'))

    await waitFor(() => {
      expect(screen.getByTestId('apply-dialog')).toBeInTheDocument()
    })
    // The identifier reached the dialog from the entry, not from the address.
    expect(screen.getByTestId('apply-dialog')).toHaveAttribute('data-jd', 'jd-7')
    expect(screen.queryByTestId('job-apply-notice')).toBeNull()
  })
})

// ── The fallback notice ───────────────────────────────────────────────────────

describe('an apply control that names no Job_Description', () => {
  it('states that applying is unavailable rather than ignoring the activation', async () => {
    const user = userEvent.setup()
    // Standalone: no `jdId` prop, and no route to take one from.
    mount(emptyApi().api, <ApplyControl status="Open" title="Platform engineer" />, false)

    await user.click(screen.getByTestId('job-apply'))

    expect(screen.getByTestId('job-apply-notice')).toHaveTextContent(
      'Submitting an application is not available in this build yet.',
    )
    expect(screen.queryByTestId('apply-dialog')).toBeNull()
  })
})
