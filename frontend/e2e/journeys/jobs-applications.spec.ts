/**
 * Journey: job browse → apply → track, against a running Backend_Api
 * (task 27.1; Requirement 1 AC12).
 *
 * Requirement 12 (browse and detail), Requirement 14 (apply and track): a
 * Senior publishes a Job_Description, a Candidate — with a Complete profile and
 * a CV_Variant, both seeded directly since Requirement 9/11 are their own
 * journeys — finds it in the browse list, opens the detail view, applies with a
 * CV_Variant selection, and sees the resulting Application in their own list.
 */

import { expect, test } from '@playwright/test'

import {
  createOpenJob,
  establishAdminSession,
  login,
  registerVerifiedApprovedAccount,
} from '../support/backend'

/** Fills the four fields the Backend_Api's Complete rule requires beyond the core ones. */
async function completeMinimalProfile(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/candidate/profile')
  await page.locator('#full_name').fill('E2E Apply Candidate')
  await page.locator('#phone').fill('0501234571')
  await page.locator('#city').fill('Haifa')
  await page.getByTestId('profile-add-education').click()
  await page.locator('#education-0-institution').fill('Haifa University')
  await page.locator('#education-0-degree').fill('B.A.')
  await page.locator('#education-0-enrolment_status').click()
  await page.getByRole('option').first().click()
  await page.locator('#education-0-start_year').fill('2019')
  await page.getByTestId('profile-add-skills').click()
  await page.getByTestId('skill-term-skills.0.term').fill('Communication')
  await page.getByTestId('profile-save').click()
  await expect(page.getByTestId('profile-state')).toHaveAttribute('data-profile-state', 'Complete')
}

async function createCvVariant(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/candidate/cvs')
  await page.getByTestId('cv-variant-create-open').click()
  await page.getByTestId('cv-variant-create-name').fill('E2E Apply CV')
  await page.getByTestId('cv-variant-create-submit').click()
  await expect(page.getByTestId('cv-variant-list')).toBeVisible()
}

test.describe('job browse -> apply -> track', () => {
  test('a Candidate finds a published role, applies, and sees it in their own list', async ({
    page,
  }) => {
    const admin = await establishAdminSession()
    const senior = await registerVerifiedApprovedAccount(admin.access_token, 'SENIOR', 'jobs-senior')
    const seniorTokens = await login(senior.email, senior.password, 'SENIOR')
    const job = await createOpenJob(seniorTokens.access_token, { title: `E2E Apply Role ${Date.now()}` })

    const candidate = await registerVerifiedApprovedAccount(admin.access_token, 'CANDIDATE', 'jobs-candidate')

    await page.goto('/login')
    await page.locator('#login-email').fill(candidate.email)
    await page.locator('#login-password').fill(candidate.password)
    await page.locator('#login-role').selectOption('CANDIDATE')
    await page.getByTestId('login-submit').click()

    // Req 9 AC13 / Req 12 AC7: apply is gated on a Complete profile plus a
    // CV_Variant — both seeded here so this journey's own assertions are about
    // browsing and applying, not about profile/CV completion (see
    // `journeys/profile.spec.ts` and `journeys/cv.spec.ts` for those).
    await completeMinimalProfile(page)
    await createCvVariant(page)

    // Req 12 AC1-AC2: the published role is findable through the browse filters —
    // the free-text search narrows the list to the one role this test created.
    await page.goto('/jobs')
    await expect(page.getByTestId('jobs-browse-screen')).toBeVisible()
    await page.getByTestId('job-filter-search').fill(job.title)
    await page.getByTestId('job-filters-apply').click()

    const card = page.locator('[data-testid^="job-card-"]', { hasText: job.title })
    await expect(card).toBeVisible({ timeout: 15_000 })
    await card.getByRole('link').first().click()

    // Req 12 AC6: the detail view renders the role.
    await expect(page.getByTestId('job-detail-screen')).toBeVisible()
    await expect(page.getByTestId('job-detail-title')).toContainText(job.title)

    // Req 14 AC1-AC3: the apply control opens the dialog, a CV_Variant is
    // selected (defaulting to the only one), and submitting records the
    // Application.
    await page.getByTestId('job-apply').click()
    await expect(page.getByTestId('apply-dialog')).toBeVisible()
    await page.getByTestId('apply-submit').click()
    await expect(page.getByTestId('apply-recorded')).toBeVisible()
    await expect(page.getByTestId('apply-recorded-status')).toBeVisible()

    await page.getByTestId('apply-recorded-link').click()

    // Req 14 AC9: the Candidate's own Application list carries the submission.
    await expect(page.getByTestId('my-applications-screen')).toBeVisible()
    await expect(page.getByTestId('applications-list')).toContainText(job.title)
  })

  test('a Closed role disables the apply control in both the list and the detail view', async ({
    page,
  }) => {
    const admin = await establishAdminSession()
    const senior = await registerVerifiedApprovedAccount(admin.access_token, 'SENIOR', 'jobs-closed-senior')
    const seniorTokens = await login(senior.email, senior.password, 'SENIOR')
    const job = await createOpenJob(seniorTokens.access_token, {
      title: `E2E Closed Role ${Date.now()}`,
    })

    // Closes it directly against the Backend_Api — this journey's subject is the
    // Candidate-side rendering of a Closed role, not the Senior-side lifecycle
    // control itself (see the design's Requirement 13 coverage for that).
    await fetch(
      `${process.env.E2E_API_BASE_URL ?? 'http://localhost:8000/api/v1'}/jobs/${job.id}:close`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${seniorTokens.access_token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
    )

    const candidate = await registerVerifiedApprovedAccount(admin.access_token, 'CANDIDATE', 'jobs-closed-candidate')
    await page.goto('/login')
    await page.locator('#login-email').fill(candidate.email)
    await page.locator('#login-password').fill(candidate.password)
    await page.locator('#login-role').selectOption('CANDIDATE')
    await page.getByTestId('login-submit').click()

    await page.goto('/jobs')
    await page.getByTestId('job-filter-search').fill(job.title)
    await page.getByTestId('job-filters-apply').click()
    const card = page.locator('[data-testid^="job-card-"]', { hasText: job.title })
    await expect(card).toBeVisible({ timeout: 15_000 })
    // Req 12 AC7: the closed indicator and the disabled apply control, in the list.
    await expect(card.getByTestId('job-status-closed')).toBeVisible()

    await card.getByRole('link').first().click()
    await expect(page.getByTestId('job-detail-closed-notice')).toBeVisible()
    await expect(page.getByTestId('job-apply')).toBeDisabled()
  })
})
