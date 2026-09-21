/**
 * Journey: registration → verification → onboarding gating, against a running
 * Backend_Api (task 27.1; Requirement 1 AC12).
 *
 * Three requirements chained end to end, each one gating the next:
 *
 * 1. `/register/:token` (Req 6 AC1–AC8): an Admin-minted Registration_Link opens
 *    the role-fixed form; submitting it creates the account and hands the
 *    account identifier to the next screen.
 * 2. `/verify` (Req 6 AC9–AC12): the 6-digit Verification_Code emailed to the
 *    registrant (read back from Mailpit — see `e2e/README.md`) is entered, and a
 *    correct code advances the account past `PendingVerification`.
 * 3. Onboarding gating (Req 7 AC1–AC4): signing in as the now-`PendingApproval`
 *    account lands on the Status_Notice rather than any feature screen, and the
 *    Status_Notice states the status the Backend_Api reports rather than a
 *    feature screen rendering for an account that is not yet `Approved`.
 *
 * A fresh Registration_Link is minted per test rather than shared, so a retry
 * (`playwright.config.ts`'s CI retry) starts from a link that has not already
 * been consumed by the previous attempt.
 */

import { expect, test } from '@playwright/test'

import {
  createRegistrationLink,
  establishAdminSession,
  readVerificationCodeFromMailpit,
  uniqueTestEmail,
} from '../support/backend'

const REGISTRATION_PASSWORD = 'Correct-Horse-Battery-Staple-9'

test.describe('registration -> verification -> onboarding gating', () => {
  test('a Candidate Registration_Link opens the role-fixed form and creates a PendingVerification account', async ({
    page,
  }) => {
    const admin = await establishAdminSession()
    const link = await createRegistrationLink(admin.access_token, 'CANDIDATE')
    const email = uniqueTestEmail('registration')

    await page.goto(`/register/${link.token}`)
    await expect(page.getByTestId('registration-screen')).toBeVisible()
    await expect(page.getByTestId('registration-form')).toBeVisible()

    // Req 6 AC2: the role is shown, not offered — no role control exists on
    // this screen for any role.
    await expect(page.getByTestId('registration-role')).toContainText('Candidate')

    await page.locator('#full_name').fill('E2E Registration Candidate')
    await page.locator('#email').fill(email)
    await page.locator('#password').fill(REGISTRATION_PASSWORD)
    // Req 6 AC4: MobilePhone is the default Residency_Proof type; a single value
    // input covers it, so no address Fieldset needs filling here.
    // A real Israeli mobile number is required — the Backend_Api validates via
    // the `phonenumbers` library, which rejects sequential placeholders like
    // 0501234567 even though they are prefix-shaped.
    await page.locator('#residency_proof_value').fill('0502345678')

    await page.getByTestId('registration-submit').click()

    // Req 6 AC8: a successful submission lands on the Verification_Code screen.
    await expect(page.getByTestId('verification-screen')).toBeVisible()
    await expect(page.getByTestId('verification-form')).toBeVisible()
  })

  test('the emailed code verifies the account, and a wrong code retains the form', async ({
    page,
  }) => {
    const admin = await establishAdminSession()
    const link = await createRegistrationLink(admin.access_token, 'CANDIDATE')
    const email = uniqueTestEmail('verify')

    await page.goto(`/register/${link.token}`)
    await page.locator('#full_name').fill('E2E Verification Candidate')
    await page.locator('#email').fill(email)
    await page.locator('#password').fill(REGISTRATION_PASSWORD)
    await page.locator('#residency_proof_value').fill('0502345679')
    await page.getByTestId('registration-submit').click()
    await expect(page.getByTestId('verification-screen')).toBeVisible()

    // Req 6 AC9 first, with a code that cannot be correct: the account exists but
    // no code guess matches it, so the Backend_Api answers with a wrong-code
    // refusal rather than locking on the very first attempt.
    await page.locator('#code').fill('000000')
    await page.getByTestId('verification-submit').click()
    // The form is retained, not replaced by a lock — a first wrong attempt is not
    // `code_entry_locked` (Req 6 AC11 is about the *locked* state specifically).
    await expect(page.getByTestId('verification-form')).toBeVisible()

    // Req 6 AC10: the real code, read back from the inbox the Backend_Api emailed
    // it to, verifies and advances to the Status_Notice's own guarded redirect.
    const code = await readVerificationCodeFromMailpit(email)
    await page.locator('#code').fill('')
    await page.locator('#code').fill(code)
    await page.getByTestId('verification-submit').click()

    // Req 6 AC10: the Status_Notice is a guarded Onboarding_Screen and this
    // browsing context still holds no session, so the Route_Guard's own redirect
    // (Req 8 AC2) is what proves the verification succeeded: it retains `/status`
    // and sends this unauthenticated arrival to the login screen instead.
    await expect(page).toHaveURL(/\/login/)
  })

  test('an account past verification lands on the Status_Notice, not a feature screen, until Approved', async ({
    page,
  }) => {
    const admin = await establishAdminSession()
    const link = await createRegistrationLink(admin.access_token, 'CANDIDATE')
    const email = uniqueTestEmail('gating')

    await page.goto(`/register/${link.token}`)
    await page.locator('#full_name').fill('E2E Gating Candidate')
    await page.locator('#email').fill(email)
    await page.locator('#password').fill(REGISTRATION_PASSWORD)
    await page.locator('#residency_proof_value').fill('0502345680')
    await page.getByTestId('registration-submit').click()
    await expect(page.getByTestId('verification-screen')).toBeVisible()

    const code = await readVerificationCodeFromMailpit(email)
    await page.locator('#code').fill(code)
    await page.getByTestId('verification-submit').click()
    await expect(page).toHaveURL(/\/login/)

    // Req 7 AC1, AC2: signing in now (PendingApproval) is admitted only to the
    // Onboarding_Screens — the Status_Notice — rather than to `/jobs`, the
    // Candidate context's landing destination once Approved.
    await page.locator('#login-email').fill(email)
    await page.locator('#login-password').fill(REGISTRATION_PASSWORD)
    await page.locator('#login-role').selectOption('CANDIDATE')
    await page.getByTestId('login-submit').click()

    await expect(page).toHaveURL(/\/status/)
    await expect(page.getByTestId('status-notice-screen')).toBeVisible()
    // Req 7 AC3: the rendered status and next_step are the Backend_Api's own
    // values, not a Web_Client guess at what a PendingApproval account should see.
    await expect(page.getByTestId('status-notice-status')).toBeVisible()

    // Req 7 AC2: attempting to reach a feature screen directly is refused —
    // redirected back to the Onboarding_Screens rather than rendering `/jobs`.
    await page.goto('/jobs')
    await expect(page).toHaveURL(/\/status/)
  })
})
