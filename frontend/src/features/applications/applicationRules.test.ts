/**
 * Unit tests for the Application rules (task 20.1).
 *
 * Requirement 14:
 * - AC2 the apply body carries the selected CV_Variant, and the selection defaults to
 *   the primary variant.
 * - AC3/AC4 a 201 is a recorded Application; a 200 with a `redirect_url` is not.
 * - AC5 only an address a browsing context may be pointed at is offered.
 * - AC6 every entry of `details.unmet` survives as its own condition.
 * - AC8 the retry hint is read from `details.retry_after_seconds`.
 * - AC9/AC10 newest first, ≤20 per page, cursor from the last returned identifier.
 * - AC12 an Applicant_Card renders exactly three fields.
 * - AC13 the four target statuses, and the optional reason.
 */

import { describe, expect, it } from 'vitest'

import { DEFAULT_PAGE_SIZE } from '../../lib/cursor'
import type { CvVariant } from '../cvs/variantRules'

import {
  applicantCardFields,
  applicantsQueryParams,
  APPLICANT_CARD_FIELDS,
  APPLICATIONS_PAGE_SIZE,
  APPLICATION_STATUS_TARGETS,
  applicationStatusBody,
  applyBody,
  applyOutcome,
  applyRefusal,
  externalRedirectUrl,
  isApplicationStatus,
  myApplicationsQueryParams,
  nextApplicationsPage,
  orderApplicationsNewestFirst,
  retryAfterSeconds,
  STATUS_REASON_BOUNDS,
  unmetConditions,
  validateStatusReason,
  type Application,
} from './applicationRules'
import {
  defaultVariantChoice,
  resolveVariantSelection,
  variantChoices,
} from './variantChoice'

function application(overrides: Partial<Application> = {}): Application {
  return {
    id: 'app-1',
    candidate_id: 'cand-1',
    cv_version_id: 'ver-1',
    jd_id: 'jd-1',
    jd_title: 'Backend engineer',
    jd_company: 'Acme',
    routed_channel: 'Senior_Dashboard',
    status: 'Submitted',
    submitted_at: '2025-03-04T10:00:00.000Z',
    created_at: '2025-03-04T10:00:00.000Z',
    updated_at: '2025-03-04T10:00:00.000Z',
    ...overrides,
  }
}

function variant(overrides: Partial<CvVariant> = {}): CvVariant {
  return {
    id: 'var-1',
    name: 'General',
    description: null,
    is_primary: false,
    is_archived: false,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  } as CvVariant
}

// ── AC2: the request body and the default selection ───────────────────────────

describe('applyBody (Req 14 AC2)', () => {
  it('carries the selected CV_Variant identifier', () => {
    expect(applyBody('var-7')).toEqual({ cv_variant_id: 'var-7' })
  })

  it('omits the member when nothing is selected, so the server resolves the primary', () => {
    expect(applyBody(null)).toEqual({})
    expect(applyBody('   ')).toEqual({})
    expect(applyBody(undefined)).toEqual({})
  })
})

describe('variant selection (Req 14 AC2)', () => {
  const variants = [
    variant({ id: 'a', name: 'General' }),
    variant({ id: 'b', name: 'Data', is_primary: true }),
    variant({ id: 'c', name: 'Old', is_archived: true }),
  ]

  it('defaults to the primary variant', () => {
    expect(defaultVariantChoice(variants)).toBe('b')
  })

  it('offers only variants that can still be applied with', () => {
    expect(variantChoices(variants).map((choice) => choice.id)).toEqual(['a', 'b'])
  })

  it('marks exactly one choice as primary', () => {
    expect(variantChoices(variants).filter((choice) => choice.isPrimary)).toHaveLength(1)
  })

  it('falls back to the first selectable variant when none is primary', () => {
    expect(defaultVariantChoice([variant({ id: 'a' }), variant({ id: 'b' })])).toBe('a')
  })

  it('selects nothing when there is nothing to select', () => {
    expect(defaultVariantChoice([])).toBeNull()
    expect(defaultVariantChoice([variant({ is_archived: true })])).toBeNull()
  })

  it('keeps a valid selection and replaces one the list no longer offers', () => {
    expect(resolveVariantSelection(variants, 'a')).toBe('a')
    expect(resolveVariantSelection(variants, 'c')).toBe('b')
    expect(resolveVariantSelection(variants, null)).toBe('b')
  })
})

// ── AC3, AC4, AC5: the two successes ──────────────────────────────────────────

describe('applyOutcome (Req 14 AC3, AC4)', () => {
  it('reads a 201 as a recorded Application carrying its status and timestamp', () => {
    const recorded = application({ status: 'Submitted' })
    expect(applyOutcome(201, recorded)).toEqual({ kind: 'recorded', application: recorded })
  })

  it('reads a 200 with a redirect_url as no Application recorded', () => {
    expect(applyOutcome(200, { redirect_url: 'https://careers.example.com/job/7' })).toEqual({
      kind: 'external',
      redirectUrl: 'https://careers.example.com/job/7',
    })
  })

  it('reports a success it cannot act on rather than claiming an Application', () => {
    expect(applyOutcome(200, {})).toEqual({ kind: 'unreadable' })
    expect(applyOutcome(200, null)).toEqual({ kind: 'unreadable' })
  })

  it('keeps a 201 a recorded Application even when it also carried a redirect_url', () => {
    const recorded = { ...application(), redirect_url: 'https://careers.example.com' }
    expect(applyOutcome(201, recorded).kind).toBe('recorded')
  })
})

