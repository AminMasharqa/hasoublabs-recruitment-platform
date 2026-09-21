/**
 * Component tests for Candidate profile management (task 16.1).
 *
 * Requirement 9:
 * - AC1 the profile is loaded from `GET /api/v1/me/profile`.
 * - AC2–AC6 the core inputs and the four repeatable editors.
 * - AC7 a skill term queries `GET /api/v1/skills` and still accepts free text.
 * - AC8 a save sends every core field and every sub-collection present.
 * - AC9 a 200 reporting `Draft` names each unmet field.
 * - AC10 a 200 reporting `Complete` renders the confirmation.
 * - AC11 a 422 attaches every Field_Violation to the input its `path` addresses,
 *   indexed collection paths included, and retains every entered value.
 * - AC12 a rejected save leaves the persisted state on screen.
 * - AC13 the Draft consequence for applying is stated.
 * - AC14 the Admin read renders any Candidate's profile.
 *
 * Both screens are mounted directly over a stub Api_Client rather than through the
 * router: the guarding of `/candidate/profile` and `/admin/candidates/:accountId`
 * belongs to `routing/` and is covered by `routes.test.tsx`, so nothing here
 * re-asserts it.
 *
 * The stub behaves like the Backend_Api the screens talk to — a save replaces the
 * stored profile and the following read returns it — so the assertions are about
 * what the screen issues and then renders, not about a hand-written sequence of
 * canned responses.
 */

import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { i18n as I18nextInstance } from 'i18next'
import type { ReactElement } from 'react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiClient, ApiSuccess } from '../../../api/client'
import type { FieldViolation } from '../../../api/errors'
import { createI18n } from '../../../i18n'
import { AppServicesContext, type AppServices } from '../../../shell/appServices'
import { SKILLS_PATH } from '../shared/skills'

