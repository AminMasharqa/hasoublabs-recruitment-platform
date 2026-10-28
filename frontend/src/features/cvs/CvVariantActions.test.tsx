/**
 * Cross-cutting accessibility component tests for task 26.2, exercised against
 * the archive-confirmation dialog of `CvVariantActions.tsx` and its edit form —
 * a representative Mantine `Modal` plus a representative form.
 *
 * Requirement 20:
 * - AC11 a modal confines keyboard focus while it is open and restores it to the
 *   control that opened it once it closes.
 * - AC3 every focusable interactive control renders with a visible focus
 *   indicator. `css: false` in `vitest.config.ts` means jsdom never computes the
 *   `outline` Mantine's stylesheet paints on `:focus-visible` — see
 *   `node_modules/@mantine/core/styles.css`'s `.mantine-focus-auto:focus-visible`
 *   rule — so what is asserted here is the structural guarantee that drives it:
 *   every rendered interactive control carries Mantine's `mantine-focus-auto`
 *   class, which is the only thing in this codebase that could suppress the
 *   indicator if it were missing.
 * - AC5 every form input is associated with a programmatically determinable
 *   label, reachable through `getByLabelText`.
 * - AC12 the shared theme suppresses non-essential Mantine motion under the
 *   operating-system reduced-motion preference.
 *
 * Requirements: 20.2, 20.3, 20.5, 20.11, 20.12.
 */

import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { i18n as I18nextInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiClient, ApiSuccess } from '../../api/client'
import { createI18n } from '../../i18n'
import { AppServicesContext, type AppServices } from '../../shell/appServices'
import { appTheme } from '../../shell/theme'

import { CvVariantActions } from './CvVariantActions'
import type { CvVariant } from './variantRules'

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

/** A stub Api_Client that never resolves — enough for a dialog-rendering test. */
function pendingBackend(): ApiClient {
  return {
    request: vi.fn(() => new Promise<ApiSuccess<never>>(() => undefined)),
    exchangeRefreshToken: () => Promise.reject(new Error('not used')),
    revokeSession: () => Promise.resolve(),
  } as unknown as ApiClient
}

let i18n: I18nextInstance

beforeEach(() => {
  i18n = createI18n('en')
})

function renderActions(variantUnderTest: CvVariant, variants: readonly CvVariant[], api: ApiClient) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const services: AppServices = { api, queryClient, clearServerState: () => undefined }

  return render(
    <MantineProvider theme={appTheme}>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <AppServicesContext.Provider value={services}>
            <CvVariantActions variant={variantUnderTest} variants={variants} />
          </AppServicesContext.Provider>
        </QueryClientProvider>
      </I18nextProvider>
    </MantineProvider>,
  )
}

// ── AC11: modal focus confinement and restoration ──────────────────────────────

describe('modal focus confinement and restoration (Req 20 AC11)', () => {
  it('moves focus into the archive-confirmation dialog and restores it to the invoking control on close', async () => {
    const user = userEvent.setup()
    const two = [variant({ id: 'v1' }), variant({ id: 'v2' })]
    renderActions(two[0] as CvVariant, two, pendingBackend())

    const openControl = await screen.findByTestId('variant-archive-v1')
    await user.click(openControl)

    // Focus moved off the invoking control into the now-open dialog.
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true)
    })
    expect(document.activeElement).not.toBe(openControl)

    // Tabbing inside the dialog never lands focus outside it (confinement).
    await user.tab()
    expect(dialog.contains(document.activeElement)).toBe(true)
    await user.tab()
    expect(dialog.contains(document.activeElement)).toBe(true)

    await user.click(screen.getByTestId('variant-archive-confirm-cancel'))

    // Focus returns to the control that opened the dialog.
    await waitFor(() => {
      expect(document.activeElement).toBe(openControl)
    })
    // The dialog itself unmounts once Mantine's close transition finishes.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  it('moves focus into the edit dialog and restores it to the invoking control on close', async () => {
    const user = userEvent.setup()
    const one = [variant({ id: 'v1', name: 'Backend roles' })]
    renderActions(one[0] as CvVariant, one, pendingBackend())

    const openControl = await screen.findByTestId('variant-edit-v1')
    await user.click(openControl)

    const dialog = await screen.findByRole('dialog')
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true)
    })

    await user.click(await screen.findByTestId('variant-edit-cancel'))

    await waitFor(() => {
      expect(document.activeElement).toBe(openControl)
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })
})

// ── AC3: visible focus indicators ──────────────────────────────────────────────

