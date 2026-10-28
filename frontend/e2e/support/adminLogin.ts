/**
 * Signing in as the seeded Admin through the real UI, including the MFA step.
 */

import { expect, type Page } from '@playwright/test'

import { SEED_ADMIN } from './backend'
import { currentTotpCode } from './totp'

/** Signs in as the seeded Admin through the real UI, including the MFA step. */
export async function loginAsAdminThroughUi(page: Page, totpSecret: string): Promise<void> {
  await page.goto('/login')
  await page.locator('#login-email').fill(SEED_ADMIN.email)
  await page.locator('#login-password').fill(SEED_ADMIN.password)
  await page.locator('#login-role').selectOption('ADMIN')
  await page.getByTestId('login-submit').click()

  const mfaStep = page.getByTestId('mfa-code-step')
  // The seeded Admin is MFA-enrolled, so the step always follows the credentials.
  // Wait for it: an immediate isVisible() check races the 401 mfa_required
  // response and silently skips the code (TASK-28 Bug 4).
  await expect(mfaStep).toBeVisible()
  await page.getByTestId('mfa-code-input').fill(currentTotpCode(totpSecret))
  await page.getByTestId('mfa-code-submit').click()
}
