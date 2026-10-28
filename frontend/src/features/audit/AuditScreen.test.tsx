/**
 * Component tests for the Audit_Log_Viewer (task 23.1).
 *
 * Requirement 17:
 * - AC1 each entry renders the timestamp, action, entity type, entity identifier,
 *   outcome and reason.
 * - AC2 every applied filter is sent as a query parameter of `GET /admin/audit`.
 * - AC3 at most 20 entries are requested per page, and the next-page control sends
 *   `meta.next_after_id` as `after_id`.
 * - AC4 the next-page control is disabled while `meta.has_more` is false.
 * - AC5 the selected entry's `before` and `after` render as a field comparison.
 * - AC6 the verify control calls the chain endpoint and renders all four members.
 * - AC7 an `ok` of false renders a tampering alert naming `first_bad_id`.
 * - AC8 no control edits or deletes an entry.
 * - AC9 every timestamp is UTC with millisecond precision beside the local
 *   equivalent.
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

import type { AuditEntry, ChainVerifyReport } from './auditApi'
import { AuditScreen } from './AuditScreen'


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

const AUDIT_PATH = '/api/v1/admin/audit'
const VERIFY_PATH = '/api/v1/admin/audit/chain/verify'

/** An Audit_Log entry with every member the contract declares. */
function entryFixture(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    action: 'account.approve',
    actor: {
      account_id: 'acc-admin',
      anonymised: false,
      display_name: 'Admin One',
      id: 'actor-1',
      is_system: false,
      role: 'ADMIN',
    },
    after: null,
    before: null,
    entity_id: 'acc-9',
    entity_type: 'Account',
    error_type: null,
    id: 417,
    occurred_at: '2024-04-02T09:30:15.472Z',
    outcome: 'SUCCESS',
    reason: null,
    request_id: 'req-1',
    ...overrides,
  }
}

/** One page of the search response. */
interface PageFixture {
  readonly entries: readonly AuditEntry[]
  readonly hasMore?: boolean
  readonly nextAfterId?: number | null
}

/**
 * An Api_Client answering the audit search from a queue of pages and the chain
 * verification with a fixed report.
 */
function apiAnswering(
  pages: readonly PageFixture[],
  verify: ChainVerifyReport | { readonly failWith: unknown } | null = null,
) {
  const requests: RecordedRequest[] = []
  let served = 0

  const request = vi.fn((_method: string, path: string, init?: unknown) => {
    const params = (init as { params?: { query?: Record<string, unknown> } } | undefined)?.params
    requests.push({ path, query: params?.query })

    if (path === VERIFY_PATH) {
      if (verify !== null && 'failWith' in verify) {
        return Promise.reject(verify.failWith)
      }
      return Promise.resolve({
        data: verify,
        response: new Response(null, { status: 200 }),
        supportReference: 'req-verify',
      } satisfies ApiSuccess<unknown>)
    }

    const page = pages[Math.min(served, pages.length - 1)]
    served += 1
    return Promise.resolve({
      data: {
        data: page?.entries ?? [],
        meta: {
          has_more: page?.hasMore ?? false,
          next_after_id: page?.nextAfterId ?? null,
          page_size: 20,
        },
      },
      response: new Response(null, { status: 200 }),
      supportReference: 'req-audit',
    } satisfies ApiSuccess<unknown>)
  })

  const api: ApiClient = {
    request: request as unknown as ApiClient['request'],
    exchangeRefreshToken: () => Promise.reject(new Error('not used')),
    revokeSession: () => Promise.resolve(),
  }
  return { api, requests }
}

/** The query of the most recent `GET /admin/audit` request. */
function lastSearchQuery(requests: readonly RecordedRequest[]): Record<string, unknown> {
  const searches = requests.filter((entry) => entry.path === AUDIT_PATH)
  return searches[searches.length - 1]?.query ?? {}
}

function renderScreen(api: ApiClient, location = '/admin/audit') {
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
                <Route path="/admin/audit" element={<AuditScreen />} />
              </Routes>
            </MemoryRouter>
          </AppServicesContext.Provider>
        </QueryClientProvider>
      </I18nextProvider>
    </MantineProvider>,
  )
}

