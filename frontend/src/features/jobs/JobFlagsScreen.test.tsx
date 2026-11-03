import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import type { ApiClient } from '../../api/client'
import { createI18n } from '../../i18n'
import { AppServicesContext, type AppServices } from '../../shell/appServices'
import { JobFlagsScreen } from './JobFlagsScreen'

function flagFixture(overrides = {}) {
  return {
    id: 'flag-1',
    source_id: 'src-1',
    run_id: 'run-1',
    external_url: 'https://example.com/job/1',
    raw_payload: {},
    missing_fields: ['title', 'company'],
    flagged_at: '2026-01-01T00:00:00Z',
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  }
}

function makeWrapper(api: ApiClient) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const services: AppServices = { api, queryClient, clearServerState: vi.fn() }
  const i18n = createI18n('en')
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(
        I18nextProvider,
        { i18n },
        React.createElement(
          MantineProvider,
          null,
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(AppServicesContext.Provider, { value: services }, children),
          ),
        ),
      ),
    )
}

describe('JobFlagsScreen', () => {
  it('renders empty state when no flags', async () => {
    const api = {
      request: vi.fn().mockResolvedValue({ data: [] }),
    } as unknown as ApiClient
    render(React.createElement(JobFlagsScreen), { wrapper: makeWrapper(api) })
    await waitFor(() => expect(screen.getByTestId('flags-empty')).toBeDefined())
  })

  it('renders flag row when flags exist', async () => {
    const api = {
      request: vi.fn().mockResolvedValue({ data: [flagFixture()] }),
    } as unknown as ApiClient
    render(React.createElement(JobFlagsScreen), { wrapper: makeWrapper(api) })
    await waitFor(() => expect(screen.getByTestId('flag-row-flag-1')).toBeDefined())
  })

  it('shows dismiss confirm dialog', async () => {
    const api = {
      request: vi.fn().mockResolvedValue({ data: [flagFixture()] }),
    } as unknown as ApiClient
    render(React.createElement(JobFlagsScreen), { wrapper: makeWrapper(api) })
    await waitFor(() => screen.getByTestId('dismiss-flag-1'))
    await userEvent.click(screen.getByTestId('dismiss-flag-1'))
    expect(await screen.findByTestId('confirm-dismiss-dialog')).toBeDefined()
  })

  it('create JD button opens modal', async () => {
    const api = {
      request: vi.fn().mockResolvedValue({ data: [flagFixture()] }),
    } as unknown as ApiClient
    render(React.createElement(JobFlagsScreen), { wrapper: makeWrapper(api) })
    await waitFor(() => screen.getByTestId('create-jd-flag-1'))
    await userEvent.click(screen.getByTestId('create-jd-flag-1'))
    expect(await screen.findByTestId('create-jd-modal')).toBeDefined()
  })

  it('create JD modal: submitting with empty title does not call resolveFlag', async () => {
    const api = {
      request: vi.fn().mockResolvedValue({ data: [flagFixture()] }),
    } as unknown as ApiClient
    render(React.createElement(JobFlagsScreen), { wrapper: makeWrapper(api) })
    await waitFor(() => screen.getByTestId('create-jd-flag-1'))
    await userEvent.click(screen.getByTestId('create-jd-flag-1'))
    await userEvent.click(await screen.findByTestId('job-form-submit'))
    expect(api.request).toHaveBeenCalledTimes(1) // only the initial listFlags call
  })
})
