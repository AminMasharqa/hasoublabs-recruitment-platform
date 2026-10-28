/**
 * The Applicant_Card restriction, asserted against the rendered DOM
 * (Requirement 14 AC12).
 *
 * AC12 is a restriction as much as a rendering: a Senior or an Admin sees **exactly**
 * the full name, the applied role title and the Application status — the three fields
 * the contract marks as the only ones that may ever be shown about a Candidate.
 *
 * `applicationRules.test.ts` already fixes the three-field tuple and shows that
 * `applicantCardFields` ignores a fourth member. What it cannot show is that the
 * *screen* ignores it too: a card that iterated the payload, or rendered a member
 * beside the mapped entries, would satisfy the pure test and still leak. So the list
 * is mounted over a stub Api_Client whose payload deliberately carries members beyond
 * the three — an email address, a candidate identifier, a date of birth — and the
 * assertions are about what is in the DOM and what is not. A leak fails here.
 *
 * The payload is cast to `ApplicantCard`, because the generated declarations describe
 * exactly three members: the extra ones are what a Backend_Api that grew a field
 * would actually send, which is the case the restriction exists for.
 *
 * Which accounts reach this list is the route group's decision, covered by
 * `routing/routes.test.tsx`; the list is mounted directly.
 */

import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import type { i18n as I18nextInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiClient, ApiSuccess } from '../../api/client'
import { createI18n } from '../../i18n'
import { AppServicesContext, type AppServices } from '../../shell/appServices'

import { ApplicantList } from './ApplicantList'
import { APPLICANTS_PATH } from './applicationsApi'
import { APPLICANT_CARD_FIELDS, type ApplicantCard } from './applicationRules'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const JD_ID = 'jd-7'

/** Values no Applicant_Card may ever render, carried by the payload below. */
const FORBIDDEN_VALUES = [
  'leak@example.com',
  'candidate-99',
  '1990-05-04',
  '+972-50-000-0000',
  'cv-version-3',
] as const

/**
 * Two Applicant_Cards, the first carrying five members beyond the permitted three.
 *
 * Every extra member is one a real Candidate row holds — contact details, the
 * identifier, the CV version the Application was submitted with — so a card that
 * rendered the payload rather than the three mapped fields would leak something the
 * Senior is not allowed to see.
 */
function cards(): readonly ApplicantCard[] {
  return [
    {
      full_name: 'Yara Haddad',
      applied_role_title: 'Platform engineer',
      application_status: 'Under Review',
      email: FORBIDDEN_VALUES[0],
      candidate_id: FORBIDDEN_VALUES[1],
      date_of_birth: FORBIDDEN_VALUES[2],
      phone: FORBIDDEN_VALUES[3],
      cv_version_id: FORBIDDEN_VALUES[4],
    },
    {
      full_name: 'Dana Cohen',
      applied_role_title: 'Backend engineer',
      application_status: 'Submitted',
    },
  ] as unknown as readonly ApplicantCard[]
}

interface Backend {
  /** The query of every applicant read, in order. */
  readonly queries: unknown[]
  readonly api: ApiClient
}

/** An Api_Client answering the applicant read with the payload above. */
function backend(payload: readonly ApplicantCard[]): Backend {
  const queries: unknown[] = []

  const request = vi.fn(
    (
      method: string,
      path: string,
      init?: { params?: { query?: Record<string, unknown> } },
    ) => {
      if (method === 'get' && path === APPLICANTS_PATH) {
        queries.push(init?.params?.query)
        return Promise.resolve({
          data: payload,
          response: new Response(null, { status: 200 }),
          supportReference: 'req-ok',
        } satisfies ApiSuccess<readonly ApplicantCard[]>)
      }
      return Promise.reject(new Error(`unexpected ${method} ${path}`))
    },
  )

  return {
    queries,
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
            <ApplicantList jdId={JD_ID} status={null} onStatusChange={() => undefined} />
          </AppServicesContext.Provider>
        </QueryClientProvider>
      </I18nextProvider>
    </MantineProvider>,
  )
}

