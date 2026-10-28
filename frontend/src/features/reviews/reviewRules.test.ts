/**
 * Unit tests for the pure logic of the Review slice (task 21.1).
 *
 * Requirement 15:
 * - AC1 four integer 1–5 ratings and a 1–2000 character assessment are the bounds
 *   a draft is checked against.
 * - AC2 the collected values become the submission body.
 * - AC4 a correction opens pre-filled with the prior values and submits
 *   `corrects_review_id`.
 * - AC6 a correcting Review and the Review it corrects are linked in both
 *   directions, and the link survives the corrected Review sitting off the page.
 * - AC7 the timeline is ordered ascending by creation, `seq` breaking a tie.
 * - AC11 the next page's cursor is the last returned `seq`, and only a full page
 *   reports one.
 */

import { describe, expect, it } from 'vitest'

import {
  ASSESSMENT_BOUNDS,
  correctionLinks,
  draftFromReview,
  EMPTY_REVIEW_DRAFT,
  isCorrection,
  lastReviewId,
  nextReviewPage,
  orderTimelineAscending,
  parseRatingInput,
  RATING_BOUNDS,
  REVIEW_PAGE_SIZE,
  submitReviewBody,
  validateReviewDraft,
  type Review,
  type ReviewDraft,
} from './reviewRules'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function review(overrides: Partial<Review> & Pick<Review, 'id' | 'seq'>): Review {
  return {
    candidate_id: 'cand-1',
    reviewer_account_id: 'rev-1',
    jd_id: null,
    corrects_review_id: null,
    rating_technical: 4,
    rating_communication: 4,
    rating_culture_fit: 4,
    rating_overall: 4,
    assessment: 'Solid all round.',
    created_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function draft(overrides: Partial<ReviewDraft> = {}): ReviewDraft {
  return {
    rating_technical: '4',
    rating_communication: '3',
    rating_culture_fit: '5',
    rating_overall: '4',
    assessment: 'Clear communicator, strong fundamentals.',
    jd_id: '',
    ...overrides,
  }
}

// ── AC1: the bounds ───────────────────────────────────────────────────────────

describe('the review draft bounds (Req 15 AC1)', () => {
  it('accepts four integer ratings in range with an assessment', () => {
    expect(validateReviewDraft(draft())).toEqual([])
  })

  it('reports every rating outside 1–5, not just the first', () => {
    const issues = validateReviewDraft(
      draft({ rating_technical: '0', rating_overall: '6' }),
    )

    expect(issues.map((issue) => issue.path).sort()).toEqual([
      'rating_overall',
      'rating_technical',
    ])
  })

  it('reports a non-integer rating rather than silently dropping it', () => {
    const issues = validateReviewDraft(draft({ rating_culture_fit: '4.5' }))

    expect(issues.map((issue) => issue.path)).toEqual(['rating_culture_fit'])
  })

  it('reports a blank rating as required', () => {
    const issues = validateReviewDraft(draft({ rating_communication: '' }))

    expect(issues).toHaveLength(1)
    expect(issues[0]?.path).toBe('rating_communication')
    expect(issues[0]?.code).toBe('required')
  })

  it('reports an empty assessment and one beyond the maximum', () => {
    expect(validateReviewDraft(draft({ assessment: '' })).map((issue) => issue.path)).toEqual([
      'assessment',
    ])
    expect(
      validateReviewDraft(
        draft({ assessment: 'x'.repeat(ASSESSMENT_BOUNDS.maxLength + 1) }),
      ).map((issue) => issue.path),
    ).toEqual(['assessment'])
  })

  it('accepts an assessment exactly at each bound', () => {
    expect(
      validateReviewDraft(draft({ assessment: 'x'.repeat(ASSESSMENT_BOUNDS.minLength) })),
    ).toEqual([])
    expect(
      validateReviewDraft(draft({ assessment: 'x'.repeat(ASSESSMENT_BOUNDS.maxLength) })),
    ).toEqual([])
  })

  it('accepts each rating bound itself', () => {
    for (const value of [RATING_BOUNDS.min, RATING_BOUNDS.max]) {
      expect(
        validateReviewDraft(
          draft({
            rating_technical: String(value),
            rating_communication: String(value),
            rating_culture_fit: String(value),
            rating_overall: String(value),
          }),
        ),
      ).toEqual([])
    }
  })

  it('leaves the optional Job_Description association unconstrained', () => {
    expect(validateReviewDraft(draft({ jd_id: '' }))).toEqual([])
    expect(validateReviewDraft(draft({ jd_id: 'jd-1' }))).toEqual([])
  })
})

describe('rating input parsing', () => {
  it('reads an integer, reports a blank as absent and a non-integer as NaN', () => {
    expect(parseRatingInput(' 3 ')).toBe(3)
    expect(parseRatingInput('')).toBeNull()
    expect(parseRatingInput('   ')).toBeNull()
    expect(Number.isNaN(parseRatingInput('3.5'))).toBe(true)
    expect(Number.isNaN(parseRatingInput('three'))).toBe(true)
  })
})

// ── AC2, AC4: the submission body ─────────────────────────────────────────────

describe('the submission body (Req 15 AC2, AC4)', () => {
  it('sends the four ratings and the assessment', () => {
    expect(submitReviewBody(draft())).toEqual({
      rating_technical: 4,
      rating_communication: 3,
      rating_culture_fit: 5,
      rating_overall: 4,
      assessment: 'Clear communicator, strong fundamentals.',
    })
  })

  it('omits a blank Job_Description association rather than sending null', () => {
    const body = submitReviewBody(draft({ jd_id: '   ' }))

    expect(body).not.toHaveProperty('jd_id')
  })

  it('sends the Job_Description association when one was entered', () => {
    expect(submitReviewBody(draft({ jd_id: ' jd-7 ' }))).toMatchObject({ jd_id: 'jd-7' })
  })

  it('sends corrects_review_id for a correction and omits it otherwise (AC4)', () => {
    expect(submitReviewBody(draft(), 'prior-1')).toMatchObject({
      corrects_review_id: 'prior-1',
    })
    expect(submitReviewBody(draft(), null)).not.toHaveProperty('corrects_review_id')
    expect(submitReviewBody(draft(), '  ')).not.toHaveProperty('corrects_review_id')
  })

  it('submits the assessment byte-identically, including Arabic text (Req 19 AC11)', () => {
    const assessment = '  مرشح قوي جدًا في الجانب التقني.  '

    expect(submitReviewBody(draft({ assessment })).assessment).toBe(assessment)
  })
})

// ── AC4: the pre-filled correction draft ──────────────────────────────────────

describe('the correction pre-fill (Req 15 AC4)', () => {
  it('carries every collected value of the prior Review', () => {
    const prior = review({
      id: 'r1',
      seq: 3,
      rating_technical: 5,
      rating_communication: 2,
      rating_culture_fit: 3,
      rating_overall: 4,
      assessment: 'Reconsidered after the second interview.',
      jd_id: 'jd-9',
    })

    expect(draftFromReview(prior)).toEqual({
      rating_technical: '5',
      rating_communication: '2',
      rating_culture_fit: '3',
      rating_overall: '4',
      assessment: 'Reconsidered after the second interview.',
      jd_id: 'jd-9',
    })
  })

  it('renders an absent Job_Description association as a blank field', () => {
    expect(draftFromReview(review({ id: 'r1', seq: 1, jd_id: null })).jd_id).toBe('')
  })

  it('yields a blank draft for no Review at all', () => {
    expect(draftFromReview(null)).toEqual(EMPTY_REVIEW_DRAFT)
    expect(draftFromReview(undefined)).toEqual(EMPTY_REVIEW_DRAFT)
  })

  it('round-trips a prior Review into a body that restates its values', () => {
    const prior = review({ id: 'r1', seq: 3, rating_overall: 2, jd_id: 'jd-9' })
    const body = submitReviewBody(draftFromReview(prior), prior.id)

    expect(body).toEqual({
      rating_technical: prior.rating_technical,
      rating_communication: prior.rating_communication,
      rating_culture_fit: prior.rating_culture_fit,
      rating_overall: prior.rating_overall,
      assessment: prior.assessment,
      jd_id: 'jd-9',
      corrects_review_id: 'r1',
    })
  })
})

// ── AC7: ascending order ──────────────────────────────────────────────────────

describe('the timeline order (Req 15 AC7)', () => {
  it('orders ascending by creation regardless of the order received', () => {
    const ordered = orderTimelineAscending([
      review({ id: 'c', seq: 3, created_at: '2025-03-01T00:00:00.000Z' }),
      review({ id: 'a', seq: 1, created_at: '2025-01-01T00:00:00.000Z' }),
      review({ id: 'b', seq: 2, created_at: '2025-02-01T00:00:00.000Z' }),
    ])

    expect(ordered.map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
  })

  it('breaks a tie on the creation instant with seq', () => {
    const at = '2025-01-01T00:00:00.000Z'
    const ordered = orderTimelineAscending([
      review({ id: 'second', seq: 8, created_at: at }),
      review({ id: 'first', seq: 7, created_at: at }),
    ])

    expect(ordered.map((entry) => entry.id)).toEqual(['first', 'second'])
  })

  it('leaves the source list untouched', () => {
    const source = [review({ id: 'b', seq: 2 }), review({ id: 'a', seq: 1 })]
    orderTimelineAscending(source)

    expect(source.map((entry) => entry.id)).toEqual(['b', 'a'])
  })

  it('handles an absent page', () => {
    expect(orderTimelineAscending(null)).toEqual([])
    expect(orderTimelineAscending(undefined)).toEqual([])
  })
})

// ── AC6: correction links ─────────────────────────────────────────────────────

describe('the correction links (Req 15 AC6)', () => {
  it('links a correcting Review to the one it corrects, and back', () => {
    const original = review({ id: 'r1', seq: 1 })
    const correction = review({ id: 'r2', seq: 2, corrects_review_id: 'r1' })
    const links = correctionLinks([original, correction])

    expect(links.linkFor('r2').corrects).toBe(original)
    expect(links.linkFor('r2').correctsId).toBe('r1')
    expect(links.linkFor('r1').correctedBy).toEqual([correction])
  })

  it('reports the corrected identifier even when that Review is off the page', () => {
    const correction = review({ id: 'r2', seq: 12, corrects_review_id: 'earlier' })
    const link = correctionLinks([correction]).linkFor('r2')

    expect(link.correctsId).toBe('earlier')
    expect(link.corrects).toBeNull()
  })

  it('reports no correction for a Review that neither corrects nor was corrected', () => {
    const link = correctionLinks([review({ id: 'r1', seq: 1 })]).linkFor('r1')

    expect(link).toEqual({ corrects: null, correctsId: null, correctedBy: [] })
  })

  it('records every correction of one Review in order', () => {
    const original = review({ id: 'r1', seq: 1 })
    const first = review({ id: 'r2', seq: 2, corrects_review_id: 'r1' })
    const second = review({ id: 'r3', seq: 3, corrects_review_id: 'r1' })

    expect(
      correctionLinks([original, first, second])
        .linkFor('r1')
        .correctedBy.map((entry) => entry.id),
    ).toEqual(['r2', 'r3'])
  })

  it('treats a blank corrects_review_id as no correction', () => {
    const blank = review({ id: 'r1', seq: 1, corrects_review_id: '   ' })

    expect(isCorrection(blank)).toBe(false)
    expect(correctionLinks([blank]).linkFor('r1').correctsId).toBeNull()
  })
})

// ── AC11: the keyset cursor ───────────────────────────────────────────────────

describe('the next-page cursor (Req 15 AC11)', () => {
  function page(size: number): Review[] {
    return Array.from({ length: size }, (_unused, index) =>
      review({
        id: `r${index + 1}`,
        seq: index + 1,
        created_at: `2025-01-01T00:00:0${index % 10}.000Z`,
      }),
    )
  }

  it('reports the last returned seq for a full page', () => {
    const full = page(REVIEW_PAGE_SIZE)

    expect(nextReviewPage(full)).toEqual({ hasNextPage: true, nextCursor: REVIEW_PAGE_SIZE })
    expect(lastReviewId(full)).toBe(`r${REVIEW_PAGE_SIZE}`)
  })

  it('reports no next page for a partial page', () => {
    expect(nextReviewPage(page(REVIEW_PAGE_SIZE - 1))).toEqual({
      hasNextPage: false,
      nextCursor: null,
    })
  })

  it('reports no next page for an empty or absent page', () => {
    expect(nextReviewPage([])).toEqual({ hasNextPage: false, nextCursor: null })
    expect(nextReviewPage(undefined)).toEqual({ hasNextPage: false, nextCursor: null })
    expect(lastReviewId([])).toBeNull()
  })

  it('bounds a page at twenty rows', () => {
    expect(REVIEW_PAGE_SIZE).toBe(20)
  })
})
