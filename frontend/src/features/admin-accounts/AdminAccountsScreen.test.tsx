/**
 * Component tests for the Admin account-management slice (task 22.2).
 *
 * Requirement 16:
 * - **AC5** a 201 from `POST /admin/registration-links` renders the returned
 *   `token` once as copyable text beside `expires_at`, and states that the value
 *   cannot be retrieved afterwards.
 * - **AC6** the token is retained nowhere once the creating screen is left:
 *   unmounting drops it, and a remount renders no token at all.
 * - **AC14** `ADMIN` together with any other role is blocked before a request is
 *   issued — the save control is disabled, the rule is stated, and nothing reaches
 *   the wire.
 * - **AC16** reject, suspend and deactivate are issued from inside the confirmation
 *   dialog and from nowhere else: pressing the list control opens the dialog and
 *   issues nothing.
 *
 * `accountRules.test.ts` already states the pure halves of all of this — which
 * status offers which transition, which reason bounds apply, which role set is
 * refused, which transitions demand confirmation. What it cannot state is the
 * wiring, and that is what every case here is about: what the Admin sees, and what
 * the Api_Client is actually asked. So the screen is mounted whole over a stub
 * Api_Client that behaves like the Backend_Api — a lifecycle call moves the
 * account's status, a role save replaces the role set, a link creation mints a
 * token — and nothing mocks the query cache, the dialog or the Form_Validator: a
 * blocked control whose request still reached the network would pass a test of
 * either half alone.
 *
 * `/admin/accounts` is guarded by the `admin` route group, which is covered by
 * `routes.test.tsx`, so the screen is mounted directly.
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
import type { AccountStatus } from '../../api/enums'
import { createI18n } from '../../i18n'
import { AppServicesContext, type AppServices } from '../../shell/appServices'

import { AdminAccountsScreen } from './AdminAccountsScreen'
import {
  ACCOUNT_ROLES_PATH,
  ADMIN_ACCOUNTS_PATH,
  LIFECYCLE_PATHS,
  PENDING_SKILLS_PATH,
  REGISTRATION_LINKS_PATH,
  type RegistrationLink,
} from './accountsApi'
import type { Account, LifecycleAction } from './accountRules'

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** The `expires_at` every issued Registration_Link carries in these cases. */
const EXPIRES_AT = '2026-03-01T12:00:00Z'

/** The plaintext token the stub Backend_Api mints, distinctive enough to search for. */
const TOKEN = 'rl-9fZ3kQ7t-1sVxN0pB4yH'

const LIFECYCLE_PATH_VALUES: readonly string[] = Object.values(LIFECYCLE_PATHS)

/** Where each transition leaves an account, as the Backend_Api would report it. */
const STATUS_AFTER: Readonly<Record<LifecycleAction, AccountStatus>> = {
  approve: 'ApprovedPendingMeeting',
  reject: 'Rejected',
  'record-meeting': 'Approved',
  suspend: 'Suspended',
  deactivate: 'Deactivated',
  reactivate: 'Approved',
  reopen: 'PendingApproval',
}

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    email: 'dana@example.com',
    roles: ['CANDIDATE'],
    status: 'Approved',
    language_preference: 'en',
    mfa_enrolled: true,
    created_at: '2026-01-04T08:30:00Z',
    ...overrides,
  }
}

/** What the stub Backend_Api was asked, in order. */
interface Exchange {
  readonly method: string
  readonly path: string
  readonly accountId?: string
  readonly body?: unknown
}

interface Backend {
  readonly exchanges: Exchange[]
  readonly api: ApiClient
}

function answer<T>(data: T, status = 200): Promise<ApiSuccess<T>> {
  return Promise.resolve({
    data,
    response: new Response(null, { status }),
    supportReference: 'req-ok',
  })
}

/** The action a lifecycle path names, or `null` when the path is not one. */
function actionOfPath(path: string): LifecycleAction | null {
  const found = Object.entries(LIFECYCLE_PATHS).find(([, template]) => template === path)
  return found === undefined ? null : (found[0] as LifecycleAction)
}

/**
 * A stub Api_Client over a mutable account list.
 *
 * It behaves like the Backend_Api the screen talks to: a lifecycle call moves the
 * named account's status and answers the updated account, a role save replaces its
 * role set, and a link creation answers a 201 carrying a token. The assertions are
 * therefore about what the screen issues and what it then renders, rather than
 * about a hand-written sequence of canned responses.
 *
 * `token` is what the 201 carries: a string for the ordinary case, `null` for a
 * Backend_Api that returned none.
 */
