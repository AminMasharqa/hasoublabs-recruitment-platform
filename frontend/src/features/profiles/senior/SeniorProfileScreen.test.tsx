/**
 * The contact-preference conditionals of the Senior profile, asserted through the
 * rendered controls (Requirement 10 AC4, AC5, AC6, AC7).
 *
 * `model.test.ts` already states all four rules as pure facts — which channel
 * presents a scope, which member the request body carries, which combination is
 * refused. What it cannot state is the wiring, and that is what every case here is
 * about:
 *
 * - **AC4** the scope control is actually on screen for a contactable channel,
 *   offers exactly the three scopes, and its "required" is reportable: submitting
 *   without a choice places the message on the control rather than sending a body
 *   without it.
 * - **AC5** choosing `None` removes the control *and* the member disappears from
 *   the body that is issued — one decision, observed at both ends in a single flow.
 * - **AC6/AC7** the requirement is stated beside the scope control as soon as the
 *   scope is chosen, and a save attempted without it reports the violation on the
 *   input it addresses with no request on the wire at all.
 *
 * So the screen is mounted whole over a stub Api_Client that behaves like the
 * Backend_Api — a save replaces the stored profile, a read returns it — and the
 * assertions are about what the Senior sees and what the client issues. Nothing
 * here re-asserts the pure mapping, and nothing mocks the form, the query cache or
 * the Form_Validator: a hidden control whose member still reached the request would
 * pass a test of either half alone.
 *
 * The route guarding of `/senior/profile` belongs to `routing/` and is covered by
 * `routes.test.tsx`, so the screen is mounted directly.
 */

import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { i18n as I18nextInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiClient, ApiSuccess } from '../../../api/client'
import type { ContactChannelPref } from '../../../api/enums'
import {
  CONTACT_CHANNEL_PREF_VALUES,
  CONTACT_SCOPE_PREF_VALUES,
} from '../../../forms/validators'
import { createI18n } from '../../../i18n'
import { AppServicesContext, type AppServices } from '../../../shell/appServices'
import { SKILLS_PATH } from '../shared/skills'

import type { SeniorProfile, SeniorProfileUpdate } from './model'
import { MY_SENIOR_PROFILE_PATH } from './queries'
import { SeniorProfileScreen } from './SeniorProfileScreen'

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * A persisted profile carrying a name, a company and a job title.
 *
 * Every scalar the Form_Validator requires is filled in, so a case that submits is
 * reporting *its own* rule rather than an unrelated blank field.
 */
function profile(overrides: Partial<SeniorProfile> = {}): SeniorProfile {
  return {
    id: 'senior-profile-1',
    account_id: 'account-1',
    full_name: 'Dana Levi',
    company_affiliation: 'Hasoub Labs',
    job_title: 'Principal engineer',
    contact_channel_pref: 'None',
    contact_scope_pref: null,
    expertise_skills: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    ...overrides,
  }
}

/** What the stub Backend_Api was asked, in order. */
interface Exchange {
  readonly method: string
  readonly path: string
  readonly body?: unknown
  readonly query?: unknown
}

interface Backend {
  readonly exchanges: Exchange[]
  readonly api: ApiClient
}

function answered<T>(data: T): Promise<ApiSuccess<T>> {
  return Promise.resolve({
    data,
    response: new Response(null, { status: 200 }),
    supportReference: 'req-ok',
  })
}

/**
 * An Api_Client answering the Senior profile read, the save and the taxonomy
 * search.
 *
 * A save stores what it received, so the read that follows a save returns the new
 * preference — which is what makes "the control the body agreed with" observable
 * rather than assumed.
 */