describe('externalRedirectUrl (Req 14 AC4, AC5)', () => {
  it('accepts an absolute https or http address', () => {
    expect(externalRedirectUrl({ redirect_url: 'https://example.com/apply' })).toBe(
      'https://example.com/apply',
    )
    expect(externalRedirectUrl({ redirect_url: 'http://example.com/apply' })).toBe(
      'http://example.com/apply',
    )
  })

  it('refuses an address that is not an external navigation', () => {
    expect(externalRedirectUrl({ redirect_url: 'javascript:alert(1)' })).toBeNull()
    expect(externalRedirectUrl({ redirect_url: 'data:text/html,<p>hi</p>' })).toBeNull()
    expect(externalRedirectUrl({ redirect_url: '/apply' })).toBeNull()
  })

  it('reads no address out of a response that carries none', () => {
    expect(externalRedirectUrl({})).toBeNull()
    expect(externalRedirectUrl(null)).toBeNull()
    expect(externalRedirectUrl({ redirect_url: '   ' })).toBeNull()
  })
})

// ── AC6, AC7, AC8: the three refusals ─────────────────────────────────────────

describe('applyRefusal (Req 14 AC6, AC7, AC8)', () => {
  it('classifies the three refusals Requirement 14 names', () => {
    expect(applyRefusal({ error: 'precondition_unmet' })).toBe('precondition_unmet')
    expect(applyRefusal({ error: 'conflicting_state' })).toBe('conflicting_state')
    expect(applyRefusal({ error: 'rate_limited' })).toBe('rate_limited')
  })

  it('leaves every other failure to the Error_Presenter', () => {
    expect(applyRefusal({ error: 'not_authorized' })).toBe('other')
    expect(applyRefusal(new Error('boom'))).toBe('other')
    expect(applyRefusal(null)).toBe('other')
  })
})

describe('unmetConditions (Req 14 AC6)', () => {
  it('keeps every reported entry, in the reported order', () => {
    const conditions = unmetConditions({
      error: 'precondition_unmet',
      details: { unmet: ['profile_incomplete', 'no_cv_version'] },
    })
    expect(conditions).toEqual([
      { code: 'profile_incomplete', text: 'profile_incomplete' },
      { code: 'no_cv_version', text: 'no_cv_version' },
    ])
  })

  it('reads an object-shaped entry carrying a code and a message', () => {
    expect(
      unmetConditions({
        details: { unmet: [{ code: 'no_cv_version', message: 'Upload a CV first.' }] },
      }),
    ).toEqual([{ code: 'no_cv_version', text: 'Upload a CV first.' }])
  })

  it('drops an entry that names nothing and keeps the rest', () => {
    expect(
      unmetConditions({ details: { unmet: ['profile_incomplete', {}, null, 42] } }),
    ).toEqual([{ code: 'profile_incomplete', text: 'profile_incomplete' }])
  })

  it('reports no condition when the envelope carries no list', () => {
    expect(unmetConditions({ error: 'precondition_unmet' })).toEqual([])
    expect(unmetConditions({ details: { unmet: 'profile_incomplete' } })).toEqual([])
    expect(unmetConditions(null)).toEqual([])
  })
})

describe('retryAfterSeconds (Req 14 AC8)', () => {
  it('names the details member', () => {
    expect(retryAfterSeconds({ error: 'rate_limited', details: { retry_after_seconds: 30 } })).toBe(
      30,
    )
  })

  it('falls back to the value the Api_Client resolved from Retry-After', () => {
    expect(retryAfterSeconds({ error: 'rate_limited', retryAfterSeconds: 12 })).toBe(12)
  })

  it('reports none when neither is present or usable', () => {
    expect(retryAfterSeconds({ error: 'rate_limited' })).toBeNull()
    expect(
      retryAfterSeconds({ error: 'rate_limited', details: { retry_after_seconds: 'soon' } }),
    ).toBeNull()
  })
})

// ── AC9, AC10: order and paging ───────────────────────────────────────────────