import { AdminCandidateProfileScreen } from './AdminCandidateProfileScreen'
import { CandidateProfileScreen } from './CandidateProfileScreen'
import type { CandidateProfile, CandidateProfileUpdate } from './model'
import { ADMIN_CANDIDATE_PROFILE_PATH, MY_PROFILE_PATH } from './queries'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function profile(overrides: Partial<CandidateProfile> = {}): CandidateProfile {
  return {
    id: 'profile-1',
    account_id: 'account-1',
    full_name: 'Layla Haddad',
    email: 'layla@example.com',
    phone: '+972500000000',
    city: 'Haifa',
    summary: null,
    linkedin_url: null,
    state: 'Draft',
    education: [],
    work_experience: [],
    skills: [],
    languages: [],
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

function educationEntry(): CandidateProfile['education'][number] {
  return {
    id: 'education-1',
    institution: 'Technion',
    degree: 'BSc',
    field_of_study: 'Computer Science',
    enrolment_status: 'Graduated',
    start_year: 2015,
    end_year: 2019,
    created_at: '2025-01-01T00:00:00Z',
  }
}

/** What the stub Backend_Api was asked, in order. */
interface Exchange {
  readonly method: string
  readonly path: string
  readonly body?: unknown
  readonly accountId?: string
  readonly query?: unknown
}

interface Backend {
  readonly exchanges: Exchange[]
  readonly api: ApiClient
  /**
   * Replaces what the next save answers with.
   *
   * A resolved profile becomes the stored one, so the read that follows the save
   * returns it — which is what makes the Draft→Complete transition observable. A
   * rejection stores nothing, which is what AC12 is about.
   */
  answerSaveWith(answer: () => Promise<unknown>): void
}

function answered<T>(data: T): Promise<ApiSuccess<T>> {
  return Promise.resolve({
    data,
    response: new Response(null, { status: 200 }),
    supportReference: 'req-ok',
  })
}

/** A 422 as the Api_Client decodes one, with its violations already extracted. */
function validationFailure(fieldViolations: readonly FieldViolation[]): unknown {
  return {
    error: 'validation_error',
    message: null,
    details: fieldViolations,
    request_id: 'req-422',
    httpStatus: 422,
    supportReference: 'req-422',
    refreshEligible: false,
    fieldViolations,
  }
}

interface BackendOptions {
  /** The profile the read answers with; `null` answers a 404. */
  readonly stored?: CandidateProfile | null
  /** The taxonomy rows `GET /skills` answers with. */
  readonly skills?: readonly Record<string, unknown>[]
}

function backend(options: BackendOptions = {}): Backend {
  const exchanges: Exchange[] = []
  let current = options.stored === undefined ? profile() : options.stored
  let saveAnswer: (() => Promise<unknown>) | null = null

  const request = vi.fn(
    (
      method: string,
      path: string,
      init?: {
        params?: { path?: Record<string, string>; query?: Record<string, unknown> }
        body?: unknown
      },
    ) => {
      exchanges.push({
        method,
        path,
        ...(init?.body === undefined ? {} : { body: init.body }),
        ...(init?.params?.path?.account_id === undefined
          ? {}
          : { accountId: init.params.path.account_id }),
        ...(init?.params?.query === undefined ? {} : { query: init.params.query }),
      })

      if (method === 'get' && path === SKILLS_PATH) {
        return answered(options.skills ?? [])
      }
      if (method === 'get' && (path === MY_PROFILE_PATH || path === ADMIN_CANDIDATE_PROFILE_PATH)) {
        return current === null
          ? Promise.reject({ error: 'not_found', httpStatus: 404, fieldViolations: [] })
          : answered({ ...current })
      }
      if (method === 'put' && path === MY_PROFILE_PATH) {
        if (saveAnswer === null) {
          return answered({ ...(current ?? profile()) })
        }
        return saveAnswer().then((saved) => {
          current = saved as CandidateProfile
          return answered(saved)
        })
      }
      return Promise.reject(new Error(`unexpected ${method} ${path}`))
    },
  )

  return {
    exchanges,
    answerSaveWith(answer) {
      saveAnswer = answer
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

function mount(api: ApiClient, element: ReactElement, initialPath = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const services: AppServices = { api, queryClient, clearServerState: () => undefined }

  return render(
    <MantineProvider>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <AppServicesContext.Provider value={services}>
            <MemoryRouter initialEntries={[initialPath]}>
              <Routes>
                <Route path="/admin/candidates/:accountId" element={element} />
                <Route path="*" element={element} />
              </Routes>
            </MemoryRouter>
          </AppServicesContext.Provider>
        </QueryClientProvider>
      </I18nextProvider>
    </MantineProvider>,
  )
}

/**
 * A labelled input.
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

function saved(api: Backend): CandidateProfileUpdate[] {
  return api.exchanges
    .filter((exchange) => exchange.method === 'put' && exchange.path === MY_PROFILE_PATH)
    .map((exchange) => exchange.body as CandidateProfileUpdate)
}

// ── AC1–AC6: loading and the editors ──────────────────────────────────────────

describe('loading the profile (Req 9 AC1, AC2)', () => {
  it('reads GET /me/profile and fills the core inputs with the persisted values', async () => {
    const api = backend({ stored: profile({ summary: 'ملخص مهني' }) })
    mount(api.api, <CandidateProfileScreen />)

    expect(await findField('Full name')).toHaveValue('Layla Haddad')
    expect(field('Email address')).toHaveValue('layla@example.com')
    expect(field('Phone number')).toHaveValue('+972500000000')
    expect(field('City')).toHaveValue('Haifa')
    // Req 19 AC10: Arabic content arrives byte-identically.
    expect(field('Summary')).toHaveValue('ملخص مهني')
    expect(field('LinkedIn URL')).toHaveValue('')

    expect(api.exchanges.filter((exchange) => exchange.path === MY_PROFILE_PATH)).toEqual([
      { method: 'get', path: MY_PROFILE_PATH },
    ])
  })

  it('opens an empty editor when no profile is stored yet', async () => {
    mount(backend({ stored: null }).api, <CandidateProfileScreen />)

    expect(await findField('Full name')).toHaveValue('')
    expect(screen.queryByTestId('error-state')).toBeNull()
  })

  it('renders each repeatable editor, empty until an entry is added (AC3–AC6)', async () => {
    const user = userEvent.setup()
    mount(backend().api, <CandidateProfileScreen />)

    await screen.findByTestId('profile-section-education')
    for (const collection of ['education', 'work_experience', 'skills', 'languages'] as const) {
      expect(screen.getByTestId(`profile-empty-${collection}`)).toBeInTheDocument()
      expect(screen.getByTestId(`profile-add-${collection}`)).toBeEnabled()
    }

    await user.click(screen.getByTestId('profile-add-education'))
    expect(await screen.findByTestId('profile-entry-education-0')).toBeInTheDocument()
    expect(field('Institution')).toHaveValue('')

    await user.click(screen.getByTestId('profile-remove-education-0'))
    await waitFor(() => {
      expect(screen.queryByTestId('profile-entry-education-0')).toBeNull()
    })
  })

  it('renders the persisted education entry with its members (AC3)', async () => {
    mount(
      backend({ stored: profile({ education: [educationEntry()] }) }).api,
      <CandidateProfileScreen />,
    )

    expect(await findField('Institution')).toHaveValue('Technion')
    expect(field('Degree')).toHaveValue('BSc')
    expect(field('Start year')).toHaveValue(2015)
    expect(field('End year')).toHaveValue(2019)
  })
})

// ── AC7: taxonomy suggestions ─────────────────────────────────────────────────

describe('the skill term input (Req 9 AC7)', () => {
  it('queries GET /skills with the entered text and still accepts a free-text term', async () => {
    const user = userEvent.setup()
    const api = backend({ skills: [{ id: 'skill-1', name: 'Kubernetes' }] })
    mount(api.api, <CandidateProfileScreen />)

    await screen.findByTestId('profile-add-skills')
    await user.click(screen.getByTestId('profile-add-skills'))
    // Addressed by its canonical path rather than its label: the `Skills` section
    // legend also labels a region, and only one of the two is the input.
    const term = await screen.findByTestId('skill-term-skills.0.term')
    await user.type(term, 'Kube')

    await waitFor(() => {
      expect(api.exchanges.filter((exchange) => exchange.path === SKILLS_PATH)).not.toHaveLength(0)
    })
    expect(
      api.exchanges.filter((exchange) => exchange.path === SKILLS_PATH).at(-1)?.query,
    ).toEqual({ q: 'Kube' })
    // The free-text term is what the input holds; a suggestion never replaces it.
    expect(term).toHaveValue('Kube')
    // And it is labelled, whichever way it is addressed (Req 20 AC5).
    expect(term).toHaveAccessibleName(/Skill/)
  })
})

// ── AC8: what a save sends ────────────────────────────────────────────────────

describe('saving the profile (Req 9 AC8)', () => {
  it('puts every core field and every sub-collection present in the form', async () => {
    const user = userEvent.setup()
    const api = backend({ stored: profile({ education: [educationEntry()] }) })
    mount(api.api, <CandidateProfileScreen />)

    await user.clear(await findField('City'))
    await user.type(field('City'), 'Nazareth')
    await user.click(screen.getByTestId('profile-save'))

    await waitFor(() => {
      expect(saved(api)).toHaveLength(1)
    })
    expect(saved(api)[0]).toEqual({
      full_name: 'Layla Haddad',
      email: 'layla@example.com',
      phone: '+972500000000',
      city: 'Nazareth',
      summary: null,
      linkedin_url: null,
      education: [
        {
          institution: 'Technion',
          degree: 'BSc',
          field_of_study: 'Computer Science',
          enrolment_status: 'Graduated',
          start_year: 2015,
          end_year: 2019,
        },
      ],
      // Present but empty: the Backend_Api replaces each collection wholesale, so
      // an omitted one would mean "leave it alone" rather than "it is now empty".
      work_experience: [],
      skills: [],
      languages: [],
    })
  })
})

// ── AC9, AC10, AC13: the completeness surface ─────────────────────────────────

describe('the completeness surface (Req 9 AC9, AC10, AC13)', () => {
  it('names each unmet field while the reported state is Draft', async () => {
    mount(backend({ stored: profile({ phone: null, city: null }) }).api, <CandidateProfileScreen />)

    const panel = await screen.findByTestId('profile-completeness-panel')
    const named = [...panel.querySelectorAll('[data-missing-field]')].map((item) =>
      item.getAttribute('data-missing-field'),
    )
    expect(named).toEqual(['phone', 'city', 'education', 'skills'])
    expect(panel).toHaveAttribute('role', 'status')

    // AC13: applying is off while the profile is a Draft, and the reason is stated.
    expect(screen.getByTestId('apply-blocked-notice')).toBeInTheDocument()
    expect(screen.queryByTestId('profile-complete-confirmation')).toBeNull()
  })

  it('names the unmet fields of the returned profile when a save answers 200 with Draft', async () => {
    const user = userEvent.setup()
    const stored = profile({ phone: null, city: null })
    const api = backend({ stored })
    // The save succeeds and the profile is still a Draft: a phone number arrived,
    // so what is left to do has changed. AC9 is about *the returned profile*, so
    // the panel must name the new set rather than the one it was rendered with.
    api.answerSaveWith(() =>
      Promise.resolve({
        ...stored,
        phone: '+972500000000',
        state: 'Draft',
        updated_at: '2025-02-01T00:00:00Z',
      }),
    )
    mount(api.api, <CandidateProfileScreen />)

    await screen.findByTestId('profile-completeness-panel')
    await user.click(screen.getByTestId('profile-save'))

    await waitFor(() => {
      const named = [
        ...screen
          .getByTestId('profile-completeness-panel')
          .querySelectorAll('[data-missing-field]'),
      ].map((item) => item.getAttribute('data-missing-field'))
      expect(named).toEqual(['city', 'education', 'skills'])
    })
    expect(screen.queryByTestId('profile-complete-confirmation')).toBeNull()
    expect(screen.getByTestId('profile-state')).toHaveAttribute('data-profile-state', 'Draft')
  })

  it('renders the confirmation once a save returns 200 with Complete', async () => {
    const user = userEvent.setup()
    const stored = profile({ education: [educationEntry()] })
    const api = backend({ stored })
    api.answerSaveWith(() =>
      Promise.resolve({
        ...stored,
        state: 'Complete',
        updated_at: '2025-02-01T00:00:00Z',
        skills: [{ name: 'Kubernetes', skill_id: 'skill-1', years_experience: 4 }],
      }),
    )
    mount(api.api, <CandidateProfileScreen />)

    await screen.findByTestId('profile-completeness-panel')
    await user.click(screen.getByTestId('profile-save'))

    expect(await screen.findByTestId('profile-complete-confirmation')).toBeInTheDocument()
    expect(screen.queryByTestId('profile-completeness-panel')).toBeNull()
    expect(screen.queryByTestId('apply-blocked-notice')).toBeNull()
    expect(screen.getByTestId('profile-state')).toHaveAttribute('data-profile-state', 'Complete')
  })
})

// ── AC11, AC12: a rejected save ───────────────────────────────────────────────

describe('a rejected save (Req 9 AC11, AC12)', () => {
  it('places an indexed violation on its input, retains the values and keeps the persisted state', async () => {
    const user = userEvent.setup()
    const api = backend({ stored: profile({ education: [educationEntry()] }) })
    api.answerSaveWith(() =>
      Promise.reject(
        validationFailure([
          {
            path: 'education[0].end_year',
            code: 'invalid_range',
            message: 'End year is before the start year.',
          },
          { path: 'phone', code: 'too_long', message: 'Phone number is too long.' },
          {
            path: 'residency_proof_value',
            code: 'invalid',
            message: 'Residency proof is not valid.',
          },
        ]),
      ),
    )
    mount(api.api, <CandidateProfileScreen />)

    await user.clear(await findField('City'))
    await user.type(field('City'), 'Nazareth')
    await user.click(screen.getByTestId('profile-save'))

    // AC11: the indexed path lands on the input it addresses, in either spelling.
    await waitFor(() => {
      expect(field('End year')).toHaveAttribute('aria-invalid', 'true')
    })
    expect(field('End year').getAttribute('aria-describedby')).toContain(
      'education-0-end_year-violation',
    )
    expect(screen.getByTestId('education-0-end_year-violation')).toHaveTextContent(
      'End year is before the start year.',
    )
    expect(field('Phone number')).toHaveAttribute('aria-invalid', 'true')

    // Req 22 AC10: a violation addressing no rendered input is shown, not dropped.
    expect(screen.getByTestId('form-level-messages')).toHaveTextContent(
      'Residency proof is not valid.',
    )

    // AC11: every entered value survives. Req 20 AC6: focus is on the first
    // affected input in rendering order.
    expect(field('City')).toHaveValue('Nazareth')
    expect(field('End year')).toHaveValue(2019)
    expect(field('Phone number')).toHaveFocus()

    // AC12: the persisted profile is still what the screen reports as server state.
    expect(screen.getByTestId('profile-state')).toHaveAttribute('data-profile-state', 'Draft')
  })

  it('issues no request when a client-side rule fails, and states it on the input', async () => {
    const user = userEvent.setup()
    const api = backend()
    mount(api.api, <CandidateProfileScreen />)

    await user.clear(await findField('Email address'))
    await user.type(field('Email address'), 'not-an-address')
    await user.click(screen.getByTestId('profile-save'))

    await waitFor(() => {
      expect(field('Email address')).toHaveAttribute('aria-invalid', 'true')
    })
    expect(saved(api)).toHaveLength(0)
    expect(field('Email address')).toHaveValue('not-an-address')
  })
})

// ── AC14: the Admin read ──────────────────────────────────────────────────────

describe('the Admin view of a Candidate profile (Req 9 AC14)', () => {
  it('reads the admin endpoint for the named account and renders the profile read-only', async () => {
    const api = backend({
      stored: profile({
        education: [educationEntry()],
        skills: [{ name: 'Kubernetes', skill_id: 'skill-1', years_experience: 4 }],
        languages: [
          {
            id: 'language-1',
            language_code: 'ar',
            proficiency: 'Native',
            created_at: '2025-01-01T00:00:00Z',
          },
        ],
      }),
    })
    mount(api.api, <AdminCandidateProfileScreen />, '/admin/candidates/account-1')

    expect(await screen.findByTestId('admin-candidate-profile')).toBeInTheDocument()
    expect(
      api.exchanges.filter((exchange) => exchange.path === ADMIN_CANDIDATE_PROFILE_PATH),
    ).toEqual([{ method: 'get', path: ADMIN_CANDIDATE_PROFILE_PATH, accountId: 'account-1' }])

    const view = screen.getByTestId('admin-candidate-profile')
    expect(view).toHaveTextContent('Layla Haddad')
    expect(screen.getByTestId('admin-education-entry')).toHaveTextContent('Technion')
    expect(screen.getByTestId('admin-skill-list')).toHaveTextContent('Kubernetes')
    expect(screen.getByTestId('admin-language-list')).toHaveTextContent('Native')

    // A read, not an editor: nothing here can attempt a write.
    expect(screen.queryByTestId('candidate-profile-form')).toBeNull()
    expect(screen.queryByTestId('profile-save')).toBeNull()
  })
})
