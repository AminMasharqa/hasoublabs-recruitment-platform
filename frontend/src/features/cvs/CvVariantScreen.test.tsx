/**
 * Component tests for the single-variant screen (task 17.1).
 *
 * It renders the same variant facts and the same controls as the list row
 * (Requirement 11 AC1, AC4–AC7), resolved from `GET /me/cv-variants` against the
 * `variantId` path parameter — the endpoint set carries no single-variant read.
 * Two things are therefore worth asserting here and nowhere else: that arriving
 * directly issues the list read and resolves the variant from it, and that an
 * identifier naming no variant of this Candidate renders a notice rather than an
 * empty shell.
 */

import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { i18n as I18nextInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiClient, ApiSuccess } from '../../api/client'
import { createI18n } from '../../i18n'
import { candidateCvVariantPath, ROUTE_PATHS } from '../../routing/paths'
import { AppServicesContext, type AppServices } from '../../shell/appServices'

import { CvVariantScreen } from './CvVariantScreen'
import { CV_VARIANTS_PATH } from './variantApi'
import type { CvVariant } from './variantRules'
import { CV_VERSIONS_PATH } from './versionApi'

// ── Harness ───────────────────────────────────────────────────────────────────

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

/**
 * A read-only stub answering the variant list and the version list, recording
 * every path asked.
 *
 * The version list is answered because the screen mounts the version panel of
 * AC8–AC18 below the variant (task 17.2); the panel's own behaviour is covered by
 * its tests, so here it only has to not fail.
 */
function backend(variants: readonly CvVariant[]): { readonly paths: string[]; readonly api: ApiClient } {
  const paths: string[] = []
  const request = vi.fn((method: string, path: string) => {
    paths.push(`${method} ${path}`)
    if (method === 'get' && path === CV_VARIANTS_PATH) {
      return Promise.resolve({
        data: variants.map((entry) => ({ ...entry })),
        response: new Response(null, { status: 200 }),
        supportReference: 'req-ok',
      } satisfies ApiSuccess<unknown>)
    }
    if (method === 'get' && path === CV_VERSIONS_PATH) {
      return Promise.resolve({
        data: [],
        response: new Response(null, { status: 200 }),
        supportReference: 'req-ok',
      } satisfies ApiSuccess<unknown>)
    }
    return Promise.reject(new Error(`unexpected ${method} ${path}`))
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

let i18n: I18nextInstance

beforeEach(() => {
  i18n = createI18n('en')
})

function renderAt(api: ApiClient, variantId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const services: AppServices = { api, queryClient, clearServerState: () => undefined }

  return render(
    <MantineProvider>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <AppServicesContext.Provider value={services}>
            <MemoryRouter initialEntries={[candidateCvVariantPath(variantId)]}>
              <Routes>
                <Route path={ROUTE_PATHS.candidateCvVariant} element={<CvVariantScreen />} />
              </Routes>
            </MemoryRouter>
          </AppServicesContext.Provider>
        </QueryClientProvider>
      </I18nextProvider>
    </MantineProvider>,
  )
}

// ── The screen ────────────────────────────────────────────────────────────────

describe('the single CV_Variant screen (Req 11 AC1, AC4–AC7)', () => {
  it('resolves the addressed variant from the list read and renders its controls', async () => {
    const api = backend([
      variant({ id: 'v1', name: 'Backend roles', description: 'Java and Spring', version_count: 2 }),
      variant({ id: 'v2', is_primary: true }),
    ])
    renderAt(api.api, 'v1')

    expect(await screen.findByTestId('variant-card-v1')).toBeInTheDocument()
    expect(screen.getByTestId('variant-name-v1')).toHaveTextContent('Backend roles')
    expect(screen.getByTestId('variant-version-count-v1')).toHaveTextContent('2')
    // AC7: the designation is a list fact, so the control is offered here too.
    expect(screen.getByTestId('variant-set-primary-v1')).toBeInTheDocument()
    expect(screen.getByTestId('variant-edit-v1')).toBeInTheDocument()
    expect(screen.getByTestId('variant-archive-v1')).toBeInTheDocument()
    // No link back to itself, and no read beyond the list and this variant's versions.
    expect(screen.queryByTestId('variant-detail-link-v1')).toBeNull()
    expect(new Set(api.paths)).toEqual(
      new Set([`get ${CV_VARIANTS_PATH}`, `get ${CV_VERSIONS_PATH}`]),
    )
  })

  it('mounts the version panel below the resolved variant', async () => {
    renderAt(backend([variant({ id: 'v1' })]).api, 'v1')

    expect(await screen.findByTestId('cv-version-panel')).toBeInTheDocument()
  })

  it('renders a not-found notice for an identifier naming no variant of this Candidate', async () => {
    const api = backend([variant({ id: 'v1' })])
    renderAt(api.api, 'absent')

    expect(await screen.findByTestId('cv-variant-not-found')).toBeInTheDocument()
    expect(screen.queryByTestId('variant-card-absent')).toBeNull()
    // An identifier naming no variant reads no versions.
    expect(screen.queryByTestId('cv-version-panel')).toBeNull()
    expect(api.paths).toEqual([`get ${CV_VARIANTS_PATH}`])
  })

  it('links back to the variant list', async () => {
    renderAt(backend([variant({ id: 'v1' })]).api, 'v1')

    expect(await screen.findByTestId('cv-variant-back')).toHaveAttribute(
      'href',
      ROUTE_PATHS.candidateCvs,
    )
  })
})