// ── AC1, AC3, AC9 ─────────────────────────────────────────────────────────────

describe('the entry list (Req 17 AC1, AC3, AC9)', () => {
  it('renders the six contract fields of each entry and requests at most 20 rows', async () => {
    const { api, requests } = apiAnswering([
      { entries: [entryFixture({ reason: 'Meeting completed' })] },
    ])
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('audit-entry-417')).toBeInTheDocument()
    })

    const row = within(screen.getByTestId('audit-entry-417'))
    expect(row.getByTestId('audit-entry-action-417')).toHaveTextContent('account.approve')
    expect(row.getByTestId('audit-entry-entity-type-417')).toHaveTextContent('Account')
    expect(row.getByTestId('audit-entry-entity-id-417')).toHaveTextContent('acc-9')
    expect(row.getByTestId('audit-entry-outcome-417')).toHaveTextContent('SUCCESS')
    expect(row.getByTestId('audit-entry-reason-417')).toHaveTextContent('Meeting completed')

    // AC9: the authoritative UTC value with milliseconds, and the local equivalent.
    const occurredAt = within(row.getByTestId('audit-entry-occurred-at-417'))
    expect(occurredAt.getByTestId('audit-timestamp-utc')).toHaveTextContent(
      '2024-04-02T09:30:15.472Z UTC',
    )
    expect(occurredAt.getByTestId('audit-timestamp-local')).toHaveTextContent('local time')

    expect(lastSearchQuery(requests)).toEqual({ page_size: 20 })
  })

  it('states that no reason was recorded rather than leaving the cell blank', async () => {
    const { api } = apiAnswering([{ entries: [entryFixture({ reason: null })] }])
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('audit-entry-reason-417')).toHaveTextContent('No reason recorded')
    })
  })
})

// ── AC2 ───────────────────────────────────────────────────────────────────────

describe('the filter controls (Req 17 AC2)', () => {
  it('sends the filters carried by the address as query parameters', async () => {
    const { api, requests } = apiAnswering([{ entries: [entryFixture()] }])
    renderScreen(
      api,
      '/admin/audit?actor_account_id=acc-admin&action=account.approve&entity_type=Account&entity_id=acc-9&from_dt=2024-04-01T00:00:00Z&to_dt=2024-04-30T00:00:00Z',
    )

    await waitFor(() => {
      expect(screen.getByTestId('audit-list')).toBeInTheDocument()
    })

    expect(lastSearchQuery(requests)).toEqual({
      page_size: 20,
      actor_account_id: 'acc-admin',
      action: 'account.approve',
      entity_type: 'Account',
      entity_id: 'acc-9',
      from_dt: '2024-04-01T00:00:00.000Z',
      to_dt: '2024-04-30T00:00:00.000Z',
    })
  })

  it('applies an edited filter as a query parameter of the next request', async () => {
    const user = userEvent.setup()
    const { api, requests } = apiAnswering([{ entries: [entryFixture()] }])
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('audit-list')).toBeInTheDocument()
    })

    await user.type(screen.getByTestId('audit-filter-action'), 'account.reject')
    await user.click(screen.getByTestId('audit-filters-apply'))

    await waitFor(() => {
      expect(lastSearchQuery(requests)).toEqual({ page_size: 20, action: 'account.reject' })
    })
  })

  it('retains the applied values on an empty page and clears them together', async () => {
    const user = userEvent.setup()
    const { api } = apiAnswering([{ entries: [] }])
    renderScreen(api, '/admin/audit?action=account.approve')

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    })
    expect(screen.getByTestId('empty-state')).toHaveTextContent('match the current filters')
    expect(screen.getByTestId('audit-filter-action')).toHaveValue('account.approve')

    await user.click(screen.getByTestId('empty-state-clear-filters'))

    await waitFor(() => {
      expect(screen.getByTestId('audit-filter-action')).toHaveValue('')
    })
    expect(screen.getByTestId('empty-state')).not.toHaveTextContent('match the current filters')
  })
})

