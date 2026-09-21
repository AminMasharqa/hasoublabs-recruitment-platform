/**
 * Component tests for the Job_Description detail screen (task 18.1).
 *
 * Requirement 12:
 * - AC6 every returned field is rendered, including the description text and the
 *   required skills resolved through `GET /api/v1/skills`.
 * - AC7 a `Closed` Job_Description carries the closed indicator and a disabled
 *   apply control, with the reason stated.
 * - AC8 each contactable Senior is rendered with their full name and active
 *   channels.
 * - AC9 a Senior reporting `Email` or `Both` gets a mail action; one reporting
 *   `Chat` or `None` gets none.
 * - AC10 a zero-entry contactable-Seniors response renders the localized message.
 */

import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import type { i18n as I18nextInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiClient, ApiSuccess } from '../../api/client'
import { createI18n } from '../../i18n'
import { AppServicesContext, type AppServices } from '../../shell/appServices'

import { JobDetailScreen } from './JobDetailScreen'
import type { JobDescription } from './jobsApi'

// ── Harness ───────────────────────────────────────────────────────────────────

let i18n: I18nextInstance

beforeEach(() => {
  i18n = createI18n('en')
})

function jobFixture(overrides: Partial<JobDescription> = {}): JobDescription {
  return {
    application_channel: 'External_Careers_URL',
    closed_at: null,
    company: 'HasoubLabs',
    created_at: '2024-04-01T08:00:00Z',
    creator_account_id: 'acc-1',
    description: 'Build the platform.\nSecond line.',
    employment_type: 'Full-time',
    experience_level: 'Senior-level',
    external_url: 'https://careers.example.test/roles/1',
    id: 'jd-1',
    location: 'Haifa',
    published_at: '2024-04-02T09:30:00Z',
    required_skill_ids: ['s-1', 's-9'],
    status: 'Open',
    title: 'Platform engineer',
    updated_at: '2024-04-03T10:00:00Z',
    work_model: 'Remote',
    ...overrides,
  }
}

interface Responses {
  readonly job: JobDescription
  readonly skills?: readonly Record<string, unknown>[]
  readonly seniors?: readonly Record<string, unknown>[]
}

/** An Api_Client answering the three reads the detail screen issues. */
function apiAnswering(responses: Responses) {
  const paths: string[] = []

  const request = vi.fn((_method: string, path: string) => {
    paths.push(path)
    const body =
      path === '/api/v1/skills'
        ? (responses.skills ?? [])
        : path === '/api/v1/jobs/{jd_id}/contactable-seniors'
          ? (responses.seniors ?? [])
          : responses.job
    return Promise.resolve({
      data: body,
      response: new Response(null, { status: 200 }),
      supportReference: 'req-ok',
    } satisfies ApiSuccess<unknown>)
  })

  const api: ApiClient = {
    request: request as unknown as ApiClient['request'],
    exchangeRefreshToken: () => Promise.reject(new Error('not used')),
    revokeSession: () => Promise.resolve(),
  }
  return { api, paths }
}

function renderScreen(api: ApiClient, location = '/jobs/jd-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const services: AppServices = { api, queryClient, clearServerState: () => undefined }

  return render(
    <MantineProvider>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <AppServicesContext.Provider value={services}>
            <MemoryRouter initialEntries={[location]}>
              <Routes>
                <Route path="/jobs/:jdId" element={<JobDetailScreen />} />
              </Routes>
            </MemoryRouter>
          </AppServicesContext.Provider>
        </QueryClientProvider>
      </I18nextProvider>
    </MantineProvider>,
  )
}

// ── AC6 ───────────────────────────────────────────────────────────────────────

describe('the Job_Description detail (Req 12 AC6)', () => {
  it('renders every returned field, including the description text', async () => {
    const { api, paths } = apiAnswering({ job: jobFixture() })
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('job-detail-jd-1')).toBeInTheDocument()
    })

    expect(screen.getByTestId('job-detail-title')).toHaveTextContent('Platform engineer')
    expect(screen.getByTestId('job-detail-company')).toHaveTextContent('HasoubLabs')
    expect(screen.getByTestId('job-detail-location')).toHaveTextContent('Haifa')
    expect(screen.getByTestId('job-detail-work-model')).toHaveTextContent('Remote')
    expect(screen.getByTestId('job-detail-employment-type')).toHaveTextContent('Full time')
    expect(screen.getByTestId('job-detail-experience-level')).toHaveTextContent('Senior')
    expect(screen.getByTestId('job-detail-description')).toHaveTextContent('Build the platform.')
    expect(screen.getByTestId('job-detail-application-channel')).toHaveTextContent('careers page')
    expect(screen.getByTestId('job-detail-external-url')).toHaveAttribute(
      'href',
      'https://careers.example.test/roles/1',
    )
    expect(screen.getByTestId('job-detail-creator')).toHaveTextContent('acc-1')
    expect(screen.getByTestId('job-detail-published-at')).toHaveTextContent('2024')
    expect(screen.getByTestId('job-detail-created-at')).toHaveTextContent('2024')
    expect(screen.getByTestId('job-detail-updated-at')).toHaveTextContent('2024')
    expect(screen.getByTestId('job-status')).toHaveTextContent('Open')

    expect(paths).toContain('/api/v1/jobs/{jd_id}')
  })

  it('resolves the required skills through the taxonomy and marks what it cannot name', async () => {
    const { api, paths } = apiAnswering({
      job: jobFixture(),
      skills: [{ id: 's-1', name: 'TypeScript' }],
    })
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('job-required-skill-s-1')).toHaveTextContent('TypeScript')
    })
    // AC6: an identifier the taxonomy page did not name is still shown as required.
    expect(screen.getByTestId('job-required-skill-s-9')).toHaveTextContent('s-9')
    expect(screen.getByTestId('job-unresolved-skills-note')).toBeInTheDocument()
    expect(paths).toContain('/api/v1/skills')
  })

  it('states the absence of a description and of required skills', async () => {
    const { api } = apiAnswering({
      job: jobFixture({ description: null, required_skill_ids: [], external_url: null }),
    })
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('job-detail-description-missing')).toBeInTheDocument()
    })
    expect(screen.getByTestId('job-required-skills-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('job-detail-external-url')).toBeNull()
  })
})

