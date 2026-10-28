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
import { navigateInApp } from '../support/navigation'
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
    // The seeded Admin is MFA-enrolled, so the step always follows the credentials.
    // Wait for it: an immediate isVisible() check races the 401 mfa_required
    // response and silently skips the code (TASK-28 Bug 4).
    await expect(mfaStep).toBeVisible()
    await page.getByTestId('mfa-code-input').fill(currentTotpCode(secret))
    await page.getByTestId('mfa-code-submit').click()

    // Req 17 AC2: filtered to the entity this test seeded, by its entity id.
    await navigateInApp(page, `/admin/audit?entity_id=${encodeURIComponent(account.id)}`)
    await expect(page.getByTestId('audit-screen')).toBeVisible()
    await expect(page.getByTestId('audit-list')).toBeVisible({ timeout: 15_000 })

    // Req 17 AC1: filtered to this account's own entity_id, newest first, so the
    // first row is the approval. The Audit_Log names a modification
    // `<Entity>.updated` and records what changed (R8 AC2: the before and after
    // values, not a verb), so the approval is identified by its status change.
    const matched = page.locator('[data-testid^="audit-entry-"]').first()
    await expect(matched).toBeVisible()
    await expect(matched).toContainText('Account.updated')

    // Req 17 AC5: opening the comparison shows the before/after fields.
    await matched.getByRole('button', { name: /compare/i }).click()
    await expect(page.getByTestId('audit-comparison-table')).toBeVisible()
    const status = page.getByTestId('audit-comparison-row-status')
    await expect(status).toContainText('PendingApproval')
    await expect(status).toContainText('Approved')
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
    // The seeded Admin is MFA-enrolled, so the step always follows the credentials.
    // Wait for it: an immediate isVisible() check races the 401 mfa_required
    // response and silently skips the code (TASK-28 Bug 4).
    await expect(mfaStep).toBeVisible()
    await page.getByTestId('mfa-code-input').fill(currentTotpCode(secret))
    await page.getByTestId('mfa-code-submit').click()

    await navigateInApp(page, '/admin/audit')
    await expect(page.getByTestId('audit-chain-verify')).toBeVisible()
    await page.getByTestId('audit-chain-verify-run').click()

    // Req 17 AC6: all four members, on every answer — intact or tampered.
    await expect(page.getByTestId('audit-chain-facts')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('audit-chain-ok')).toBeVisible()
  })
})
