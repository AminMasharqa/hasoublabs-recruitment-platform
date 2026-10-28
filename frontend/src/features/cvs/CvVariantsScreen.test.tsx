/**
 * Component tests for CV_Variant management (task 17.1).
 *
 * Requirement 11:
 * - AC1 each variant is listed with its name, description, primary designation,
 *   archived designation and version count.
 * - AC2 the create control posts a name and an optional description.
 * - AC3 at five active variants the create control is disabled and the limit is
 *   stated as the reason.
 * - AC4 the edit control patches the changed member only.
 * - AC5 the archive request is issued only after the confirmation dialog.
 * - AC6 the archive control is disabled for the last active variant.
 * - AC7 after `POST .../primary` returns 200 exactly one variant renders as
 *   primary — asserted against a Backend_Api answer that still flags the previous
 *   one, so a single badge is a property of the rendering and not of the payload.
 *
 * The screen is mounted directly over a stub Api_Client rather than through the
 * router: the guarding of `/candidate/cvs` is `routing/`'s and is covered by
 * `routes.test.tsx`, so nothing here re-asserts it.
 */

import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { i18n as I18nextInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiClient, ApiSuccess } from '../../api/client'
import { createI18n } from '../../i18n'
import { AppServicesContext, type AppServices } from '../../shell/appServices'