// ── AC7 ───────────────────────────────────────────────────────────────────────

describe('a closed Job_Description in the detail view (Req 12 AC7)', () => {
  it('renders the closed indicator and disables the apply control with its reason', async () => {
    const { api } = apiAnswering({
      job: jobFixture({ status: 'Closed', closed_at: '2024-05-01T00:00:00Z' }),
    })
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('job-status-closed')).toHaveTextContent('Closed')
    })
    expect(screen.getByTestId('job-detail-closed-notice')).toBeInTheDocument()
    expect(screen.getByTestId('job-detail-closed-at')).toHaveTextContent('2024')

    const apply = screen.getByTestId('job-apply')
    expect(apply).toBeDisabled()
    expect(apply).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('job-apply-reason')).toHaveTextContent(
      'Applications are closed for this role.',
    )
  })

  it('leaves the apply control enabled for an Open Job_Description', async () => {
    const { api } = apiAnswering({ job: jobFixture() })
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('job-apply')).toBeEnabled()
    })
    expect(screen.queryByTestId('job-detail-closed-notice')).toBeNull()
  })
})

// ── AC8, AC9, AC10 ────────────────────────────────────────────────────────────

describe('the contactable Seniors (Req 12 AC8, AC9, AC10)', () => {
  it('renders each Senior with their channels and a mail action for Email or Both', async () => {
    const { api, paths } = apiAnswering({
      job: jobFixture(),
      seniors: [
        { account_id: 'a-1', full_name: 'Dana', contact_channel_pref: 'Email', email: 'dana@x.test' },
        { account_id: 'a-2', full_name: 'Noa', contact_channel_pref: 'Both', email: 'noa@x.test' },
        { account_id: 'a-3', full_name: 'Ron', contact_channel_pref: 'Chat' },
      ],
    })
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('contactable-seniors-list')).toBeInTheDocument()
    })
    expect(paths).toContain('/api/v1/jobs/{jd_id}/contactable-seniors')

    // AC8: name and active channels.
    expect(screen.getByTestId('contact-senior-name-a-1')).toHaveTextContent('Dana')
    expect(screen.getByTestId('contact-senior-channels-a-1')).toHaveTextContent('Email')
    const bothChannels = within(screen.getByTestId('contact-senior-channels-a-2'))
    expect(bothChannels.getByText('In-platform chat')).toBeInTheDocument()
    expect(bothChannels.getByText('Email')).toBeInTheDocument()

    // AC9: the address as a mail action, for Email and Both only.
    expect(screen.getByTestId('contact-senior-mail-a-1')).toHaveAttribute(
      'href',
      'mailto:dana@x.test',
    )
    expect(screen.getByTestId('contact-senior-mail-a-2')).toHaveAttribute(
      'href',
      'mailto:noa@x.test',
    )
    expect(screen.queryByTestId('contact-senior-mail-a-3')).toBeNull()
    expect(screen.getByTestId('contact-senior-channels-a-3')).toHaveTextContent('In-platform chat')
  })

  it('reports an absent address rather than fabricating one', async () => {
    const { api } = apiAnswering({
      job: jobFixture(),
      seniors: [{ account_id: 'a-1', full_name: 'Dana', contact_channel_pref: 'Email' }],
    })
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('contact-senior-mail-missing-a-1')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('contact-senior-mail-a-1')).toBeNull()
  })

  it('states that no Senior is available to contact when the response is empty', async () => {
    const { api } = apiAnswering({ job: jobFixture(), seniors: [] })
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('contactable-seniors-empty')).toBeInTheDocument()
    })
    expect(screen.getByTestId('contactable-seniors-empty')).toHaveTextContent(
      'No seniors are currently available to contact for this role.',
    )
    expect(screen.queryByTestId('contactable-seniors-list')).toBeNull()
  })
})