function backend(
  initial: readonly Account[] = [account()],
  token: string | null = TOKEN,
): Backend {
  const exchanges: Exchange[] = []
  let accounts = [...initial]
  let issued = 0

  const request = vi.fn(
    (
      method: string,
      path: string,
      init?: { params?: { path?: Record<string, string> }; body?: unknown },
    ) => {
      const accountId = init?.params?.path?.account_id
      exchanges.push({
        method,
        path,
        ...(accountId === undefined ? {} : { accountId }),
        ...(init?.body === undefined ? {} : { body: init.body }),
      })

      if (method === 'get' && path === ADMIN_ACCOUNTS_PATH) {
        return answer(accounts.map((entry) => ({ ...entry })))
      }

      if (method === 'get' && path === PENDING_SKILLS_PATH) {
        return answer([])
      }

      if (method === 'post' && path === REGISTRATION_LINKS_PATH) {
        issued += 1
        const body = init?.body as { role: RegistrationLink['role'] }
        const link: RegistrationLink = {
          id: `link-${issued}`,
          role: body.role,
          expires_at: EXPIRES_AT,
          token,
        }
        return answer(link, 201)
      }

      if (method === 'put' && path === ACCOUNT_ROLES_PATH) {
        const body = init?.body as { roles: Account['roles'] }
        const updated = {
          ...(accounts.find((entry) => entry.id === accountId) as Account),
          roles: [...body.roles],
        }
        accounts = accounts.map((entry) => (entry.id === accountId ? updated : entry))
        return answer({ ...updated })
      }

      const action = actionOfPath(path)
      if (method === 'post' && action !== null) {
        const current = accounts.find((entry) => entry.id === accountId) as Account
        const updated: Account = {
          ...current,
          status:
            action === 'approve' && (init?.body as { fast_track?: boolean } | undefined)?.fast_track
              ? 'Approved'
              : STATUS_AFTER[action],
        }
        accounts = accounts.map((entry) => (entry.id === accountId ? updated : entry))
        return answer({ ...updated })
      }

      return Promise.reject(new Error(`unexpected ${method} ${path}`))
    },
  )

  return {
    exchanges,
    api: {
      request: request as unknown as ApiClient['request'],
      exchangeRefreshToken: () => Promise.reject(new Error('not used')),
      revokeSession: () => Promise.resolve(),
    },
  }
}

// ── Harness ───────────────────────────────────────────────────────────────────

let i18n: I18nextInstance

beforeEach(() => {
  i18n = createI18n('en')
})

interface MountOptions {
  /** Reused across two mounts, so what survives leaving the screen is observable. */
  readonly queryClient?: QueryClient
  readonly location?: string
}

function mountScreen(api: ApiClient, options: MountOptions = {}) {
  const queryClient =
    options.queryClient ??
    new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
  const services: AppServices = { api, queryClient, clearServerState: () => undefined }

  const rendered = render(
    <MantineProvider>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <AppServicesContext.Provider value={services}>
            <MemoryRouter initialEntries={[options.location ?? '/admin/accounts']}>
              <Routes>
                <Route path="/admin/accounts" element={<AdminAccountsScreen />} />
              </Routes>
            </MemoryRouter>
          </AppServicesContext.Provider>
        </QueryClientProvider>
      </I18nextProvider>
    </MantineProvider>,
  )

  return { ...rendered, queryClient }
}

/** Everything the client holds in cached server state, as searchable text (AC6). */
function cachedServerState(queryClient: QueryClient): string {
  return JSON.stringify({
    queries: queryClient
      .getQueryCache()
      .getAll()
      .map((entry) => ({ key: entry.queryKey, data: entry.state.data })),
    mutations: queryClient
      .getMutationCache()
      .getAll()
      .map((entry) => ({ variables: entry.state.variables, data: entry.state.data })),
  })
}

function lifecyclePosts(api: Backend): readonly Exchange[] {
  return api.exchanges.filter(
    (exchange) => exchange.method === 'post' && LIFECYCLE_PATH_VALUES.includes(exchange.path),
  )
}

function rolePuts(api: Backend): readonly Exchange[] {
  return api.exchanges.filter(
    (exchange) => exchange.method === 'put' && exchange.path === ACCOUNT_ROLES_PATH,
  )
}

// ── AC5: the token is shown once, beside `expires_at`, with the warning ────────

