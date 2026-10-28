/**
 * Component tests for the Job_Description browse screen (task 18.1).
 *
 * Requirement 12:
 * - AC1 each entry renders the seven contract fields.
 * - AC2 every applied filter is sent as a query parameter of `GET /api/v1/jobs`.
 * - AC3 at most 20 Job_Descriptions are requested per page.
 * - AC4 the next-page control sends the response's `next_cursor` as the keyset
 *   cursor of the following request, and is absent when no further page exists.
 * - AC5 a zero-item page renders the empty state with the applied filters retained
 *   in the address and in the controls.
 * - AC7 a `Closed` entry carries the closed indicator and a disabled apply control.
 */

import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { i18n as I18nextInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiClient, ApiSuccess } from '../../api/client'
import { createI18n } from '../../i18n'
import { AppServicesContext, type AppServices } from '../../shell/appServices'

import type { JobDescription } from './jobsApi'
import { JobsBrowseScreen } from './JobsBrowseScreen'

// ── Harness ───────────────────────────────────────────────────────────────────

let i18n: I18nextInstance

beforeEach(() => {
  i18n = createI18n('en')
})

/** One recorded request: the path and the query the screen asked for. */
interface RecordedRequest {
  readonly path: string
  readonly query: Record<string, unknown> | undefined
}

/** A Job_Description with every member the contract declares. */
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
    id: 'jd-1',
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

/**
 * An Api_Client answering the browse read from a queue of pages, and the skill
 * search with a fixed taxonomy page.
 */
function apiAnswering(
  pages: readonly { readonly items: readonly JobDescription[]; readonly next?: string | null }[],
  skills: readonly Record<string, unknown>[] = [],
) {
  const requests: RecordedRequest[] = []
  let served = 0

  const request = vi.fn((_method: string, path: string, init?: unknown) => {
    const params = (init as { params?: { query?: Record<string, unknown> } } | undefined)?.params
    requests.push({ path, query: params?.query })

    if (path === '/api/v1/skills') {
      return Promise.resolve({
        data: skills,
        response: new Response(null, { status: 200 }),
        supportReference: 'req-skills',
      } satisfies ApiSuccess<unknown>)
    }

    const page = pages[Math.min(served, pages.length - 1)]
    served += 1
    return Promise.resolve({
      data: {
        items: page?.items ?? [],
        has_next: (page?.next ?? null) !== null,
        next_cursor: page?.next ?? null,
      },
      response: new Response(null, { status: 200 }),
      supportReference: 'req-browse',
    } satisfies ApiSuccess<unknown>)
  })

  const api: ApiClient = {
    request: request as unknown as ApiClient['request'],
    exchangeRefreshToken: () => Promise.reject(new Error('not used')),
    revokeSession: () => Promise.resolve(),
  }
  return { api, requests }
}

/** The browse query of the most recent `GET /api/v1/jobs` request. */
function lastBrowseQuery(requests: readonly RecordedRequest[]): Record<string, unknown> {
  const browse = requests.filter((entry) => entry.path === '/api/v1/jobs')
  return browse[browse.length - 1]?.query ?? {}
}

function renderScreen(api: ApiClient, location = '/jobs') {
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
                <Route path="/jobs" element={<JobsBrowseScreen />} />
              </Routes>
            </MemoryRouter>
          </AppServicesContext.Provider>
        </QueryClientProvider>
      </I18nextProvider>
    </MantineProvider>,
  )
}

// ── AC1, AC3 ──────────────────────────────────────────────────────────────────

describe('the browse list (Req 12 AC1, AC3)', () => {
  it('renders the contract fields of each entry and requests at most 20 rows', async () => {
    const { api, requests } = apiAnswering([{ items: [jobFixture()] }])
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('job-card-jd-1')).toBeInTheDocument()
    })

    const card = within(screen.getByTestId('job-card-jd-1'))
    expect(card.getByTestId('job-title-jd-1')).toHaveTextContent('Platform engineer')
    expect(card.getByTestId('job-company-jd-1')).toHaveTextContent('HasoubLabs')
    expect(card.getByTestId('job-location-jd-1')).toHaveTextContent('Haifa')
    expect(card.getByTestId('job-work-model-jd-1')).toHaveTextContent('Hybrid')
    expect(card.getByTestId('job-employment-type-jd-1')).toHaveTextContent('Full time')
    expect(card.getByTestId('job-experience-level-jd-1')).toHaveTextContent('Mid level')
    expect(card.getByTestId('job-published-at-jd-1')).toHaveTextContent('2024')

    expect(lastBrowseQuery(requests)).toEqual({ limit: 20 })
  })
})

// ── AC2 ───────────────────────────────────────────────────────────────────────