// ── AC3, AC4 ──────────────────────────────────────────────────────────────────

describe('keyset pagination (Req 17 AC3, AC4)', () => {
  it('sends `meta.next_after_id` as the `after_id` of the next request', async () => {
    const user = userEvent.setup()
    const { api, requests } = apiAnswering([
      { entries: [entryFixture()], hasMore: true, nextAfterId: 417 },
      { entries: [entryFixture({ id: 500, action: 'account.suspend' })] },
    ])
    renderScreen(api, '/admin/audit?action=account.approve')

    await waitFor(() => {
      expect(screen.getByTestId('audit-next-page')).toBeEnabled()
    })

    await user.click(screen.getByTestId('audit-next-page'))

    await waitFor(() => {
      expect(screen.getByTestId('audit-entry-500')).toBeInTheDocument()
    })
    // The retained filter travels with the cursor.
    expect(lastSearchQuery(requests)).toEqual({
      page_size: 20,
      action: 'account.approve',
      after_id: 417,
    })
  })

  it('disables the next-page control while `meta.has_more` is false (AC4)', async () => {
    const { api } = apiAnswering([{ entries: [entryFixture()], hasMore: false, nextAfterId: 417 }])
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('audit-list')).toBeInTheDocument()
    })

    const next = screen.getByTestId('audit-next-page')
    expect(next).toBeDisabled()
    expect(next).toHaveAttribute('aria-disabled', 'true')
  })
})

// ── AC5 ───────────────────────────────────────────────────────────────────────

describe('the before/after field comparison (Req 17 AC5)', () => {
  it('renders each field of the selected entry with its before and after values', async () => {
    const user = userEvent.setup()
    const { api } = apiAnswering([
      {
        entries: [
          entryFixture({
            before: { status: 'PendingApproval', reason: 'awaiting meeting' },
            after: { status: 'Approved' },
          }),
        ],
      },
    ])
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('audit-entry-compare-417')).toBeInTheDocument()
    })
    // Not disclosed until the entry is selected.
    expect(screen.queryByTestId('audit-comparison-417')).toBeNull()

    await user.click(screen.getByTestId('audit-entry-compare-417'))

    const comparison = within(await screen.findByTestId('audit-comparison-417'))
    expect(comparison.getByTestId('audit-comparison-before-status')).toHaveTextContent(
      'PendingApproval',
    )
    expect(comparison.getByTestId('audit-comparison-after-status')).toHaveTextContent('Approved')
    expect(comparison.getByTestId('audit-comparison-kind-status')).toHaveTextContent('Changed')

    // A member only `before` carries is a row of its own, stated as absent after.
    expect(comparison.getByTestId('audit-comparison-before-reason')).toHaveTextContent(
      'awaiting meeting',
    )
    expect(comparison.getByTestId('audit-comparison-after-reason')).toHaveTextContent('Not present')
    expect(comparison.getByTestId('audit-comparison-kind-reason')).toHaveTextContent('Removed')

    await user.click(screen.getByTestId('audit-entry-compare-417'))
    expect(screen.queryByTestId('audit-comparison-417')).toBeNull()
  })

  it('states that an entry recorded no field values', async () => {
    const user = userEvent.setup()
    const { api } = apiAnswering([{ entries: [entryFixture({ before: null, after: null })] }])
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('audit-entry-compare-417')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('audit-entry-compare-417'))

    expect(await screen.findByTestId('audit-comparison-empty')).toHaveTextContent(
      'recorded no field values',
    )
  })

  it('renders Arabic snapshot values byte-identically', async () => {
    const user = userEvent.setup()
    const reason = 'لم يكتمل الاجتماع'
    const { api } = apiAnswering([
      { entries: [entryFixture({ before: { reason }, after: { reason: 'تم' } })] },
    ])
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('audit-entry-compare-417')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('audit-entry-compare-417'))

    expect(await screen.findByTestId('audit-comparison-before-reason')).toHaveTextContent(reason)
  })
})

// ── AC6, AC7 ──────────────────────────────────────────────────────────────────

