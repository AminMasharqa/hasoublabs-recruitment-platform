/**
 * Component tests for the Error_Presenter surfaces (task 10.3).
 *
 * Requirement 21:
 * - AC3/AC4 one authorization-denied surface, identical in text and in available
 *   actions for every resource, disclosing nothing about existence. Asserted by
 *   rendering two denials for two different resource identifiers and comparing
 *   the produced markup byte for byte.
 * - AC7 the empty state names the destination and offers the clear-filter control
 *   exactly while a filter is applied.
 * - AC8 the error state carries the localized message, the Support_Reference and
 *   a working retry control.
 *
 * Requirement 20 AC7: an asynchronous completion is announced through the live
 * region without moving focus — `document.activeElement` is compared across the
 * completion.
 *
 * Requirement 23 AC3: the Support_Reference of a denied request is still retained
 * for the browsing context even though the denial surface renders none.
 *
 * The store is module-scoped by design, so every test clears it first.
 */

import { MantineProvider } from '@mantine/core'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { i18n as I18nextInstance } from 'i18next'
import { useState, type ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { decodeApiError, type ApiError } from '../api/errors'
import { createI18n } from '../i18n'

import {
  AuthorizationDeniedNotice,
  EmptyState,
  ErrorPresenter,
  ErrorState,
  LiveAnnouncement,
  LoadingState,
} from './ErrorPresenter'
import {
  AUTHORIZATION_DENIED_ERROR_KEY,
  AUTHORIZATION_DENIED_STATUS,
  authorizationDeniedMessage,
} from './errorMessages'
import {
  clearFailedSupportReference,
  latestFailedSupportReference,
} from './supportReferenceStore'

// ── Harness ───────────────────────────────────────────────────────────────────

let i18n: I18nextInstance

beforeEach(() => {
  clearFailedSupportReference()
  i18n = createI18n('en')
})

afterEach(() => {
  clearFailedSupportReference()
})

/**
 * Mounts a surface with the two providers every primitive here needs: Mantine for
 * the layout components and i18next for the catalogue.
 */
function renderSurface(ui: ReactNode, instance: I18nextInstance = i18n) {
  return render(
    <MantineProvider>
      <I18nextProvider i18n={instance}>{ui}</I18nextProvider>
    </MantineProvider>,
  )
}

/**
 * A realistic 403 `not_authorized` failure for one resource.
 *
 * Everything that could possibly differ between two denials differs here: the
 * resource identifier in `details`, the path the server echoed, the server-side
 * `message` and the `X-Request-ID`. None of it may reach the rendered surface.
 */
function denialFor(resourceId: string): ApiError {
  return decodeApiError({
    status: AUTHORIZATION_DENIED_STATUS,
    body: {
      error: AUTHORIZATION_DENIED_ERROR_KEY,
      message: `Not authorized for job ${resourceId}`,
      details: { resource_id: resourceId, path: `/api/v1/jobs/${resourceId}` },
    },
    headers: { 'X-Request-ID': `req-${resourceId}` },
  })
}

/** A read failure whose `error` key has a dedicated catalogue entry (AC1, AC8). */
function readFailure(): ApiError {
  return decodeApiError({
    status: 409,
    body: {
      error: 'illegal_transition',
      message: 'Server-localized text that must not be rendered',
      details: { from: 'Draft', to: 'Closed' },
    },
    headers: { 'X-Request-ID': 'req-read-failure' },
  })
}

/** The accessible names of every control on a surface, in document order. */
function controlNames(container: HTMLElement): string[] {
  return within(container)
    .queryAllByRole('button')
    .map((control) => control.getAttribute('aria-label') ?? control.textContent ?? '')
}

// ── Requirement 21 AC3, AC4: the uniform denial ───────────────────────────────

describe('AuthorizationDeniedNotice (Requirement 21 AC3, AC4)', () => {
  it('renders byte-identical markup for two different resources', () => {
    const first = renderSurface(<ErrorPresenter error={denialFor('a1b2c3')} />)
    const firstHtml = first.container.innerHTML
    const firstControls = controlNames(first.container)
    first.unmount()

    const second = renderSurface(<ErrorPresenter error={denialFor('zz-999-not-a-real-id')} />)

    expect(second.container.innerHTML).toBe(firstHtml)
    expect(controlNames(second.container)).toEqual(firstControls)
    // The surface offers no resource-specific action at all.
    expect(firstControls).toEqual([])
  })

  it('ignores every prop that could make one denial differ from another', () => {
    const plain = renderSurface(<ErrorPresenter error={denialFor('a1b2c3')} />)
    const plainHtml = plain.container.innerHTML
    plain.unmount()

    const embellished = renderSurface(
      <ErrorPresenter
        error={denialFor('deleted-long-ago')}
        title="Job 42 is off limits"
        values={{ from: 'Draft', to: 'Closed' }}
        onRetry={() => undefined}
      >
        <button type="button">Request access to job 42</button>
      </ErrorPresenter>,
    )

    // Neither a title, nor interpolation values, nor a retry handler, nor extra
    // children can reach the denial branch: same text, same actions (AC4).
    expect(embellished.container.innerHTML).toBe(plainHtml)
    expect(controlNames(embellished.container)).toEqual([])
  })

  it('renders the one catalogue message and no resource detail or Support_Reference', () => {
    renderSurface(<ErrorPresenter error={denialFor('a1b2c3')} />)

    const surface = screen.getByTestId('authorization-denied')
    expect(surface).toHaveAttribute('role', 'alert')
    expect(surface).toHaveTextContent(authorizationDeniedMessage(i18n))
    expect(surface.textContent).not.toContain('a1b2c3')
    expect(surface.textContent).not.toContain('jobs')
    // A per-request value would be exactly the observable variation AC4 removes.
    expect(screen.queryByTestId('support-reference')).toBeNull()
    expect(screen.queryByTestId('error-state')).toBeNull()
  })

  it('matches the surface rendered directly, so there is only one denial screen', () => {
    const viaPresenter = renderSurface(<ErrorPresenter error={denialFor('a1b2c3')} />)
    const viaPresenterHtml = viaPresenter.container.innerHTML
    viaPresenter.unmount()

    const direct = renderSurface(<AuthorizationDeniedNotice />)

    expect(direct.container.innerHTML).toBe(viaPresenterHtml)
  })

  it('retains the denied request Support_Reference without rendering it (Req 23 AC3)', () => {
    renderSurface(<ErrorPresenter error={denialFor('a1b2c3')} />)

    expect(latestFailedSupportReference()).toBe('req-a1b2c3')
    expect(screen.queryByTestId('support-reference')).toBeNull()
  })
})

// ── Requirement 21 AC7: the empty state ───────────────────────────────────────

describe('EmptyState (Requirement 21 AC7)', () => {
  it('names the destination and offers no clear-filter control while unfiltered', () => {
    renderSurface(<EmptyState destination={i18n.t('shell:nav.jobs')} />)

    const surface = screen.getByTestId('empty-state')
    expect(surface).toHaveTextContent('Jobs')
    expect(surface).toHaveAttribute('role', 'status')
    expect(surface).toHaveAttribute('aria-live', 'polite')
    expect(screen.queryByTestId('empty-state-clear-filters')).toBeNull()
  })

  it('names the destination, says a filter is applied and clears it on request', async () => {
    const onClearFilters = vi.fn()
    renderSurface(
      <EmptyState destination={i18n.t('shell:nav.applicants')} filtered onClearFilters={onClearFilters} />,
    )

    const surface = screen.getByTestId('empty-state')
    expect(surface).toHaveTextContent(i18n.t('shell:state.emptyFiltered', { destination: 'Applicants' }))

    const clear = screen.getByTestId('empty-state-clear-filters')
    expect(clear).toHaveAccessibleName(i18n.t('shell:action.clearFilters'))
    await userEvent.click(clear)

    expect(onClearFilters).toHaveBeenCalledTimes(1)
  })

  it('renders a destination action beside the clear-filter control', () => {
    renderSurface(
      <EmptyState destination="Jobs" filtered onClearFilters={() => undefined}>
        <button type="button">Post a job</button>
      </EmptyState>,
    )

    expect(controlNames(screen.getByTestId('empty-state'))).toEqual(['Clear filters', 'Post a job'])
  })
})

// ── Requirement 21 AC8: the error state ───────────────────────────────────────

describe('ErrorState (Requirement 21 AC8, Req 23 AC1)', () => {
  it('renders the localized message, the Support_Reference and a working retry', async () => {
    const onRetry = vi.fn()
    renderSurface(<ErrorState error={readFailure()} onRetry={onRetry} />)

    const surface = screen.getByTestId('error-state')
    expect(surface).toHaveTextContent(i18n.t('errors:illegal_transition'))
    // AC1 maps the `error` key through the catalogue, not the body `message`.
    expect(surface.textContent).not.toContain('Server-localized text')
    expect(screen.getByTestId('support-reference-value')).toHaveTextContent('req-read-failure')

    await userEvent.click(screen.getByTestId('error-retry'))

    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(latestFailedSupportReference()).toBe('req-read-failure')
  })

  it('falls back to the generic message with the Support_Reference for an unknown key (AC2)', () => {
    const unknown = decodeApiError({
      status: 500,
      body: { error: 'no_such_error_key_9000' },
      headers: { 'X-Request-ID': 'req-unknown-key' },
    })
    renderSurface(<ErrorState error={unknown} onRetry={() => undefined} />)

    const surface = screen.getByTestId('error-state')
    expect(surface).toHaveTextContent(i18n.t('errors:fallback'))
    expect(surface.textContent).not.toContain('no_such_error_key_9000')
    expect(screen.getByTestId('support-reference-value')).toHaveTextContent('req-unknown-key')
    expect(screen.getByTestId('error-retry')).toBeInTheDocument()
  })

  it('renders no Support_Reference row when the failure carried none (Req 23 AC4)', () => {
    const referenceless = decodeApiError({ status: 500, body: { error: 'internal_server_error' } })
    renderSurface(<ErrorState error={referenceless} onRetry={() => undefined} />)

    expect(screen.getByTestId('error-state')).toHaveTextContent(i18n.t('errors:internal_server_error'))
    expect(screen.queryByTestId('support-reference')).toBeNull()
  })
})

// ── Requirement 20 AC7: announce without moving focus ─────────────────────────

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

/** A surface that starts an asynchronous read and announces its outcome. */
function AsyncReadProbe({ start }: { readonly start: () => Promise<string> }) {
  const [pending, setPending] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)

  return (
    <div>
      <button
        type="button"
        data-testid="probe-trigger"
        onClick={() => {
          setPending(true)
          void start().then((value) => {
            setOutcome(value)
            setPending(false)
          })
        }}
      >
        Load
      </button>
      {pending ? <LoadingState /> : null}
      <LiveAnnouncement message={outcome} />
    </div>
  )
}