function backend(stored: SeniorProfile | null = profile()): Backend {
  const exchanges: Exchange[] = []
  let current = stored

  const request = vi.fn(
    (
      method: string,
      path: string,
      init?: { params?: { query?: Record<string, unknown> }; body?: unknown },
    ) => {
      exchanges.push({
        method,
        path,
        ...(init?.body === undefined ? {} : { body: init.body }),
        ...(init?.params?.query === undefined ? {} : { query: init.params.query }),
      })

      if (method === 'get' && path === SKILLS_PATH) {
        return answered([])
      }
      if (method === 'get' && path === MY_SENIOR_PROFILE_PATH) {
        return current === null
          ? Promise.reject({ error: 'not_found', httpStatus: 404, fieldViolations: [] })
          : answered({ ...current })
      }
      if (method === 'put' && path === MY_SENIOR_PROFILE_PATH) {
        const body = (init?.body ?? {}) as SeniorProfileUpdate
        current = {
          ...(current ?? profile()),
          ...body,
          contact_scope_pref:
            'contact_scope_pref' in body ? (body.contact_scope_pref ?? null) : null,
          expertise_skills: [...(body.expertise_skills ?? [])],
          updated_at: '2026-02-01T00:00:00Z',
        } as SeniorProfile
        return answered({ ...current })
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

let i18n: I18nextInstance

beforeEach(() => {
  i18n = createI18n('en')
})

function mount(api: ApiClient) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const services: AppServices = { api, queryClient, clearServerState: () => undefined }

  return render(
    <MantineProvider>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <AppServicesContext.Provider value={services}>
            <SeniorProfileScreen />
          </AppServicesContext.Provider>
        </QueryClientProvider>
      </I18nextProvider>
    </MantineProvider>,
  )
}

/**
 * A labelled control.
 *
 * Matched on the label prefix because a required field's rendered label carries a
 * trailing asterisk, which is presentation rather than part of the field's name.
 */
function field(label: string): HTMLElement {
  return screen.getByLabelText(new RegExp(`^${label}`))
}

function findField(label: string): Promise<HTMLElement> {
  return screen.findByLabelText(new RegExp(`^${label}`))
}

const CHANNEL_LABEL = 'How you can be contacted'
const SCOPE_LABEL = 'Which jobs you can be contacted about'
const COMPANY_LABEL = 'Company affiliation'

function channelSelect(): HTMLSelectElement {
  return field(CHANNEL_LABEL) as HTMLSelectElement
}

function scopeSelect(): HTMLSelectElement {
  return field(SCOPE_LABEL) as HTMLSelectElement
}

function optionValues(select: HTMLSelectElement): readonly string[] {
  return [...select.querySelectorAll('option')].map((option) => option.value)
}

/** The bodies of every save this screen issued, in order. */
function saved(api: Backend): SeniorProfileUpdate[] {
  return api.exchanges
    .filter((exchange) => exchange.method === 'put' && exchange.path === MY_SENIOR_PROFILE_PATH)
    .map((exchange) => exchange.body as SeniorProfileUpdate)
}

/** Waits for the editor to be seeded from the read. */
async function loaded(): Promise<void> {
  await findField(CHANNEL_LABEL)
}

// ── AC4: the scope control is presented and required ──────────────────────────

describe('the Contact_Scope_Preference control (Req 10 AC4)', () => {
  /** Every channel AC4 covers: the declared set minus `None`. */
  const contactable = CONTACT_CHANNEL_PREF_VALUES.values.filter(
    (channel): channel is ContactChannelPref => channel !== 'None',
  )

  it.each(contactable)(
    'presents the scope control offering exactly the three scopes while the channel is %s',
    async (channel) => {
      mount(backend(profile({ contact_channel_pref: channel })).api)

      await loaded()
      expect(channelSelect()).toHaveValue(channel)
      expect(screen.getByTestId('senior-contact-scope')).toBeInTheDocument()

      // Exactly the declared scopes, plus the empty option that lets "nothing
      // chosen yet" be a reportable violation rather than a silent default.
      expect(optionValues(scopeSelect())).toEqual(['', ...CONTACT_SCOPE_PREF_VALUES.values])
      expect(screen.queryByTestId('senior-contact-none-note')).toBeNull()
    },
  )

  it('offers the four declared channels and nothing else (AC3)', async () => {
    mount(backend().api)

    await loaded()
    expect(optionValues(channelSelect())).toEqual([...CONTACT_CHANNEL_PREF_VALUES.values])
  })

  it('reports the missing scope on the control and issues no save', async () => {
    const user = userEvent.setup()
    const api = backend(profile({ contact_channel_pref: 'Email', contact_scope_pref: null }))
    mount(api.api)

    await loaded()
    await user.click(screen.getByTestId('senior-profile-save'))

    await waitFor(() => {
      expect(scopeSelect()).toHaveAttribute('aria-invalid', 'true')
    })
    expect(screen.getByTestId('contact_scope_pref-violation')).toHaveTextContent(
      'This field is required.',
    )
    // Req 20 AC6: the message is part of the control's accessible description and
    // focus is on it.
    expect(scopeSelect().getAttribute('aria-describedby')).toContain(
      'contact_scope_pref-violation',
    )
    expect(scopeSelect()).toHaveFocus()
    expect(saved(api)).toHaveLength(0)
  })
})

// ── AC5: `None` hides the control and omits the member ────────────────────────

describe('the channel None (Req 10 AC5)', () => {
  it('presents no scope control at all and omits the member from the save request', async () => {
    const user = userEvent.setup()
    const api = backend(profile({ contact_channel_pref: 'None' }))
    mount(api.api)

    await loaded()
    expect(screen.queryByTestId('senior-contact-scope')).toBeNull()
    expect(screen.queryByLabelText(new RegExp(`^${SCOPE_LABEL}`))).toBeNull()
    expect(screen.getByTestId('senior-contact-none-note')).toBeInTheDocument()

    await user.click(screen.getByTestId('senior-profile-save'))

    await waitFor(() => {
      expect(saved(api)).toHaveLength(1)
    })
    expect(saved(api)[0]).not.toHaveProperty('contact_scope_pref')
    expect(saved(api)[0]?.contact_channel_pref).toBe('None')
  })

  it('withdraws the control when the channel is changed to None, and the member with it', async () => {
    const user = userEvent.setup()
    const api = backend(
      profile({ contact_channel_pref: 'Email', contact_scope_pref: 'OwnPostingsOnly' }),
    )
    mount(api.api)

    await loaded()
    expect(scopeSelect()).toHaveValue('OwnPostingsOnly')

    await user.selectOptions(channelSelect(), 'None')

    await waitFor(() => {
      expect(screen.queryByTestId('senior-contact-scope')).toBeNull()
    })
    await user.click(screen.getByTestId('senior-profile-save'))

    await waitFor(() => {
      expect(saved(api)).toHaveLength(1)
    })
    // The scope the Senior had chosen is neither sent nor reported as a violation:
    // the hidden control and the absent member are one decision.
    expect(saved(api)[0]).not.toHaveProperty('contact_scope_pref')
    expect(screen.queryByTestId('form-level-messages')).toBeNull()
  })
})

// ── AC6: SameCompany requires a company affiliation ───────────────────────────

describe('the scope SameCompany (Req 10 AC6)', () => {
  it('states the requirement as soon as the scope is chosen', async () => {
    const user = userEvent.setup()
    mount(backend(profile({ contact_channel_pref: 'Email' })).api)

    await loaded()
    await user.selectOptions(scopeSelect(), 'SameCompany')

    expect(await screen.findByTestId('senior-contact-scope-requirement')).toHaveTextContent(
      'Same company requires a company affiliation above.',
    )
  })

  it('reports the missing company affiliation before any request is issued', async () => {
    const user = userEvent.setup()
    const api = backend(
      profile({
        company_affiliation: null,
        contact_channel_pref: 'Email',
        contact_scope_pref: 'SameCompany',
      }),
    )
    mount(api.api)

    await loaded()
    expect(field(COMPANY_LABEL)).toHaveValue('')
    await user.click(screen.getByTestId('senior-profile-save'))

    await waitFor(() => {
      expect(field(COMPANY_LABEL)).toHaveAttribute('aria-invalid', 'true')
    })
    expect(screen.getByTestId('company_affiliation-violation')).toHaveTextContent(
      'This field is required.',
    )
    expect(field(COMPANY_LABEL)).toHaveFocus()
    expect(saved(api)).toHaveLength(0)
  })

  it('saves the chosen scope once a company affiliation is entered', async () => {
    const user = userEvent.setup()
    const api = backend(
      profile({
        company_affiliation: null,
        contact_channel_pref: 'Email',
        contact_scope_pref: 'SameCompany',
      }),
    )
    mount(api.api)

    await loaded()
    await user.type(field(COMPANY_LABEL), 'Hasoub Labs')
    await user.click(screen.getByTestId('senior-profile-save'))

    await waitFor(() => {
      expect(saved(api)).toHaveLength(1)
    })
    expect(saved(api)[0]).toMatchObject({
      company_affiliation: 'Hasoub Labs',
      contact_channel_pref: 'Email',
      contact_scope_pref: 'SameCompany',
    })
  })
})

// ── AC7: FieldOfExpertise requires an expertise skill ─────────────────────────

describe('the scope FieldOfExpertise (Req 10 AC7)', () => {
  it('states the requirement as soon as the scope is chosen', async () => {
    const user = userEvent.setup()
    mount(backend(profile({ contact_channel_pref: 'Chat' })).api)

    await loaded()
    await user.selectOptions(scopeSelect(), 'FieldOfExpertise')

    expect(await screen.findByTestId('senior-contact-scope-requirement')).toHaveTextContent(
      'Field of expertise requires at least one expertise skill below.',
    )
  })

  it('reports the empty expertise editor before any request is issued', async () => {
    const user = userEvent.setup()
    const api = backend(
      profile({
        contact_channel_pref: 'Both',
        contact_scope_pref: 'FieldOfExpertise',
        expertise_skills: [],
      }),
    )
    mount(api.api)

    await loaded()
    expect(screen.getByTestId('senior-expertise-empty')).toBeInTheDocument()
    await user.click(screen.getByTestId('senior-profile-save'))

    // With no row rendered there is no input to attach the count violation to, so
    // Req 22 AC10 puts it in the form-level region rather than dropping it.
    expect(await screen.findByTestId('form-level-messages')).toHaveTextContent(
      'Add at least 1 entries',
    )
    expect(saved(api)).toHaveLength(0)
  })

  it('places the requirement on the first expertise input once a row is rendered', async () => {
    const user = userEvent.setup()
    const api = backend(
      profile({ contact_channel_pref: 'Both', contact_scope_pref: 'FieldOfExpertise' }),
    )
    mount(api.api)

    await loaded()
    await user.click(screen.getByTestId('senior-expertise-add'))
    // A row holding nothing is not a skill, so the requirement is still unmet.
    await user.click(screen.getByTestId('senior-profile-save'))

    await waitFor(() => {
      expect(screen.getByTestId('expertise_skills-0-violation')).toBeInTheDocument()
    })
    const term = screen.getByTestId('skill-term-expertise_skills.0')
    expect(term).toHaveAttribute('aria-invalid', 'true')
    expect(term.getAttribute('aria-describedby')).toContain('expertise_skills-0-violation')
    expect(saved(api)).toHaveLength(0)
  })

  it('saves the chosen scope once an expertise skill is entered, retaining the term', async () => {
    const user = userEvent.setup()
    const api = backend(
      profile({ contact_channel_pref: 'Both', contact_scope_pref: 'FieldOfExpertise' }),
    )
    mount(api.api)

    await loaded()
    await user.click(screen.getByTestId('senior-expertise-add'))
    await user.type(await screen.findByTestId('skill-term-expertise_skills.0'), 'Kubernetes')
    await user.click(screen.getByTestId('senior-profile-save'))

    await waitFor(() => {
      expect(saved(api)).toHaveLength(1)
    })
    expect(saved(api)[0]).toMatchObject({
      contact_channel_pref: 'Both',
      contact_scope_pref: 'FieldOfExpertise',
      expertise_skills: ['Kubernetes'],
    })
    expect(screen.getByTestId('skill-term-expertise_skills.0')).toHaveValue('Kubernetes')
  })
})