describe('chain verification (Req 17 AC6, AC7)', () => {
  it('verifies nothing until the control is pressed, then renders all four members', async () => {
    const user = userEvent.setup()
    const { api, requests } = apiAnswering([{ entries: [entryFixture()] }], {
      ok: true,
      first_bad_id: null,
      checked_from_id: 1,
      max_id: 900,
    })
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('audit-chain-verify-run')).toBeInTheDocument()
    })
    // AC6 makes verification an explicit action, so nothing was asked of the
    // Backend_Api when the screen opened.
    expect(requests.some((entry) => entry.path === VERIFY_PATH)).toBe(false)

    await user.click(screen.getByTestId('audit-chain-verify-run'))

    await waitFor(() => {
      expect(screen.getByTestId('audit-chain-facts')).toBeInTheDocument()
    })
    expect(requests.filter((entry) => entry.path === VERIFY_PATH)).toHaveLength(1)

    expect(screen.getByTestId('audit-chain-ok')).toHaveTextContent('true')
    expect(screen.getByTestId('audit-chain-first-bad-id')).toHaveTextContent('None reported')
    expect(screen.getByTestId('audit-chain-checked-from-id')).toHaveTextContent('1')
    expect(screen.getByTestId('audit-chain-max-id')).toHaveTextContent('900')
    expect(screen.getByTestId('audit-chain-intact')).toBeInTheDocument()
    expect(screen.queryByTestId('audit-chain-tampered')).toBeNull()
  })

  it('renders a tampering alert naming `first_bad_id` when `ok` is false (AC7)', async () => {
    const user = userEvent.setup()
    const { api } = apiAnswering([{ entries: [entryFixture()] }], {
      ok: false,
      first_bad_id: 417,
      checked_from_id: 1,
      max_id: 900,
    })
    renderScreen(api)

    await user.click(await screen.findByTestId('audit-chain-verify-run'))

    const alert = await screen.findByTestId('audit-chain-tampered')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(screen.getByTestId('audit-chain-tampered-message')).toHaveTextContent('417')
    expect(screen.getByTestId('audit-chain-ok')).toHaveTextContent('false')
    expect(screen.getByTestId('audit-chain-first-bad-id')).toHaveTextContent('417')
    expect(screen.queryByTestId('audit-chain-intact')).toBeNull()
  })

  it('renders the error state with a retry control when the verification fails', async () => {
    const user = userEvent.setup()
    const { api } = apiAnswering([{ entries: [entryFixture()] }], {
      failWith: {
        error: 'upstream_unavailable',
        message: null,
        details: null,
        request_id: 'req-verify',
        httpStatus: 503,
        supportReference: 'req-verify',
        refreshEligible: false,
        authOutcome: 'none',
        fieldViolations: [],
      },
    })
    renderScreen(api)

    await user.click(await screen.findByTestId('audit-chain-verify-run'))

    expect(await screen.findByTestId('error-state')).toBeInTheDocument()
    expect(screen.getByTestId('error-retry')).toBeInTheDocument()
    expect(screen.queryByTestId('audit-chain-tampered')).toBeNull()
  })
})

// ── AC8 ───────────────────────────────────────────────────────────────────────

describe('the log is read-only (Req 17 AC8)', () => {
  it('offers no control that edits or deletes an entry', async () => {
    const { api } = apiAnswering([
      { entries: [entryFixture({ before: { status: 'PendingApproval' }, after: { status: 'Approved' } })] },
    ])
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('audit-entry-417')).toBeInTheDocument()
    })

    // The only controls on the page are the filter submit/reset pair, the
    // verification control, the pagination control and the comparison disclosure.
    const labels = screen
      .getAllByRole('button')
      .map((control) => (control.textContent ?? '').toLowerCase())
    for (const forbidden of ['edit', 'delete', 'remove', 'amend', 'anonymise']) {
      expect(labels.some((label) => label.includes(forbidden))).toBe(false)
    }
    expect(screen.getByTestId('audit-read-only-notice')).toHaveTextContent('read-only')
  })
})