/** The field groups of one rendered card, in rendered order. */
function renderedFields(index: number): readonly string[] {
  const card = screen.getByTestId(`applicant-card-${index}`)
  return within(card)
    .getAllByTestId(/^applicant-/)
    .map((group) => group.getAttribute('data-testid') ?? '')
}

// ── AC12: exactly three fields, and no fourth ────────────────────────────────

describe('an Applicant_Card (Req 14 AC12)', () => {
  it('renders exactly the three permitted fields of a payload that carries more', async () => {
    mount(backend(cards()).api)

    const card = await screen.findByTestId('applicant-card-0')

    // Exactly three field groups, in the order the tuple declares — not one per
    // member of the payload.
    expect(renderedFields(0)).toEqual(
      APPLICANT_CARD_FIELDS.map((field) => `applicant-${field}-0`),
    )
    expect(within(card).getAllByTestId(/^applicant-/)).toHaveLength(
      APPLICANT_CARD_FIELDS.length,
    )

    // The three values, each under its own label; the status localized from the
    // catalogue rather than echoed as the machine value.
    expect(within(card).getByTestId('applicant-full_name-0')).toHaveTextContent(
      'Full nameYara Haddad',
    )
    expect(within(card).getByTestId('applicant-applied_role_title-0')).toHaveTextContent(
      'Applied rolePlatform engineer',
    )
    expect(within(card).getByTestId('applicant-application_status-0')).toHaveTextContent(
      'Application statusUnder review',
    )
  })

  it('leaks no member beyond the three, anywhere on the surface', async () => {
    mount(backend(cards()).api)

    await screen.findByTestId('applicant-card-0')
    const surface = document.body.textContent ?? ''

    // Not just absent from the card: absent from the whole rendered surface, so a
    // member smuggled into a title, a label or an announcement fails too.
    for (const forbidden of FORBIDDEN_VALUES) {
      expect(surface).not.toContain(forbidden)
      expect(screen.queryByText(forbidden)).toBeNull()
    }
  })

  it('renders every card of the page the same way', async () => {
    mount(backend(cards()).api)

    await screen.findByTestId('applicant-card-1')

    // The second card carries exactly the three members and renders exactly the three
    // fields, so the count above is the card's shape rather than the payload's.
    expect(renderedFields(1)).toEqual(
      APPLICANT_CARD_FIELDS.map((field) => `applicant-${field}-1`),
    )
    expect(within(screen.getByTestId('applicant-card-1')).getByTestId('applicant-full_name-1'))
      .toHaveTextContent('Full nameDana Cohen')
  })

  it('renders three fields even when the payload omits one', async () => {
    // A card whose full name is missing: the row stays, blank, so the card's shape is
    // the requirement's and not the response's — a dropped row would silently change
    // which field the second value belongs to.
    mount(
      backend([
        { applied_role_title: 'Backend engineer', application_status: 'Closed' },
      ] as unknown as readonly ApplicantCard[]).api,
    )

    await screen.findByTestId('applicant-card-0')

    expect(renderedFields(0)).toEqual(
      APPLICANT_CARD_FIELDS.map((field) => `applicant-${field}-0`),
    )
    expect(screen.getByTestId('applicant-full_name-0')).toHaveTextContent('Full name')
  })

  it('asks for the applicants of the named Job_Description, bounded at a page', async () => {
    const api = backend(cards())
    mount(api.api)

    await screen.findByTestId('applicant-card-0')
    await waitFor(() => {
      expect(api.queries).toHaveLength(1)
    })
    // No `after_id`: an Applicant_Card carries no identifier to continue a keyset walk
    // with, which is why the list presents no next-page control.
    expect(api.queries[0]).toEqual({ limit: 20 })
  })
})
