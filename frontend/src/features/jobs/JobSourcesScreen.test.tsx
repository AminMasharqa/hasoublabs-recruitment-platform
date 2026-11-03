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
import { JobSourcesScreen } from './JobSourcesScreen'

function sourceFixture(overrides = {}) {
  return {
    id: 'src-1',
    name: 'Hasoub Greenhouse',
    source_type: 'greenhouse',
    slug: 'hasoub',
    poll_interval_hours: 6,
    enabled: true,
    last_polled_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    workday_tenant: null,
    workday_site: null,
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

describe('JobSourcesScreen', () => {
  it('renders loading state initially', () => {
    const api = {
      request: vi.fn().mockReturnValue(new Promise(() => {})),
    } as unknown as ApiClient
    render(React.createElement(JobSourcesScreen), { wrapper: makeWrapper(api) })
    expect(screen.getByTestId('sources-loading')).toBeDefined()
  })

  it('renders source name when loaded', async () => {
    const api = {
      request: vi.fn().mockResolvedValue({ data: [sourceFixture()] }),
    } as unknown as ApiClient
    render(React.createElement(JobSourcesScreen), { wrapper: makeWrapper(api) })
    await waitFor(() => expect(screen.getByTestId('source-row-src-1')).toBeDefined())
    expect(screen.getByText('Hasoub Greenhouse')).toBeDefined()
  })

  it('renders empty state when no sources', async () => {
    const api = {
      request: vi.fn().mockResolvedValue({ data: [] }),
    } as unknown as ApiClient
    render(React.createElement(JobSourcesScreen), { wrapper: makeWrapper(api) })
    await waitFor(() => expect(screen.getByTestId('sources-empty')).toBeDefined())
  })

  it('shows error when delete mutation rejects with 409', async () => {
    const api = {
      request: vi
        .fn()
        .mockResolvedValueOnce({ data: [sourceFixture()] })
        .mockRejectedValueOnce({ error: 'conflicting_state', status: 409 }),
    } as unknown as ApiClient
    render(React.createElement(JobSourcesScreen), { wrapper: makeWrapper(api) })
    await waitFor(() => screen.getByTestId('source-row-src-1'))
    await userEvent.click(screen.getByTestId('delete-src-1'))
    await userEvent.click(await screen.findByTestId('confirm-delete'))
    await waitFor(() => expect(screen.getByTestId('delete-error')).toBeDefined())
  })
})
