/**
 * Component tests for the diagnostics surface (task 12.3).
 *
 * Requirement 23:
 * - AC5 the bundle version identifier is reported, and its absence is reported as
 *   absence rather than as a plausible-looking placeholder.
 * - AC6 `GET /health` is called from the surface and the returned status is
 *   rendered.
 * - AC1/AC3 a failed probe renders its Support_Reference with a retry control,
 *   and the retained reference of the most recent failed request is readable here.
 * - AC4 a surface whose reads all succeeded renders no Support_Reference at all.
 */

import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { i18n as I18nextInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiClient, ApiSuccess } from '../../api/client'
import {
  clearFailedSupportReference,
  recordFailedSupportReference,
} from '../../errors/supportReferenceStore'
import { createI18n } from '../../i18n'
import { AppServicesContext, type AppServices } from '../../shell/appServices'

import { DiagnosticsScreen } from './DiagnosticsScreen'
import { HEALTH_PATH } from './health'

// ── Harness ───────────────────────────────────────────────────────────────────

let i18n: I18nextInstance

beforeEach(() => {
  clearFailedSupportReference()
  i18n = createI18n('en')
})

afterEach(() => {
  clearFailedSupportReference()
})

/** A one-method Api_Client stub: the screen issues exactly one kind of request. */
function apiAnswering(request: ApiClient['request']): ApiClient {
  return {
    request,
    exchangeRefreshToken: () => Promise.reject(new Error('not used')),
    revokeSession: () => Promise.resolve(),
  }
}

/** Resolves the probe with `body`, recording every call. */
function respondWith(body: unknown) {
  const calls: { method: string; path: string }[] = []
  const request = vi.fn((method: string, path: string) => {
    calls.push({ method, path })
    return Promise.resolve({
      data: body,
      response: new Response(null, { status: 200 }),
      supportReference: 'req-ok',
    } satisfies ApiSuccess<unknown>)
  })
  return { calls, request: request as unknown as ApiClient['request'] }
}

function renderScreen(api: ApiClient) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const services: AppServices = {
    api,
    queryClient,
    clearServerState: () => undefined,
  }

  return render(
    <MantineProvider>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <AppServicesContext.Provider value={services}>
            <DiagnosticsScreen />
          </AppServicesContext.Provider>
        </QueryClientProvider>
      </I18nextProvider>
    </MantineProvider>,
  )
}

// ── AC6: the probe and the rendered status ────────────────────────────────────

describe('the diagnostics surface (Req 23 AC5, AC6)', () => {
  it('calls GET /health and renders the returned status', async () => {
    const probe = respondWith({ status: 'ok' })
    renderScreen(apiAnswering(probe.request))

    await waitFor(() => {
      expect(screen.getByTestId('diagnostics-health-status')).toHaveTextContent('ok')
    })
    expect(probe.calls).toEqual([{ method: 'get', path: HEALTH_PATH }])
    expect(screen.getByTestId('diagnostics-health-indicator')).toHaveTextContent(
      'reporting itself healthy',
    )
    // Req 19 AC12: the authoritative UTC value is shown beside the localized one.
    expect(screen.getByTestId('diagnostics-health-checked-at')).toHaveTextContent('UTC')
  })

  it('renders a status the service reports verbatim, however it reads', async () => {
    const probe = respondWith({ status: 'degraded' })
    renderScreen(apiAnswering(probe.request))

    await waitFor(() => {
      expect(screen.getByTestId('diagnostics-health-status')).toHaveTextContent('degraded')
    })
    expect(screen.getByTestId('diagnostics-health-indicator')).toHaveTextContent(
      'reporting something else',
    )
  })

  it('reports reachability when the probe answers with no status', async () => {
    const probe = respondWith({})
    renderScreen(apiAnswering(probe.request))

    await waitFor(() => {
      expect(screen.getByTestId('diagnostics-health-indicator')).toHaveTextContent(
        'reporting no status',
      )
    })
    expect(screen.queryByTestId('diagnostics-health-status')).toBeNull()
  })

  // AC5: the build applies no `define` under vitest, so this asserts the
  // absence branch — which is the one that must not invent an identifier.
  it('reports that the build recorded no version identifier rather than inventing one', () => {
    const probe = respondWith({ status: 'ok' })
    renderScreen(apiAnswering(probe.request))

    expect(screen.getByTestId('diagnostics-bundle-version-unknown')).toBeInTheDocument()
    expect(screen.queryByTestId('diagnostics-bundle-version')).toBeNull()
  })

  it('renders no Support_Reference while every read has succeeded (AC4)', async () => {
    const probe = respondWith({ status: 'ok' })
    renderScreen(apiAnswering(probe.request))

    await waitFor(() => {
      expect(screen.getByTestId('diagnostics-health-indicator')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('support-reference')).toBeNull()
  })
})

// ── AC1, AC3: failure surfaces ────────────────────────────────────────────────

describe('the diagnostics surface on failure (Req 23 AC1, AC3)', () => {
  it('renders the failed probe with its Support_Reference and retries on request', async () => {
    const user = userEvent.setup()
    let attempts = 0
    const request = vi.fn(() => {
      attempts += 1
      if (attempts === 1) {
        return Promise.reject({
          error: 'upstream_unavailable',
          message: null,
          details: { service: 'db' },
          request_id: 'req-failed',
          httpStatus: 503,
          supportReference: 'req-failed',
          refreshEligible: false,
          authOutcome: 'other',
          fieldViolations: [],
        })
      }
      return Promise.resolve({
        data: { status: 'ok' },
        response: new Response(null, { status: 200 }),
        supportReference: 'req-ok',
      } satisfies ApiSuccess<unknown>)
    })

    renderScreen(apiAnswering(request as unknown as ApiClient['request']))

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeInTheDocument()
    })
    expect(screen.getByTestId('support-reference-value')).toHaveTextContent('req-failed')

    await user.click(screen.getByTestId('error-retry'))

    await waitFor(() => {
      expect(screen.getByTestId('diagnostics-health-status')).toHaveTextContent('ok')
    })
  })

  it('renders the retained reference of an earlier failed request', async () => {
    // Recorded by the Api_Client failure observer during some earlier screen.
    recordFailedSupportReference('req-earlier')
    const probe = respondWith({ status: 'ok' })
    renderScreen(apiAnswering(probe.request))

    await waitFor(() => {
      expect(screen.getByTestId('diagnostics-health-indicator')).toBeInTheDocument()
    })
    expect(screen.getByTestId('support-reference-value')).toHaveTextContent('req-earlier')
  })
})
