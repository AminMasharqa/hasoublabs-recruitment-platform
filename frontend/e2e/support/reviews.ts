/**
 * Review-journey helpers.
 */

import { expect, type Page } from '@playwright/test'

/**
 * Clicks the new-Review submit control and waits for the Backend_Api to accept it.
 *
 * The journeys go straight on to read the Review_Timeline. Navigating away the
 * moment the button is clicked lets the timeline read race the still-pending
 * `POST /candidates/{id}/reviews`, and the timeline then (correctly) shows nothing.
 */
export async function submitReview(page: Page): Promise<void> {
  const accepted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/candidates\/[^/]+\/reviews$/.test(new URL(response.url()).pathname),
  )
  await page.getByTestId('review-new-submit').click()
  expect((await accepted).status()).toBe(201)
}