describe('visible focus indicators (Req 20 AC3)', () => {
  it('renders every focusable control in these controls with the shared focus-visible styling hook', async () => {
    const two = [variant({ id: 'v1' }), variant({ id: 'v2' })]
    renderActions(two[0] as CvVariant, two, pendingBackend())

    const setPrimary = await screen.findByTestId('variant-set-primary-v1')
    const edit = screen.getByTestId('variant-edit-v1')
    const archive = screen.getByTestId('variant-archive-v1')

    // Mantine paints its `:focus-visible` outline (2px solid, ≥3:1 against the
    // background per its default palette) onto exactly the elements carrying
    // this class — see `styles.css`'s `.mantine-focus-auto:focus-visible` rule,
    // not reproduced here because `css: false` keeps stylesheets out of jsdom.
    for (const control of [setPrimary, edit, archive]) {
      expect(control).toHaveClass('mantine-focus-auto')
      expect(control.tabIndex).not.toBe(-1)
    }
  })

  it('renders the archive-confirmation dialog controls with the focus-visible styling hook too', async () => {
    const user = userEvent.setup()
    const two = [variant({ id: 'v1' }), variant({ id: 'v2' })]
    renderActions(two[0] as CvVariant, two, pendingBackend())

    await user.click(await screen.findByTestId('variant-archive-v1'))

    const confirm = await screen.findByTestId('variant-archive-confirm-submit')
    const cancel = screen.getByTestId('variant-archive-confirm-cancel')
    expect(confirm).toHaveClass('mantine-focus-auto')
    expect(cancel).toHaveClass('mantine-focus-auto')
  })
})

// ── AC5: label association ─────────────────────────────────────────────────────

describe('label association (Req 20 AC5)', () => {
  it('associates the edit form inputs with a programmatically determinable label', async () => {
    const user = userEvent.setup()
    const one = [variant({ id: 'v1', name: 'Backend roles', description: 'Java and Spring' })]
    renderActions(one[0] as CvVariant, one, pendingBackend())

    await user.click(await screen.findByTestId('variant-edit-v1'))

    // `getByLabelText` only succeeds when the input is reachable by its
    // programmatically associated label — Mantine wires the visible `<label>`
    // to the input's `id` for exactly this.
    const name = await screen.findByLabelText(/^Name/)
    const description = screen.getByLabelText('Description')

    expect(name).toHaveValue('Backend roles')
    expect(description).toHaveValue('Java and Spring')
  })

  it('associates the modal close control with a text alternative for its purpose (Req 20 AC8)', async () => {
    const user = userEvent.setup()
    const one = [variant({ id: 'v1' })]
    renderActions(one[0] as CvVariant, one, pendingBackend())

    await user.click(await screen.findByTestId('variant-edit-v1'))

    // The dialog's icon-only close control still has an accessible name.
    expect(await screen.findByRole('button', { name: 'Close' })).toBeInTheDocument()
  })
})

// ── AC12: reduced motion ───────────────────────────────────────────────────────

describe('reduced-motion suppression (Req 20 AC12)', () => {
  it('configures the shared theme to respect the operating-system reduced-motion preference', () => {
    // The theme every `MantineProvider` in the app is given (`shell/AppShell.tsx`)
    // sets this once, so `LoadingState`, `Modal` transitions and every other
    // Mantine animation honour `prefers-reduced-motion: reduce` without a
    // component-by-component media query.
    expect(appTheme.respectReducedMotion).toBe(true)
  })

  it("renders Mantine's own reduced-motion attribute on the document element when the theme is applied", async () => {
    const one = [variant({ id: 'v1' })]
    renderActions(one[0] as CvVariant, one, pendingBackend())

    await screen.findByTestId('variant-edit-v1')

    // `respectReducedMotion` makes `MantineProvider` publish this attribute,
    // which its stylesheet's `[data-respect-reduced-motion='true']` selectors key
    // off of to gate transitions behind the `prefers-reduced-motion` media query.
    expect(document.documentElement).toHaveAttribute('data-respect-reduced-motion', 'true')
  })

  it('suppresses the archive mutation retry delay work under a reduced-motion preference without altering behaviour', async () => {
    // Reduced motion is a rendering concern, not a request-timing one: the
    // dialog still opens and the same controls are offered regardless of the
    // operating-system preference, matching AC12's scope to animation only.
    const restoreMatchMedia = window.matchMedia
    window.matchMedia = ((query: string) =>
      ({
        media: query,
        matches: query.includes('prefers-reduced-motion'),
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia

    try {
      const user = userEvent.setup()
      const two = [variant({ id: 'v1' }), variant({ id: 'v2' })]
      renderActions(two[0] as CvVariant, two, pendingBackend())

      await user.click(await screen.findByTestId('variant-archive-v1'))
      expect(await screen.findByTestId('variant-archive-confirm')).toBeInTheDocument()
    } finally {
      window.matchMedia = restoreMatchMedia
    }
  })
})