describe('the filter controls (Req 12 AC2)', () => {
  it('sends the filters carried by the address as query parameters', async () => {
    const { api, requests } = apiAnswering([{ items: [jobFixture()] }])
    renderScreen(
      api,
      '/jobs?search=platform&location=Haifa&skills=s-1&work_model=Remote&employment_type=Contract&experience_level=Lead',
    )

    await waitFor(() => {
      expect(screen.getByTestId('jobs-list')).toBeInTheDocument()
    })

    expect(lastBrowseQuery(requests)).toEqual({
      limit: 20,
      search: 'platform',
      location: 'Haifa',
      skills: ['s-1'],
      work_model: 'Remote',
      employment_type: 'Contract',
      experience_level: 'Lead',
    })
  })

  it('applies an edited filter as a query parameter of the next request', async () => {
    const user = userEvent.setup()
    const { api, requests } = apiAnswering([{ items: [jobFixture()] }])
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('jobs-list')).toBeInTheDocument()
    })

    await user.type(screen.getByTestId('job-filter-search'), 'engineer')
    await user.click(screen.getByTestId('job-filters-apply'))

    await waitFor(() => {
      expect(lastBrowseQuery(requests)).toEqual({ limit: 20, search: 'engineer' })
    })
  })

  it('offers a searched skill as a filter and sends the chosen identifier', async () => {
    const user = userEvent.setup()
    const { api, requests } = apiAnswering(
      [{ items: [jobFixture()] }],
      [{ id: 's-7', name: 'Kubernetes' }],
    )
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('jobs-list')).toBeInTheDocument()
    })

    await user.type(screen.getByTestId('job-filter-skill-search'), 'kube')

    await waitFor(() => {
      expect(screen.getByTestId('job-filter-skill-s-7')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('Kubernetes')).toBeInTheDocument()

    await user.click(screen.getByTestId('job-filter-skill-s-7'))
    await user.click(screen.getByTestId('job-filters-apply'))

    await waitFor(() => {
      expect(lastBrowseQuery(requests)).toEqual({ limit: 20, skills: ['s-7'] })
    })
  })
})

// ── AC4 ───────────────────────────────────────────────────────────────────────

describe('keyset pagination (Req 12 AC4)', () => {
  /** A `next_cursor` token as the Backend_Api issues it. */
  const token = btoa(
    JSON.stringify({ after_published_at: '2024-04-02T09:30:00Z', after_id: 'jd-1' }),
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  it('sends the advertised token as the keyset cursor of the next request', async () => {
    const user = userEvent.setup()
    const { api, requests } = apiAnswering([
      { items: [jobFixture()], next: token },
      { items: [jobFixture({ id: 'jd-2', title: 'Second page role' })] },
    ])
    renderScreen(api, '/jobs?search=platform')

    await waitFor(() => {
      expect(screen.getByTestId('jobs-next-page')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('jobs-next-page'))

    await waitFor(() => {
      expect(screen.getByTestId('job-card-jd-2')).toBeInTheDocument()
    })
    // AC4: the token decoded into the keyset pair, alongside the retained filter.
    expect(lastBrowseQuery(requests)).toEqual({
      limit: 20,
      search: 'platform',
      after_published_at: '2024-04-02T09:30:00Z',
      after_id: 'jd-1',
    })
  })

  it('presents no next-page control when the response advertises no further page', async () => {
    const { api } = apiAnswering([{ items: [jobFixture()] }])
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('jobs-list')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('jobs-next-page')).toBeNull()
  })
})

// ── AC5 ───────────────────────────────────────────────────────────────────────

describe('the empty state (Req 12 AC5)', () => {
  it('states that nothing matched and retains the applied filter values', async () => {
    const { api } = apiAnswering([{ items: [] }])
    renderScreen(api, '/jobs?search=platform&location=Haifa')

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    })
    expect(screen.getByTestId('empty-state')).toHaveTextContent('match the current filters')

    // AC5: the values are still on the controls, ready to be narrowed further.
    expect(screen.getByTestId('job-filter-search')).toHaveValue('platform')
    expect(screen.getByTestId('job-filter-location')).toHaveValue('Haifa')
  })

  it('clears the filters from the empty state and the controls together', async () => {
    const user = userEvent.setup()
    const { api } = apiAnswering([{ items: [] }])
    renderScreen(api, '/jobs?search=platform')

    await waitFor(() => {
      expect(screen.getByTestId('empty-state-clear-filters')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('empty-state-clear-filters'))

    await waitFor(() => {
      expect(screen.getByTestId('job-filter-search')).toHaveValue('')
    })
    expect(screen.getByTestId('empty-state')).not.toHaveTextContent('match the current filters')
  })

  it('names the destination without offering a clear control when no filter is applied', async () => {
    const { api } = apiAnswering([{ items: [] }])
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toHaveTextContent('Jobs')
    })
    expect(screen.queryByTestId('empty-state-clear-filters')).toBeNull()
  })
})

// ── AC7 ───────────────────────────────────────────────────────────────────────

describe('a closed Job_Description in the list (Req 12 AC7)', () => {
  it('carries the closed indicator and disables the apply control', async () => {
    const { api } = apiAnswering([
      {
        items: [
          jobFixture({ id: 'jd-open' }),
          jobFixture({ id: 'jd-closed', status: 'Closed', closed_at: '2024-05-01T00:00:00Z' }),
        ],
      },
    ])
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('job-card-jd-closed')).toBeInTheDocument()
    })

    const closed = within(screen.getByTestId('job-card-jd-closed'))
    expect(closed.getByTestId('job-status-closed')).toHaveTextContent('Closed')
    const closedApply = closed.getByTestId('job-apply')
    expect(closedApply).toBeDisabled()
    expect(closedApply).toHaveAttribute('aria-disabled', 'true')

    const open = within(screen.getByTestId('job-card-jd-open'))
    expect(open.queryByTestId('job-status-closed')).toBeNull()
    expect(open.getByTestId('job-apply')).toBeEnabled()
  })
})
