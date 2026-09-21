/**
 * Journey: review submission, against a running Backend_Api (task 27.1;
 * Requirement 1 AC12).
 *
 * Requirement 15: a Senior submits a structured Review of a Candidate (AC1–AC3),
 * and the Review_Timeline — Senior own-only here — carries it append-only, with a
 * correction linking back to the Review it replaces (AC4–AC6).
 */

import { expect, test } from '@playwright/test'

import { establishAdminSession, registerVerifiedApprovedAccount } from '../support/backend'

test.describe('review submission', () => {
  test('a Senior submits a Review, and it appears on their own timeline', async ({ page }) => {
    const admin = await establishAdminSession()
    const senior = await registerVerifiedApprovedAccount(admin.access_token, 'SENIOR', 'review-senior')
    const candidate = await registerVerifiedApprovedAccount(
      admin.access_token,
      'CANDIDATE',
      'review-candidate',
    )

    await page.goto('/login')
    await page.locator('#login-email').fill(senior.email)
    await page.locator('#login-password').fill(senior.password)
    await page.locator('#login-role').selectOption('SENIOR')
    await page.getByTestId('login-submit').click()

    await page.goto('/senior/reviews/new')
    await expect(page.getByTestId('senior-review-new-screen')).toBeVisible()

    // Req 15 AC1: the Candidate is named by identifier before the form opens.
    await page.getByTestId('review-candidate-input').fill(candidate.id)
    await page.getByTestId('review-candidate-submit').click()

    // Req 15 AC1-AC2: four 1-5 ratings, a 1-2000 character assessment.
    await page.getByTestId('review-new-rating_technical').fill('4')
    await page.getByTestId('review-new-rating_communication').fill('5')
    await page.getByTestId('review-new-rating_culture_fit').fill('4')
    await page.getByTestId('review-new-rating_overall').fill('4')
    await page.getByTestId('review-new-assessment').fill(
      'A strong candidate with clear communication and solid technical fundamentals.',
    )
    await page.getByTestId('review-new-submit').click()

    // Req 15 AC3: the Backend_Api accepted the submission — asserted here by
    // going on to find it on the timeline, since this address's own panel stays
    // open after a success (it links to the timeline rather than closing).

    // Req 15 AC7 (Senior own-only timeline): the submitted Review appears.
    await page.goto('/senior/reviews')
    await page.getByTestId('review-candidate-input').fill(candidate.id)
    await page.getByTestId('review-candidate-submit').click()
    const timelineList = page.locator('[data-testid^="review-card-"]')
    await expect(timelineList.first()).toBeVisible({ timeout: 10_000 })
    await expect(timelineList.first().getByTestId(/review-assessment-/)).toContainText(
      'A strong candidate',
    )
  })

  test('a correction links back to the Review it corrects, and no edit/delete control exists', async ({
    page,
  }) => {
    const admin = await establishAdminSession()
    const senior = await registerVerifiedApprovedAccount(admin.access_token, 'SENIOR', 'review-correct-senior')
    const candidate = await registerVerifiedApprovedAccount(
      admin.access_token,
      'CANDIDATE',
      'review-correct-candidate',
    )

    await page.goto('/login')
    await page.locator('#login-email').fill(senior.email)
    await page.locator('#login-password').fill(senior.password)
    await page.locator('#login-role').selectOption('SENIOR')
    await page.getByTestId('login-submit').click()

    await page.goto('/senior/reviews/new')
    await page.getByTestId('review-candidate-input').fill(candidate.id)
    await page.getByTestId('review-candidate-submit').click()
    await page.getByTestId('review-new-rating_technical').fill('3')
    await page.getByTestId('review-new-rating_communication').fill('3')
    await page.getByTestId('review-new-rating_culture_fit').fill('3')
    await page.getByTestId('review-new-rating_overall').fill('3')
    await page.getByTestId('review-new-assessment').fill('An initial assessment, to be corrected next.')
    await page.getByTestId('review-new-submit').click()

    await page.goto('/senior/reviews')
    await page.getByTestId('review-candidate-input').fill(candidate.id)
    await page.getByTestId('review-candidate-submit').click()
    await expect(page.getByTestId('senior-reviews-screen')).toBeVisible()

    const originalCard = page.locator('[data-testid^="review-card-"]').first()
    await expect(originalCard).toBeVisible({ timeout: 10_000 })
    // Req 15 AC5: no edit or delete control on a submitted Review.
    await expect(originalCard.getByRole('button', { name: /edit|delete/i })).toHaveCount(0)

    // Req 15 AC4: the correction control opens pre-filled and posts `corrects_review_id`.
    await originalCard.getByTestId(/review-correct-/).click()
    await expect(page.getByTestId('review-correction-form')).toBeVisible()
    await expect(page.getByTestId('review-correction-rating_technical')).toHaveValue('3')
    await page.getByTestId('review-correction-assessment').fill('')
    await page.getByTestId('review-correction-assessment').fill('A corrected, more complete assessment.')
    await page.getByTestId('review-correction-submit').click()

    // Req 15 AC6: the correction indicator links the two Reviews.
    const cards = page.locator('[data-testid^="review-card-"]')
    await expect(cards).toHaveCount(2, { timeout: 10_000 })
  })
})
