/**
 * Journey: CV upload and download, against a running Backend_Api (task 27.1;
 * Requirement 1 AC12).
 *
 * Requirement 11: create a CV_Variant (AC2), upload a CV_Version to it (AC8–AC11),
 * wait out the ClamAV scan the Backend_Api runs before the version leaves
 * `PendingScan` (AC12), then download it (AC16) and check the delivered bytes
 * match what was uploaded, under its original filename.
 *
 * The scan is the one step in this journey this suite does not control — see
 * `e2e/README.md` on ClamAV's own startup time. The wait below polls the
 * version's own rendered state rather than a fixed sleep, so the journey takes
 * only as long as the scan actually does.
 */

import { createHash } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { establishAdminSession, registerVerifiedApprovedAccount } from '../support/backend'

test.describe('CV upload and download', () => {
  test('an uploaded CV becomes downloadable once scanned, under its original filename', async ({
    page,
  }) => {
    const admin = await establishAdminSession()
    const candidate = await registerVerifiedApprovedAccount(admin.access_token, 'CANDIDATE', 'cv')

    await page.goto('/login')
    await page.locator('#login-email').fill(candidate.email)
    await page.locator('#login-password').fill(candidate.password)
    await page.locator('#login-role').selectOption('CANDIDATE')
    await page.getByTestId('login-submit').click()

    // Req 11 AC2: create a CV_Variant.
    await page.goto('/candidate/cvs')
    await expect(page.getByTestId('cv-variants-screen')).toBeVisible()
    await page.getByTestId('cv-variant-create-open').click()
    await page.getByTestId('cv-variant-create-name').fill('E2E Primary CV')
    await page.getByTestId('cv-variant-create-submit').click()

    await expect(page.getByTestId('cv-variant-list')).toBeVisible()
    // The card names the variant; its own "manage versions" link opens the
    // single-variant screen this journey continues on.
    const card = page.locator('[data-testid^="variant-card-"]', { hasText: 'E2E Primary CV' })
    await card.getByRole('link').click()
    await expect(page.getByTestId('cv-variant-screen')).toBeVisible()

    // Req 11 AC8-AC10: a real PDF-shaped file, uploaded through the real file
    // input and multipart request.
    const fileName = 'e2e-primary-cv.pdf'
    const fileContent = Buffer.from(
      `%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\ne2e-marker-${Date.now()}`,
    )
    await page.locator('#cv-version-file').setInputFiles({
      name: fileName,
      mimeType: 'application/pdf',
      buffer: fileContent,
    })
    await page.getByTestId('cv-version-upload-submit').click()

    // Req 11 AC11: the 202 renders the scan-pending notice.
    await expect(page.getByTestId('cv-version-upload-accepted')).toBeVisible()

    // Req 11 AC12: the version starts PendingScan and the list polls it, capped
    // well past the Backend_Api's own 10-second poll interval to absorb ClamAV's
    // own scan latency (see the module doc on cold-start definitions).
    const versionState = page.getByTestId('cv-version-state-1')
    await expect(versionState).not.toHaveText(/Pending/i, { timeout: 120_000 })

    // Req 11 AC16: an Available version downloads under its original filename
    // with the bytes that were uploaded.
    await expect(versionState).toHaveText(/Available/i)
    const downloadPromise = page.waitForEvent('download')
    await page.getByTestId('cv-version-download-1').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe(fileName)

    const downloadedPath = await download.path()
    expect(downloadedPath).not.toBeNull()
    if (downloadedPath !== null) {
      const downloadedBytes = await import('node:fs/promises').then((fs) => fs.readFile(downloadedPath))
      expect(createHash('sha256').update(downloadedBytes).digest('hex')).toBe(
        createHash('sha256').update(fileContent).digest('hex'),
      )
    }
  })

  test('a PendingScan or Quarantined version disables its download control with a stated reason', async ({
    page,
  }) => {
    const admin = await establishAdminSession()
    const candidate = await registerVerifiedApprovedAccount(admin.access_token, 'CANDIDATE', 'cv-pending')

    await page.goto('/login')
    await page.locator('#login-email').fill(candidate.email)
    await page.locator('#login-password').fill(candidate.password)
    await page.locator('#login-role').selectOption('CANDIDATE')
    await page.getByTestId('login-submit').click()

    await page.goto('/candidate/cvs')
    await page.getByTestId('cv-variant-create-open').click()
    await page.getByTestId('cv-variant-create-name').fill('E2E Pending CV')
    await page.getByTestId('cv-variant-create-submit').click()
    const card = page.locator('[data-testid^="variant-card-"]', { hasText: 'E2E Pending CV' })
    await card.getByRole('link').click()

    await page.locator('#cv-version-file').setInputFiles({
      name: 'e2e-pending-cv.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
    })
    await page.getByTestId('cv-version-upload-submit').click()

    // Req 11 AC13: disabled immediately, before the scan has had any chance to
    // resolve — this assertion does not wait for the poll.
    await expect(page.getByTestId('cv-version-download-1')).toBeDisabled()
    await expect(page.getByTestId('cv-version-download-reason-1')).toBeVisible()
  })
})
