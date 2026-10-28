/**
 * CV fixtures and the steps every journey that needs a CV shares.
 *
 * The Backend_Api opens every uploaded PDF with pikepdf before it accepts it
 * (backend R5, `cvs/service.py::_validate_pdf`), so a fixture must be a
 * structurally valid PDF, not just bytes that start with `%PDF`. An apply also
 * needs an *Available* version, one the worker's ClamAV scan has cleared
 * (backend `ProfileService` readiness, `has_any_version`).
 */

import { expect, type Locator, type Page } from '@playwright/test'

import { navigateInApp } from './navigation'

/**
 * A one-page, structurally valid PDF with a correct cross-reference table.
 *
 * `marker` goes in the document title, so each call can produce distinct bytes
 * (a distinct SHA-256). Keep it to letters, digits and dashes: it is written
 * into a PDF string literal unescaped.
 */
export function minimalPdf(marker: string): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
    `<< /Title (${marker}) >>`,
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(body, 'latin1')
  body +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 4 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

/**
 * The `<input type="file">` behind the CV upload's FileInput. Mantine puts the
 * `cv-version-file` test id on the button it renders, not on the input.
 */
export function cvFileInput(page: Page): Locator {
  return page.getByTestId('cv-version-upload').locator('input[type="file"]')
}

/**
 * How long a version may stay PendingScan. Well past the worker's own poll, to
 * absorb ClamAV's scan latency; a test calling this needs a longer timeout.
 */
export const CV_SCAN_TIMEOUT_MS = 120_000

/**
 * Creates a CV_Variant named `variantName` and uploads one PDF to it, then waits
 * for the scan to make that version Available. Leaves the page on the variant.
 */
export async function createVariantWithAvailableCv(page: Page, variantName: string): Promise<void> {
  await navigateInApp(page, '/candidate/cvs')
  await page.getByTestId('cv-variant-create-open').click()
  await page.getByTestId('cv-variant-create-name').fill(variantName)
  await page.getByTestId('cv-variant-create-submit').click()

  const card = page.locator('[data-testid^="variant-card-"]', { hasText: variantName })
  await card.getByRole('link').click()
  await expect(page.getByTestId('cv-variant-screen')).toBeVisible()

  await cvFileInput(page).setInputFiles({
    name: 'e2e-cv.pdf',
    mimeType: 'application/pdf',
    buffer: minimalPdf(`e2e-${Date.now()}`),
  })
  await page.getByTestId('cv-version-upload-submit').click()
  // The download control is enabled only for an Available version (Req 11
  // AC13), which holds in every locale; the state label itself is translated.
  await expect(page.getByTestId('cv-version-download-1')).toBeEnabled({
    timeout: CV_SCAN_TIMEOUT_MS,
  })
}
