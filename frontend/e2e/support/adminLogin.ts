/**
 * Signing in as the seeded Admin through the real UI, including the MFA step
 * when the backend asks for one (it does not with `MFA_REQUIRED=false`).
 */

import { expect, type Page } from '@playwright/test'

import { SEED_ADMIN } from './backend'
import { currentTotpCode } from './totp'

/**
 * After the credentials are submitted, enters the OTP if the backend asks for it.
 *
 * Waits for one outcome or the other: an immediate isVisible() check races the
 * 401 mfa_required response and silently skips the code (TASK-28 Bug 4).
 */
export async function completeAdminMfaIfAsked(page: Page, totpSecret: string): Promise<void> {
  const mfaStep = page.getByTestId('mfa-code-step')
  await expect(mfaStep.or(page.getByTestId('sign-out'))).toBeVisible()
  if (await mfaStep.isVisible()) {
    await page.getByTestId('mfa-code-input').fill(currentTotpCode(totpSecret))
    await page.getByTestId('mfa-code-submit').click()
  }
}

/** Signs in as the seeded Admin through the real UI. */
export async function loginAsAdminThroughUi(page: Page, totpSecret: string): Promise<void> {
  await page.goto('/login')
  await page.locator('#login-email').fill(SEED_ADMIN.email)
  await page.locator('#login-password').fill(SEED_ADMIN.password)
  await page.locator('#login-role').selectOption('ADMIN')
  await page.getByTestId('login-submit').click()
  await completeAdminMfaIfAsked(page, totpSecret)
}
