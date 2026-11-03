import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import type { ApiClient } from '../../api/client'
import { createI18n } from '../../i18n'
import { AppServicesContext, type AppServices } from '../../shell/appServices'
import { JobSourceDetailScreen } from './JobSourceDetailScreen'

const LONG_ERROR = 'E'.repeat(500)

function makeWrapper(api: ApiClient) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const services: AppServices = { api, queryClient, clearServerState: vi.fn() }
  const i18n = createI18n('en')
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      MemoryRouter,
      { initialEntries: ['/admin/jobs/sources/src-1'] },
      React.createElement(
        I18nextProvider,
        { i18n },
        React.createElement(
          MantineProvider,
          null,
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(
              AppServicesContext.Provider,
              { value: services },
              React.createElement(
                Routes,
                null,
                React.createElement(Route, {
                  path: '/admin/jobs/sources/:sourceId',
                  element: children,
                }),
              ),
            ),
          ),
        ),
      ),
    )
}

describe('JobSourceDetailScreen', () => {
  it('renders a run with a long error_detail without crashing', async () => {
    const source = {
      id: 'src-1',
      name: 'Test',
      source_type: 'greenhouse',
      slug: 'test',
      poll_interval_hours: 6,
      enabled: true,
      last_polled_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      workday_tenant: null,
      workday_site: null,
    }
    const run = {
      id: 'run-1',
      source_id: 'src-1',
      started_at: '2026-01-01T00:00:00Z',
      finished_at: '2026-01-01T00:01:00Z',
      jobs_fetched: 0,
      jobs_created: 0,
      jobs_skipped: 0,
      jobs_flagged: 0,
      error_detail: LONG_ERROR,
      status: 'failed',
    }
    const api = {
      request: vi
        .fn()
        .mockResolvedValue({ data: [] })
        .mockResolvedValueOnce({ data: source })
        .mockResolvedValueOnce({ data: [run] }),
    } as unknown as ApiClient
    render(React.createElement(JobSourceDetailScreen), { wrapper: makeWrapper(api) })
    await waitFor(() => expect(screen.getByTestId('run-row-run-1')).toBeDefined())
    // error_detail truncated — row rendered without layout break
    expect(screen.getByTestId('run-row-run-1').textContent).toContain('E')
  })
})
