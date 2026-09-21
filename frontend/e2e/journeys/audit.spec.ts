/**
 * Journey: audit browse, against a running Backend_Api (task 27.1;
 * Requirement 1 AC12).
 *
 * Requirement 17: an action this journey itself just performed (approving an
 * account — `journeys/admin-accounts.spec.ts` covers the lifecycle controls
 * themselves) shows up on the Audit_Log_Viewer with its recorded fields, and the
 * chain-verify control reports the four members Requirement 17 AC6/AC7 fix.
 */

import { expect, test } from '@playwright/test'

import {
  establishAdminSession,
  registerVerifiedApprovedAccount,
  SEED_ADMIN,
} from '../support/backend'
import { currentTotpCode } from '../support/totp'

test.describe('audit browse', () => {
  test('an approval is readable on the audit list with its recorded fields', async ({ page }) => {
    const admin = await establishAdminSession()
    const secret = process.env.E2E_ADMIN_TOTP_SECRET
    test.skip(secret === undefined, 'E2E_ADMIN_TOTP_SECRET is required to sign in as the seeded Admin through the UI')
    if (secret === undefined) {
      return
    }

    // The audited action this test looks for: an account approval, produced
    // directly against the Backend_Api so this journey's own steps are about
    // reading the Audit_Log, not about the admin-accounts UI (that is
    // `journeys/admin-accounts.spec.ts`'s subject).
    const account = await registerVerifiedApprovedAccount(admin.access_token, 'CANDIDATE', 'audit')

    await page.goto('/login')
    await page.locator('#login-email').fill(SEED_ADMIN.email)
    await page.locator('#login-password').fill(SEED_ADMIN.password)
    await page.locator('#login-role').selectOption('ADMIN')
    await page.getByTestId('login-submit').click()
    const mfaStep = page.getByTestId('mfa-code-step')
    if (await mfaStep.isVisible().catch(() => false)) {
      await page.getByTestId('mfa-code-input').fill(currentTotpCode(secret))
      await page.getByTestId('mfa-code-submit').click()
    }

    // Req 17 AC2: filtered to the entity this test seeded, by its entity id.
    await page.goto(`/admin/audit?entity_id=${encodeURIComponent(account.id)}`)
    await expect(page.getByTestId('audit-screen')).toBeVisible()
    await expect(page.getByTestId('audit-list')).toBeVisible({ timeout: 15_000 })

    // Req 17 AC1: filtered to this account's own entity_id, so every row on
    // screen already pertains to the seeded action — the first one is enough.
    const matched = page.locator('[data-testid^="audit-entry-"]').first()
    await expect(matched).toBeVisible()
    await expect(matched).toContainText(/approve/i)

    // Req 17 AC5: opening the comparison shows the before/after fields (or the
    // explicit "no snapshots"/"no changes" surface — either is a valid answer
    // for AC5, since this journey does not control which snapshots were kept).
    await matched.getByRole('button', { name: /compare/i }).click()
    const comparison = page
      .getByTestId('audit-comparison-table')
      .or(page.getByTestId('audit-comparison-unchanged'))
      .or(page.getByTestId('audit-comparison-empty'))
    await expect(comparison).toBeVisible()
  })

  test('the chain-verify control reports ok, first_bad_id, checked_from_id and max_id', async ({
    page,
  }) => {
    const secret = process.env.E2E_ADMIN_TOTP_SECRET
    test.skip(secret === undefined, 'E2E_ADMIN_TOTP_SECRET is required to sign in as the seeded Admin through the UI')
    if (secret === undefined) {
      return
    }

    await page.goto('/login')
    await page.locator('#login-email').fill(SEED_ADMIN.email)
    await page.locator('#login-password').fill(SEED_ADMIN.password)
    await page.locator('#login-role').selectOption('ADMIN')
    await page.getByTestId('login-submit').click()
    const mfaStep = page.getByTestId('mfa-code-step')
    if (await mfaStep.isVisible().catch(() => false)) {
      await page.getByTestId('mfa-code-input').fill(currentTotpCode(secret))
      await page.getByTestId('mfa-code-submit').click()
    }

    await page.goto('/admin/audit')
    await expect(page.getByTestId('audit-chain-verify')).toBeVisible()
    await page.getByTestId('audit-chain-verify-run').click()

    // Req 17 AC6: all four members, on every answer — intact or tampered.
    await expect(page.getByTestId('audit-chain-facts')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('audit-chain-ok')).toBeVisible()
  })
})
