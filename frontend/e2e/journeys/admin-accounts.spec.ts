/**
 * Journey: admin account lifecycle, against a running Backend_Api (task 27.1;
 * Requirement 1 AC12).
 *
 * Requirement 16: mint a Registration_Link and show its token exactly once
 * (AC4–AC6), then drive one account through its status-driven lifecycle
 * controls (AC7–AC12) — approve, then suspend with a mandatory, confirmed
 * reason.
 */

import { expect, test } from '@playwright/test'

import { loginAsAdminThroughUi } from '../support/adminLogin'
import { establishAdminSession, registerVerifiedApprovedAccount } from '../support/backend'
import { navigateInApp } from '../support/navigation'

test.describe('admin account lifecycle', () => {
  test('minting a Registration_Link shows the token once, as copyable text', async ({ page }) => {
    // Establishes the Admin's own TOTP secret is reachable for the UI login below —
    // see e2e/README.md for how E2E_ADMIN_TOTP_SECRET is provisioned.
    await establishAdminSession()
    const secret = process.env.E2E_ADMIN_TOTP_SECRET
    test.skip(secret === undefined, 'E2E_ADMIN_TOTP_SECRET is required to sign in as the seeded Admin through the UI')
    if (secret === undefined) {
      return
    }

    await loginAsAdminThroughUi(page, secret)
    await expect(page).toHaveURL(/\/admin\/accounts/)

    // Req 16 AC4-AC5: the create-link control and the token shown exactly once.
    await page.getByTestId('registration-link-create-CANDIDATE').click()
    await expect(page.getByTestId('registration-link-issued')).toBeVisible()
    const token = await page.getByTestId('registration-link-token').textContent()
    expect(token).toBeTruthy()
    await expect(page.getByTestId('registration-link-expires')).toBeVisible()

    // Req 16 AC6: dismissing discards it — no later screen re-shows this value.
    await page.getByTestId('registration-link-dismiss').click()
    await expect(page.getByTestId('registration-link-issued')).toBeHidden()
  })

  test('an Approved account can be suspended behind a confirmed, reasoned dialog', async ({
    page,
  }) => {
    const admin = await establishAdminSession()
    const secret = process.env.E2E_ADMIN_TOTP_SECRET
    test.skip(secret === undefined, 'E2E_ADMIN_TOTP_SECRET is required to sign in as the seeded Admin through the UI')
    if (secret === undefined) {
      return
    }

    // Already Approved: `registerVerifiedApprovedAccount` drives registration,
    // verification and approval directly against the Backend_Api (those steps
    // are their own journeys — `registration.spec.ts`), so this test's own UI
    // interaction is squarely the suspend control and its dialog.
    const account = await registerVerifiedApprovedAccount(
      admin.access_token,
      'CANDIDATE',
      'lifecycle',
    )

    await loginAsAdminThroughUi(page, secret)
    // AccountFiltersPanel offers status/role only, no free-text search — filter
    // to CANDIDATE + Approved to narrow the walk, then page forward (AC3) until
    // this test's own seeded account is on screen.
    await navigateInApp(page, '/admin/accounts?status=Approved&role=CANDIDATE')
    await expect(page.getByTestId('accounts-list')).toBeVisible()

    // The list is oldest first, so the seeded account is on the last page. Each
    // page change renders the pending state (the list and its next control
    // unmount) before the new rows, so a step is complete only once the first
    // card has changed; reading the next control mid-load would end the walk
    // early.
    const card = page.locator(`[data-testid="account-card-${account.id}"]`)
    const firstCard = page.locator('[data-testid^="account-card-"]').first()
    await expect(firstCard).toBeVisible()
    for (let attempt = 0; attempt < 50 && (await card.count()) === 0; attempt += 1) {
      const nextPage = page.getByTestId('accounts-next-page')
      if ((await nextPage.count()) === 0) {
        break
      }
      const previousFirst = (await firstCard.getAttribute('data-testid')) ?? ''
      await nextPage.click()
      await expect(firstCard).not.toHaveAttribute('data-testid', previousFirst)
    }
    await expect(card).toHaveAttribute('data-account-status', 'Approved')

    // Req 16 AC10, AC16: suspend requires a reason and a confirmation dialog —
    // the request is issued from inside the dialog, never from the list control
    // directly.
    await card.getByTestId(`account-action-suspend-${account.id}`).click()
    await expect(page.getByTestId(`account-confirm-${account.id}`)).toBeVisible()
    await page.getByTestId('account-confirm-reason').fill('E2E lifecycle journey suspension reason.')
    await page.getByTestId('account-confirm-submit').click()

    await expect(card).toHaveAttribute('data-account-status', 'Suspended')
  })
})
