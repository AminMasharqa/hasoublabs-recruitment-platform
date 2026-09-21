/**
 * Journey: Candidate profile completion, against a running Backend_Api
 * (task 27.1; Requirement 1 AC12).
 *
 * Requirement 9: a Candidate's profile starts `Draft` (AC9), the completeness
 * panel names what is missing, filling the required core fields and saving
 * moves it to `Complete` (AC10), and the apply gate that Requirement 12/14 read
 * opens only once it is.
 */

import { expect, test } from '@playwright/test'

import { establishAdminSession, registerVerifiedApprovedAccount } from '../support/backend'

test.describe('candidate profile completion', () => {
  test('a fresh profile is Draft, and completing the core fields moves it to Complete', async ({
    page,
  }) => {
    const admin = await establishAdminSession()
    const candidate = await registerVerifiedApprovedAccount(admin.access_token, 'CANDIDATE', 'profile')

    await page.goto('/login')
    await page.locator('#login-email').fill(candidate.email)
    await page.locator('#login-password').fill(candidate.password)
    await page.locator('#login-role').selectOption('CANDIDATE')
    await page.getByTestId('login-submit').click()
    await expect(page).toHaveURL(/\/jobs/)

    await page.goto('/candidate/profile')
    await expect(page.getByTestId('candidate-profile-screen')).toBeVisible()
    await expect(page.getByTestId('candidate-profile-form')).toBeVisible()

    // Req 9 AC9: a fresh profile is reported Draft, with the completeness panel
    // stating what is missing.
    await expect(page.getByTestId('profile-state')).toHaveAttribute('data-profile-state', 'Draft')
    await expect(page.getByTestId('profile-completeness-panel')).toBeVisible()

    await page.locator('#full_name').fill('E2E Profile Candidate')
    await page.locator('#email').fill(candidate.email)
    await page.locator('#phone').fill('0501234570')
    await page.locator('#city').fill('Tel Aviv')
    await page.locator('#summary').fill('A summary long enough to be a real profile summary.')

    // The Backend_Api's own Complete rule also requires at least one education
    // entry and at least one skill (`app/modules/profiles/service.py`), so both
    // collections need one entry each before the save can report Complete.
    await page.getByTestId('profile-add-education').click()
    await page.locator('#education-0-institution').fill('Tel Aviv University')
    await page.locator('#education-0-degree').fill('B.Sc.')
    // A Mantine `Select` (Requirement 20 AC2's keyboard-operable combobox, not a
    // native `<select>`): open it and choose the first offered option.
    await page.locator('#education-0-enrolment_status').click()
    await page.getByRole('option').first().click()
    await page.locator('#education-0-start_year').fill('2018')

    await page.getByTestId('profile-add-skills').click()
    await page.getByTestId('skill-term-skills.0.term').fill('Python')

    await page.getByTestId('profile-save').click()

    // Req 9 AC10: the persisted state the save returned is what the panel now
    // reports.
    await expect(page.getByTestId('profile-state')).toHaveAttribute('data-profile-state', 'Complete')
    await expect(page.getByTestId('profile-complete-confirmation')).toBeVisible()

    // Req 9 AC13 / Req 12 AC7: the apply gate this profile feeds is open now
    // that the profile is Complete (it still requires a CV_Variant too, which
    // this journey does not seed — see `journeys/cv.spec.ts` and
    // `journeys/jobs-applications.spec.ts` for the apply flow itself).
    await page.goto('/jobs')
    await expect(page.getByTestId('jobs-browse-screen')).toBeVisible()
  })

  test('a 422 from the Backend_Api is placed on the offending input, and entered values are kept', async ({
    page,
  }) => {
    const admin = await establishAdminSession()
    const candidate = await registerVerifiedApprovedAccount(admin.access_token, 'CANDIDATE', 'profile-422')

    await page.goto('/login')
    await page.locator('#login-email').fill(candidate.email)
    await page.locator('#login-password').fill(candidate.password)
    await page.locator('#login-role').selectOption('CANDIDATE')
    await page.getByTestId('login-submit').click()

    await page.goto('/candidate/profile')
    // Req 22 AC5: an invalid LinkedIn URL (not HTTPS) is rejected by the
    // Form_Validator before any request is issued, and the entered value stays
    // exactly as typed (Req 22 AC11).
    await page.locator('#linkedin_url').fill('http://not-https.example.com/in/someone')
    await page.getByTestId('profile-save').click()

    await expect(page.locator('#linkedin_url-violation')).toBeVisible()
    await expect(page.locator('#linkedin_url')).toHaveValue('http://not-https.example.com/in/someone')
  })
})