describe('an issued Registration_Link (Req 16 AC5)', () => {
  it('renders the token once as copyable text beside the expiry and states it is not retrievable', async () => {
    const user = userEvent.setup()
    const api = backend()
    mountScreen(api.api)

    await user.click(await screen.findByTestId('registration-link-create-CANDIDATE'))

    const issued = within(await screen.findByTestId('registration-link-issued'))

    // Exactly one element renders the token value as its own text. The registration
    // address beside it embeds the same token, which is the one value spelled as the
    // link it will be used as, not a second disclosure — and its text is the URL,
    // so it is not a second match here.
    expect(screen.getAllByText(TOKEN)).toHaveLength(1)
    expect(issued.getByTestId('registration-link-token')).toHaveTextContent(TOKEN)
    expect(issued.getByTestId('registration-link-url')).toHaveTextContent(TOKEN)

    // Copyable: the control puts exactly the token on the clipboard, nothing more.
    await user.click(issued.getByTestId('registration-link-token-copy'))
    await waitFor(async () => {
      expect(await navigator.clipboard.readText()).toBe(TOKEN)
    })

    // AC5: together with `expires_at`, in the same panel, with the authoritative
    // UTC instant beside the localized rendering (Req 19 AC12).
    expect(issued.getByTestId('registration-link-expires')).toHaveTextContent('2026')
    expect(issued.getByText('2026-03-01T12:00:00.000Z UTC')).toBeInTheDocument()

    // AC5: the statement that the value cannot be retrieved afterwards.
    expect(issued.getByTestId('registration-link-once-notice')).toHaveTextContent(
      'it cannot be retrieved afterwards',
    )

    expect(
      api.exchanges.filter((exchange) => exchange.path === REGISTRATION_LINKS_PATH),
    ).toEqual([
      { method: 'post', path: REGISTRATION_LINKS_PATH, body: { role: 'CANDIDATE' } },
    ])
  })

  it('states that no token was returned rather than rendering an empty value', async () => {
    const user = userEvent.setup()
    mountScreen(backend([account()], null).api)

    await user.click(await screen.findByTestId('registration-link-create-SENIOR'))

    expect(await screen.findByTestId('registration-link-no-token')).toBeInTheDocument()
    expect(screen.queryByTestId('registration-link-token')).toBeNull()
    // The expiry is still reported: the link exists, only its token is missing.
    expect(screen.getByTestId('registration-link-expires')).toBeInTheDocument()
  })
})

// ── AC6: nothing retains the token once the screen is left ────────────────────