/** A surface whose read fails, so the error state mounts after an interaction. */
function FailingReadProbe({ error }: { readonly error: unknown }) {
  const [failed, setFailed] = useState(false)

  return (
    <div>
      <button
        type="button"
        data-testid="probe-trigger"
        onClick={() => {
          setFailed(true)
        }}
      >
        Load
      </button>
      {failed ? <ErrorState error={error} onRetry={() => undefined} /> : <LoadingState />}
    </div>
  )
}

describe('LiveAnnouncement (Requirement 20 AC7)', () => {
  it('announces a completed asynchronous read without moving focus', async () => {
    const gate = deferred<string>()
    renderSurface(<AsyncReadProbe start={() => gate.promise} />)

    const trigger = screen.getByTestId('probe-trigger')
    await userEvent.click(trigger)

    expect(document.activeElement).toBe(trigger)
    expect(screen.getByTestId('loading-state')).toBeInTheDocument()
    // Nothing is announced before the outcome is known, so the change is what
    // assistive technology observes.
    expect(screen.getByTestId('live-announcement').textContent).toBe('')

    const focusedBeforeCompletion = document.activeElement
    await act(async () => {
      gate.resolve('12 jobs loaded')
      await gate.promise
    })

    const region = screen.getByTestId('live-announcement')
    expect(region).toHaveTextContent('12 jobs loaded')
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    // Focus is exactly where the user left it.
    expect(document.activeElement).toBe(focusedBeforeCompletion)
    expect(document.activeElement).toBe(trigger)
    expect(screen.queryByTestId('loading-state')).toBeNull()
  })

  it('is never itself focusable, so it cannot take focus on announcement', () => {
    renderSurface(<LiveAnnouncement message="Saved" />)

    const region = screen.getByTestId('live-announcement')
    expect(region).not.toHaveAttribute('tabindex')
    expect(region).not.toHaveAttribute('autofocus')
  })

  it('interrupts only when asked to', () => {
    renderSurface(<LiveAnnouncement message="Upload failed" assertive />)

    const region = screen.getByTestId('live-announcement')
    expect(region).toHaveAttribute('role', 'alert')
    expect(region).toHaveAttribute('aria-live', 'assertive')
    expect(region).toHaveAttribute('aria-atomic', 'true')
  })

  it('leaves focus untouched when a failed read replaces the loading indicator', async () => {
    renderSurface(<FailingReadProbe error={readFailure()} />)

    const trigger = screen.getByTestId('probe-trigger')
    await userEvent.click(trigger)

    expect(screen.getByTestId('error-state')).toBeInTheDocument()
    expect(document.activeElement).toBe(trigger)
  })
})

// ── Requirement 21 AC6: the loading indicator ─────────────────────────────────

describe('LoadingState (Requirement 21 AC6)', () => {
  it('names the wait in the accessibility tree by default', () => {
    renderSurface(<LoadingState />)

    const surface = screen.getByTestId('loading-state')
    expect(surface).toHaveAttribute('role', 'status')
    expect(surface).toHaveAttribute('aria-busy', 'true')
    expect(surface).toHaveTextContent(i18n.t('shell:state.loading'))
  })

  it('renders a destination-specific label as visible text when asked', () => {
    renderSurface(<LoadingState label="Loading jobs…" showLabel />)

    expect(screen.getByTestId('loading-state')).toHaveTextContent('Loading jobs…')
  })
})