import { CvVariantsScreen } from './CvVariantsScreen'
import {
  CV_VARIANT_PATH,
  CV_VARIANT_PRIMARY_PATH,
  CV_VARIANTS_PATH,
} from './variantApi'
import { MAX_ACTIVE_VARIANTS, type CvVariant } from './variantRules'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function variant(overrides: Partial<CvVariant> & Pick<CvVariant, 'id'>): CvVariant {
  return {
    name: `Variant ${overrides.id}`,
    description: null,
    is_primary: false,
    is_archived: false,
    version_count: 0,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

/** What the stub Backend_Api was asked, in order. */
interface Exchange {
  readonly method: string
  readonly path: string
  readonly variantId?: string
  readonly body?: unknown
}

interface Backend {
  readonly exchanges: Exchange[]
  readonly api: ApiClient
  /** Makes the next `POST .../primary` answer keep flagging the previous primary. */
  keepStalePrimaryFlag(): void
}

/**
 * A stub Api_Client over a mutable variant list.
 *
 * It behaves like the Backend_Api the screen talks to — a create appends, a patch
 * edits, a delete archives, a primary post moves the designation — so the
 * assertions below are about what the screen issues and what it then renders,
 * not about a hand-written sequence of canned responses.
 */
function backend(initial: readonly CvVariant[]): Backend {
  const exchanges: Exchange[] = []
  let variants = [...initial]
  let stalePrimaryFlag = false

  const answer = <T,>(data: T): Promise<ApiSuccess<T>> =>
    Promise.resolve({
      data,
      response: new Response(null, { status: 200 }),
      supportReference: 'req-ok',
    })

  const request = vi.fn(
    (method: string, path: string, init?: { params?: { path?: Record<string, string> }; body?: unknown }) => {
      const variantId = init?.params?.path?.variant_id
      exchanges.push({
        method,
        path,
        ...(variantId === undefined ? {} : { variantId }),
        ...(init?.body === undefined ? {} : { body: init.body }),
      })

      if (method === 'get' && path === CV_VARIANTS_PATH) {
        return answer(variants.map((entry) => ({ ...entry })))
      }

      if (method === 'post' && path === CV_VARIANTS_PATH) {
        const body = init?.body as { name: string; description?: string | null }
        const created = variant({
          id: `created-${variants.length + 1}`,
          name: body.name,
          description: body.description ?? null,
        })
        variants = [...variants, created]
        return answer({ ...created })
      }

      if (method === 'patch' && path === CV_VARIANT_PATH) {
        const body = init?.body as { name?: string; description?: string | null }
        const updated = { ...(variants.find((entry) => entry.id === variantId) as CvVariant), ...body }
        variants = variants.map((entry) => (entry.id === variantId ? updated : entry))
        return answer({ ...updated })
      }

      if (method === 'delete' && path === CV_VARIANT_PATH) {
        variants = variants.map((entry) =>
          entry.id === variantId ? { ...entry, is_archived: true, is_primary: false } : entry,
        )
        return answer(undefined)
      }

      if (method === 'post' && path === CV_VARIANT_PRIMARY_PATH) {
        variants = variants.map((entry) =>
          entry.id === variantId
            ? { ...entry, is_primary: true }
            : // A Backend_Api that forgot to clear the previous designation. The
              // rendering must still show one badge (AC7).
              { ...entry, is_primary: stalePrimaryFlag ? entry.is_primary : false },
        )
        return answer({ ...(variants.find((entry) => entry.id === variantId) as CvVariant) })
      }

      return Promise.reject(new Error(`unexpected ${method} ${path}`))
    },
  )

  return {
    exchanges,
    keepStalePrimaryFlag() {
      stalePrimaryFlag = true
    },
    api: {
      request: request as unknown as ApiClient['request'],
      exchangeRefreshToken: () => Promise.reject(new Error('not used')),
      revokeSession: () => Promise.resolve(),
    },
  }
}

let i18n: I18nextInstance

beforeEach(() => {
  i18n = createI18n('en')
})

function renderScreen(api: ApiClient) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const services: AppServices = { api, queryClient, clearServerState: () => undefined }

  return render(
    <MantineProvider>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <AppServicesContext.Provider value={services}>
            <MemoryRouter>
              <CvVariantsScreen />
            </MemoryRouter>
          </AppServicesContext.Provider>
        </QueryClientProvider>
      </I18nextProvider>
    </MantineProvider>,
  )
}

/** `count` active variants, the first of them primary. */
function activeList(count: number): CvVariant[] {
  return Array.from({ length: count }, (_unused, index) =>
    variant({
      id: `v${index + 1}`,
      is_primary: index === 0,
      created_at: `2025-01-0${index + 1}T00:00:00Z`,
    }),
  )
}

function listExchanges(api: Backend): Exchange[] {
  return api.exchanges.filter(
    (exchange) => exchange.method === 'get' && exchange.path === CV_VARIANTS_PATH,
  )
}

// ── AC1: the list ─────────────────────────────────────────────────────────────

describe('the CV_Variant list (Req 11 AC1)', () => {
  it('lists each variant with its name, description, designations and version count', async () => {
    const api = backend([
      variant({
        id: 'v1',
        name: 'Backend roles',
        description: 'Java and Spring',
        is_primary: true,
        version_count: 3,
      }),
      variant({ id: 'v2', name: 'Data roles', is_archived: true, version_count: 1 }),
    ])
    renderScreen(api.api)

    expect(await screen.findByTestId('variant-card-v1')).toBeInTheDocument()
    expect(screen.getByTestId('variant-name-v1')).toHaveTextContent('Backend roles')
    expect(screen.getByTestId('variant-description-v1')).toHaveTextContent('Java and Spring')
    expect(screen.getByTestId('variant-version-count-v1')).toHaveTextContent('3')
    expect(screen.getByTestId('variant-primary-badge-v1')).toBeInTheDocument()

    // An archived variant stays in the list, marked as archived.
    expect(screen.getByTestId('variant-card-v2')).toBeInTheDocument()
    expect(screen.getByTestId('variant-archived-badge-v2')).toBeInTheDocument()
    expect(screen.getByTestId('variant-version-count-v2')).toHaveTextContent('1')

    expect(listExchanges(api)).toHaveLength(1)
  })

  it('renders an Arabic variant name byte-identically (Req 19 AC10)', async () => {
    const name = 'سيرة للوظائف الخلفية'
    renderScreen(backend([variant({ id: 'v1', name })]).api)

    expect(await screen.findByTestId('variant-name-v1')).toHaveTextContent(name)
  })

  it('renders the empty state when the account holds no variant', async () => {
    renderScreen(backend([]).api)

    expect(await screen.findByTestId('empty-state')).toBeInTheDocument()
    expect(screen.queryByTestId('cv-variant-list')).toBeNull()
  })
})

// ── AC2, AC3: create ──────────────────────────────────────────────────────────

describe('the create control (Req 11 AC2, AC3)', () => {
  it('posts the entered name and description and refreshes the list', async () => {
    const user = userEvent.setup()
    const api = backend(activeList(1))
    renderScreen(api.api)

    await user.click(await screen.findByTestId('cv-variant-create-open'))
    // Pasted rather than typed: the draft is plain controlled state, so a
    // keystroke-by-keystroke transcription asserts nothing extra and costs a
    // Mantine re-render each time.
    await user.click(screen.getByTestId('cv-variant-create-name'))
    await user.paste('Platform roles')
    await user.click(screen.getByTestId('cv-variant-create-description'))
    await user.paste('Kubernetes and Go')
    await user.click(screen.getByTestId('cv-variant-create-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('variant-name-created-2')).toHaveTextContent('Platform roles')
    })
    expect(
      api.exchanges.filter((exchange) => exchange.method === 'post' && exchange.path === CV_VARIANTS_PATH),
    ).toEqual([
      {
        method: 'post',
        path: CV_VARIANTS_PATH,
        body: { name: 'Platform roles', description: 'Kubernetes and Go' },
      },
    ])
    expect(listExchanges(api).length).toBeGreaterThan(1)
  })

  it('does not issue a request for a name beyond the bounds, and states the problem', async () => {
    const user = userEvent.setup()
    const api = backend(activeList(1))
    renderScreen(api.api)

    await user.click(await screen.findByTestId('cv-variant-create-open'))
    await user.click(screen.getByTestId('cv-variant-create-name'))
    await user.paste('x'.repeat(101))
    await user.click(screen.getByTestId('cv-variant-create-submit'))

    const name = screen.getByTestId('cv-variant-create-name')
    await waitFor(() => {
      expect(name).toHaveAttribute('aria-invalid', 'true')
    })
    // Req 22 AC11: the entered value is retained.
    expect(name).toHaveValue('x'.repeat(101))
    expect(
      api.exchanges.filter((exchange) => exchange.method === 'post'),
    ).toEqual([])
  })

  it('disables the create control at the variant limit and states the limit', async () => {
    const api = backend(activeList(MAX_ACTIVE_VARIANTS))
    renderScreen(api.api)

    const open = await screen.findByTestId('cv-variant-create-open')
    expect(open).toBeDisabled()

    const reason = screen.getByTestId('cv-variant-create-reason')
    expect(reason).toHaveTextContent(String(MAX_ACTIVE_VARIANTS))
    expect(open).toHaveAttribute('aria-describedby', reason.id)
  })

  it('offers the create control while an archived variant sits beside four active ones', async () => {
    const api = backend([
      ...activeList(MAX_ACTIVE_VARIANTS - 1),
      variant({ id: 'archived', is_archived: true }),
    ])
    renderScreen(api.api)

    expect(await screen.findByTestId('cv-variant-create-open')).toBeEnabled()
    expect(screen.queryByTestId('cv-variant-create-reason')).toBeNull()
  })
})

// ── AC4: edit ─────────────────────────────────────────────────────────────────

describe('the edit control (Req 11 AC4)', () => {
  it('patches the changed name only', async () => {
    const user = userEvent.setup()
    const api = backend([
      variant({ id: 'v1', name: 'Backend roles', description: 'Java and Spring' }),
      variant({ id: 'v2' }),
    ])
    renderScreen(api.api)

    await user.click(await screen.findByTestId('variant-edit-v1'))
    const name = await screen.findByTestId('variant-edit-name')
    await user.clear(name)
    await user.paste('Platform roles')
    await user.click(screen.getByTestId('variant-edit-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('variant-name-v1')).toHaveTextContent('Platform roles')
    })
    expect(api.exchanges.filter((exchange) => exchange.method === 'patch')).toEqual([
      {
        method: 'patch',
        path: CV_VARIANT_PATH,
        variantId: 'v1',
        body: { name: 'Platform roles' },
      },
    ])
  })
})

// ── AC5, AC6: archive ─────────────────────────────────────────────────────────

describe('the archive control (Req 11 AC5, AC6)', () => {
  it('issues no request until the confirmation is given', async () => {
    const user = userEvent.setup()
    const api = backend(activeList(2))
    renderScreen(api.api)

    await user.click(await screen.findByTestId('variant-archive-v1'))
    expect(await screen.findByTestId('variant-archive-confirm')).toBeInTheDocument()
    expect(api.exchanges.filter((exchange) => exchange.method === 'delete')).toEqual([])

    await user.click(screen.getByTestId('variant-archive-confirm-cancel'))
    expect(api.exchanges.filter((exchange) => exchange.method === 'delete')).toEqual([])
  })

  it('archives the variant once the confirmation is given', async () => {
    const user = userEvent.setup()
    const api = backend(activeList(2))
    renderScreen(api.api)

    await user.click(await screen.findByTestId('variant-archive-v2'))
    await user.click(await screen.findByTestId('variant-archive-confirm-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('variant-archived-badge-v2')).toBeInTheDocument()
    })
    expect(api.exchanges.filter((exchange) => exchange.method === 'delete')).toEqual([
      { method: 'delete', path: CV_VARIANT_PATH, variantId: 'v2' },
    ])
  })

  it('disables the control for the last active variant and states the reason', async () => {
    const api = backend([...activeList(1), variant({ id: 'archived', is_archived: true })])
    renderScreen(api.api)

    const archive = await screen.findByTestId('variant-archive-v1')
    expect(archive).toBeDisabled()

    const reason = screen.getByTestId('variant-archive-reason-v1')
    expect(reason).toBeInTheDocument()
    expect(archive).toHaveAttribute('aria-describedby', reason.id)
  })

  it('presents no archive control for an already-archived variant', async () => {
    renderScreen(backend([variant({ id: 'v1' }), variant({ id: 'v2', is_archived: true })]).api)

    await screen.findByTestId('variant-card-v2')
    expect(screen.queryByTestId('variant-archive-v2')).toBeNull()
    expect(screen.queryByTestId('variant-edit-v2')).toBeNull()
  })
})

// ── AC7: the primary designation ──────────────────────────────────────────────

describe('the primary control (Req 11 AC7)', () => {
  it('moves the single primary badge onto the designated variant', async () => {
    const user = userEvent.setup()
    const api = backend(activeList(3))
    renderScreen(api.api)

    await user.click(await screen.findByTestId('variant-set-primary-v3'))

    await waitFor(() => {
      expect(screen.getByTestId('variant-primary-badge-v3')).toBeInTheDocument()
    })
    expect(api.exchanges.filter((exchange) => exchange.path === CV_VARIANT_PRIMARY_PATH)).toEqual([
      { method: 'post', path: CV_VARIANT_PRIMARY_PATH, variantId: 'v3' },
    ])
    expect(screen.getAllByText('Primary')).toHaveLength(1)
  })

  it('renders exactly one primary even when the answer still flags the previous one', async () => {
    const user = userEvent.setup()
    const api = backend(activeList(3))
    // A Backend_Api that answers the designation without clearing the previous
    // one, so the refetched list flags two variants.
    api.keepStalePrimaryFlag()
    renderScreen(api.api)

    await user.click(await screen.findByTestId('variant-set-primary-v2'))

    await waitFor(() => {
      expect(listExchanges(api).length).toBeGreaterThan(1)
    })
    // AC7 is about the rendering, not about the payload: one badge, whichever of
    // the two flagged variants it lands on.
    await waitFor(() => {
      expect(screen.getAllByText('Primary')).toHaveLength(1)
    })
  })

  it('offers no primary control on the variant that already holds the designation', async () => {
    renderScreen(backend(activeList(2)).api)

    await screen.findByTestId('variant-card-v1')
    expect(screen.queryByTestId('variant-set-primary-v1')).toBeNull()
    expect(screen.getByTestId('variant-set-primary-v2')).toBeInTheDocument()
  })

  it('announces the outcome in a live region without moving focus into it (Req 20 AC7)', async () => {
    const user = userEvent.setup()
    renderScreen(backend(activeList(2)).api)

    await user.click(await screen.findByTestId('variant-set-primary-v2'))

    const announcement = await waitFor(() => {
      const spoken = screen
        .getAllByTestId('live-announcement')
        .find((region) => region.textContent !== '')
      expect(spoken).toBeDefined()
      return spoken as HTMLElement
    })
    expect(announcement).toHaveTextContent('primary one')
    expect(announcement).toHaveAttribute('aria-live', 'polite')
    // Focus stays where the user left it: the region holds nothing focusable and
    // does not contain the active element.
    expect(within(announcement).queryByRole('button')).toBeNull()
    expect(announcement.contains(document.activeElement)).toBe(false)
  })
})