describe('orderApplicationsNewestFirst (Req 14 AC9)', () => {
  it('orders by submission instant, newest first', () => {
    const ordered = orderApplicationsNewestFirst([
      application({ id: 'older', submitted_at: '2025-01-01T00:00:00.000Z' }),
      application({ id: 'newest', submitted_at: '2025-06-01T00:00:00.000Z' }),
      application({ id: 'middle', submitted_at: '2025-03-01T00:00:00.000Z' }),
    ])
    expect(ordered.map((entry) => entry.id)).toEqual(['newest', 'middle', 'older'])
  })

  it('leaves the source array untouched', () => {
    const source = [
      application({ id: 'a', submitted_at: '2025-01-01T00:00:00.000Z' }),
      application({ id: 'b', submitted_at: '2025-02-01T00:00:00.000Z' }),
    ]
    orderApplicationsNewestFirst(source)
    expect(source.map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('orders a same-instant pair deterministically', () => {
    const ordered = orderApplicationsNewestFirst([
      application({ id: 'a' }),
      application({ id: 'b' }),
    ])
    expect(ordered.map((entry) => entry.id)).toEqual(['b', 'a'])
  })
})

describe('the own-Application page (Req 14 AC10)', () => {
  it('requests at most twenty per page', () => {
    expect(APPLICATIONS_PAGE_SIZE).toBe(DEFAULT_PAGE_SIZE)
    expect(myApplicationsQueryParams(null)).toEqual({ limit: DEFAULT_PAGE_SIZE })
  })

  it('sends a cursor as after_id and omits an absent one', () => {
    expect(myApplicationsQueryParams('app-20')).toEqual({
      limit: DEFAULT_PAGE_SIZE,
      after_id: 'app-20',
    })
    expect(myApplicationsQueryParams('  ')).toEqual({ limit: DEFAULT_PAGE_SIZE })
  })

  it('continues from the last returned identifier while a full page was returned', () => {
    const page = Array.from({ length: DEFAULT_PAGE_SIZE }, (_unused, index) =>
      application({ id: `app-${index + 1}` }),
    )
    expect(nextApplicationsPage(page)).toEqual({
      hasNextPage: true,
      nextCursor: `app-${DEFAULT_PAGE_SIZE}`,
    })
  })

  it('reports no further page for a partial or empty page', () => {
    expect(nextApplicationsPage([application()]).hasNextPage).toBe(false)
    expect(nextApplicationsPage([]).hasNextPage).toBe(false)
    expect(nextApplicationsPage(undefined).hasNextPage).toBe(false)
  })
})

// ── AC12: the Applicant_Card ──────────────────────────────────────────────────

describe('the Applicant_Card (Req 14 AC12)', () => {
  it('renders exactly the three permitted fields', () => {
    expect(APPLICANT_CARD_FIELDS).toEqual([
      'full_name',
      'applied_role_title',
      'application_status',
    ])
  })

  it('maps a card to those three entries and no others', () => {
    const entries = applicantCardFields({
      full_name: 'Dana Cohen',
      applied_role_title: 'Backend engineer',
      application_status: 'Submitted',
    })
    expect(entries.map((entry) => entry.field)).toEqual([...APPLICANT_CARD_FIELDS])
    expect(entries.map((entry) => entry.value)).toEqual([
      'Dana Cohen',
      'Backend engineer',
      'Submitted',
    ])
  })

  it('ignores a field the payload added beyond the three', () => {
    const entries = applicantCardFields({
      full_name: 'Dana Cohen',
      applied_role_title: 'Backend engineer',
      application_status: 'Submitted',
      // A member the contract does not declare; it must not be rendered.
      email: 'dana@example.com',
    } as never)
    expect(entries).toHaveLength(3)
    expect(entries.map((entry) => entry.value)).not.toContain('dana@example.com')
  })

  it('bounds the applicant page and sends an applied status filter', () => {
    expect(applicantsQueryParams(null)).toEqual({ limit: DEFAULT_PAGE_SIZE })
    expect(applicantsQueryParams('Closed')).toEqual({
      limit: DEFAULT_PAGE_SIZE,
      status: 'Closed',
    })
  })
})

// ── AC13: the Admin status control ────────────────────────────────────────────

describe('the status control (Req 14 AC13)', () => {
  it('offers exactly the four target statuses', () => {
    expect([...APPLICATION_STATUS_TARGETS]).toEqual([
      'Submitted',
      'Under Review',
      'Forwarded to Recruiter',
      'Closed',
    ])
  })

  it('recognizes only a declared status', () => {
    expect(isApplicationStatus('Under Review')).toBe(true)
    expect(isApplicationStatus('Archived')).toBe(false)
    expect(isApplicationStatus(null)).toBe(false)
  })

  it('sends the reason when one was entered and omits it otherwise', () => {
    expect(applicationStatusBody('Closed', 'Role filled')).toEqual({
      status: 'Closed',
      reason: 'Role filled',
    })
    expect(applicationStatusBody('Closed', '')).toEqual({ status: 'Closed' })
    expect(applicationStatusBody('Closed', null)).toEqual({ status: 'Closed' })
  })

  it('submits an entered reason exactly as entered', () => {
    expect(applicationStatusBody('Closed', '  مُغلق  ')).toEqual({
      status: 'Closed',
      reason: '  مُغلق  ',
    })
  })

  it('accepts a blank reason and applies the declared bounds to an entered one', () => {
    expect(validateStatusReason('')).toBeNull()
    expect(validateStatusReason('Role filled')).toBeNull()
    expect(validateStatusReason('x'.repeat(STATUS_REASON_BOUNDS.maxLength))).toBeNull()
    expect(validateStatusReason('x'.repeat(STATUS_REASON_BOUNDS.maxLength + 1))).toMatchObject({
      path: 'reason',
      code: 'too_long',
    })
  })
})