describe('a Registration_Link token after the screen is left (Req 16 AC6)', () => {
  it('is dropped on unmount and is not rendered again on a remount', async () => {
    const user = userEvent.setup()
    const api = backend()
    const first = mountScreen(api.api)

    await user.click(await screen.findByTestId('registration-link-create-CANDIDATE'))
    expect(await screen.findByTestId('registration-link-token')).toHaveTextContent(TOKEN)

    first.unmount()

    // Leaving the screen discards the value: no cached server-state entry holds it.
    // The panel's unmount releases the mutation and its `gcTime: 0` collects it, so
    // the entry goes as the collection window elapses rather than in the same tick —
    // and nothing can observe it in between, because the only observer is gone.
    await waitFor(() => {
      expect(first.queryClient.getMutationCache().getAll()).toEqual([])
    })
    expect(cachedServerState(first.queryClient)).not.toContain(TOKEN)

    // Returning to the destination with the same client renders the create control
    // and no token: there is nothing left to render, and nothing re-reads one.
    mountScreen(api.api, { queryClient: first.queryClient })

    expect(await screen.findByTestId('registration-link-create-CANDIDATE')).toBeInTheDocument()
    expect(screen.queryByTestId('registration-link-issued')).toBeNull()
    expect(screen.queryByTestId('registration-link-token')).toBeNull()
    expect(screen.queryByText(TOKEN)).toBeNull()
    expect(
      api.exchanges.filter((exchange) => exchange.path === REGISTRATION_LINKS_PATH),
    ).toHaveLength(1)
  })

  it('is dropped when the Admin leaves for the pending-skill view and comes back', async () => {
    const user = userEvent.setup()
    const api = backend()
    const { queryClient } = mountScreen(api.api)

    await user.click(await screen.findByTestId('registration-link-create-CANDIDATE'))
    expect(await screen.findByTestId('registration-link-token')).toHaveTextContent(TOKEN)

    await user.click(screen.getByTestId('accounts-view-pending-skills'))
    await screen.findByTestId('accounts-view-accounts')
    expect(screen.queryByTestId('registration-link-panel')).toBeNull()
    await waitFor(() => {
      expect(cachedServerState(queryClient)).not.toContain(TOKEN)
    })

    await user.click(screen.getByTestId('accounts-view-accounts'))

    expect(await screen.findByTestId('registration-link-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('registration-link-token')).toBeNull()
    expect(screen.queryByText(TOKEN)).toBeNull()
  })

  it('discards the token from the screen and the cache when the Admin hides it', async () => {
    const user = userEvent.setup()
    const api = backend()
    const { queryClient } = mountScreen(api.api)

    await user.click(await screen.findByTestId('registration-link-create-CANDIDATE'))
    await screen.findByTestId('registration-link-token')

    await user.click(screen.getByTestId('registration-link-dismiss'))

    await waitFor(() => {
      expect(screen.queryByTestId('registration-link-issued')).toBeNull()
    })
    await waitFor(() => {
      expect(cachedServerState(queryClient)).not.toContain(TOKEN)
    })
  })
})

// ── AC14: ADMIN is exclusive, blocked client-side ─────────────────────────────

describe('the role control on an Admin-plus-other target set (Req 16 AC14)', () => {
  it('blocks the save, states the rule and issues no request', async () => {
    const user = userEvent.setup()
    const api = backend([account({ id: 'acc-1', roles: ['CANDIDATE'] })])
    mountScreen(api.api)

    await user.click(await screen.findByTestId('account-role-ADMIN-acc-1'))

    // The target set is now ADMIN + CANDIDATE, which AC14 refuses.
    expect(screen.getByTestId('account-role-ADMIN-acc-1')).toBeChecked()
    expect(screen.getByTestId('account-role-CANDIDATE-acc-1')).toBeChecked()

    const save = screen.getByTestId('account-roles-save-acc-1')
    expect(save).toBeDisabled()

    // The rule is stated, and it is part of the group's accessible description
    // (Req 20 AC6) rather than only a colour.
    const refusal = screen.getByTestId('account-roles-refusal-acc-1')
    expect(refusal).toHaveTextContent(
      'The Administrator role cannot be combined with another role.',
    )
    expect(screen.getByTestId('account-roles-group-acc-1')).toHaveAttribute(
      'aria-describedby',
      refusal.id,
    )

    // Activating the blocked control changes nothing on the wire.
    await user.click(save)
    expect(rolePuts(api)).toEqual([])
  })

  it('submits the complete set once ADMIN stands alone', async () => {
    const user = userEvent.setup()
    const api = backend([account({ id: 'acc-1', roles: ['CANDIDATE'] })])
    mountScreen(api.api)

    await user.click(await screen.findByTestId('account-role-ADMIN-acc-1'))
    await user.click(screen.getByTestId('account-role-CANDIDATE-acc-1'))

    expect(screen.queryByTestId('account-roles-refusal-acc-1')).toBeNull()
    const save = screen.getByTestId('account-roles-save-acc-1')
    expect(save).toBeEnabled()

    await user.click(save)

    await waitFor(() => {
      expect(rolePuts(api)).toEqual([
        {
          method: 'put',
          path: ACCOUNT_ROLES_PATH,
          accountId: 'acc-1',
          body: { roles: ['ADMIN'] },
        },
      ])
    })
    // AC13, AC15: the card renders the role set the Backend_Api returned.
    await waitFor(() => {
      expect(screen.getByTestId('account-role-set-acc-1')).toHaveTextContent('Administrator')
    })
  })

  it('blocks an empty target set too, stating the reason', async () => {
    const user = userEvent.setup()
    const api = backend([account({ id: 'acc-1', roles: ['CANDIDATE'] })])
    mountScreen(api.api)

    await user.click(await screen.findByTestId('account-role-CANDIDATE-acc-1'))

    expect(screen.getByTestId('account-roles-save-acc-1')).toBeDisabled()
    expect(screen.getByTestId('account-roles-refusal-acc-1')).toHaveTextContent(
      'Choose at least one role.',
    )
    expect(rolePuts(api)).toEqual([])
  })
})

// ── AC16: reject, suspend and deactivate go through the dialog ────────────────

/** The three transitions AC16 names, each on a status that offers it. */
const CONFIRMED_TRANSITIONS = [
  {
    action: 'reject' as LifecycleAction,
    status: 'PendingApproval' as AccountStatus,
    reason: 'The residency proof does not match the applicant.',
    settles: 'Rejected',
  },
  {
    action: 'suspend' as LifecycleAction,
    status: 'Approved' as AccountStatus,
    reason: 'Investigating a report.',
    settles: 'Suspended',
  },
  {
    action: 'deactivate' as LifecycleAction,
    status: 'Approved' as AccountStatus,
    reason: 'Closure requested by the account holder.',
    settles: 'Deactivated',
  },
] as const

describe('the confirmation dialog (Req 16 AC16)', () => {
  it.each(CONFIRMED_TRANSITIONS)(
    'issues $action only from the dialog, never from the list control',
    async ({ action, status, reason, settles }) => {
      const user = userEvent.setup()
      const api = backend([account({ id: 'acc-1', status })])
      mountScreen(api.api)

      await user.click(await screen.findByTestId(`account-action-${action}-acc-1`))

      // The list control opened the dialog and issued nothing.
      expect(await screen.findByTestId('account-confirm-acc-1')).toBeInTheDocument()
      expect(lifecyclePosts(api)).toEqual([])

      const input = screen.getByTestId('account-confirm-reason')
      await user.click(input)
      await user.paste(reason)
      await user.click(screen.getByTestId('account-confirm-submit'))

      // The request is the dialog's, and it carries the reason entered there.
      await waitFor(() => {
        expect(lifecyclePosts(api)).toEqual([
          {
            method: 'post',
            path: LIFECYCLE_PATHS[action],
            accountId: 'acc-1',
            body: { reason },
          },
        ])
      })

      // AC15: the status the Backend_Api returned is what the card renders, and the
      // dialog closes once the transition settled.
      await waitFor(() => {
        expect(screen.getByTestId('account-card-acc-1')).toHaveAttribute(
          'data-account-status',
          settles,
        )
      })
      await waitFor(() => {
        expect(screen.queryByTestId('account-confirm-acc-1')).toBeNull()
      })
    },
  )

  it('issues nothing when the dialog is dismissed, and forgets the entered reason', async () => {
    const user = userEvent.setup()
    const api = backend([account({ id: 'acc-1', status: 'PendingApproval' })])
    mountScreen(api.api)

    await user.click(await screen.findByTestId('account-action-reject-acc-1'))
    await user.click(await screen.findByTestId('account-confirm-reason'))
    await user.paste('The residency proof does not match the applicant.')
    await user.click(screen.getByTestId('account-confirm-cancel'))

    await waitFor(() => {
      expect(screen.queryByTestId('account-confirm-acc-1')).toBeNull()
    })
    expect(lifecyclePosts(api)).toEqual([])
    expect(screen.getByTestId('account-card-acc-1')).toHaveAttribute(
      'data-account-status',
      'PendingApproval',
    )

    // Reopening starts from an empty reason: a discarded decision leaves nothing behind.
    await user.click(screen.getByTestId('account-action-reject-acc-1'))
    expect(await screen.findByTestId('account-confirm-reason')).toHaveValue('')
  })

  it('keeps a rejection reason below the lower bound off the wire (AC8)', async () => {
    const user = userEvent.setup()
    const api = backend([account({ id: 'acc-1', status: 'PendingApproval' })])
    mountScreen(api.api)

    await user.click(await screen.findByTestId('account-action-reject-acc-1'))
    const input = await screen.findByTestId('account-confirm-reason')
    await user.click(input)
    await user.paste('too short')
    await user.click(screen.getByTestId('account-confirm-submit'))

    await waitFor(() => {
      expect(input).toHaveAttribute('aria-invalid', 'true')
    })
    // Req 22 AC11: the entered text is retained, and nothing was issued.
    expect(input).toHaveValue('too short')
    expect(lifecyclePosts(api)).toEqual([])
  })

  it('issues a transition that carries no confirmation directly', async () => {
    const user = userEvent.setup()
    const api = backend([account({ id: 'acc-1', status: 'ApprovedPendingMeeting' })])
    mountScreen(api.api)

    await user.click(await screen.findByTestId('account-action-record-meeting-acc-1'))

    // AC9 needs no dialog: it records something that happened rather than deciding
    // something irreversible, and AC16 names only the other three.
    expect(screen.queryByTestId('account-confirm-acc-1')).toBeNull()
    await waitFor(() => {
      expect(lifecyclePosts(api)).toEqual([
        {
          method: 'post',
          path: LIFECYCLE_PATHS['record-meeting'],
          accountId: 'acc-1',
        },
      ])
    })
  })
})
