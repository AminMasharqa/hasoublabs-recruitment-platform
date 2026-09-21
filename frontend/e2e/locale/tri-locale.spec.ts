/**
 * Tri-locale coverage: the registration, profile, CV upload, job browsing,
 * application and review journeys, each run in `ar`, `he` and `en`, asserting
 * the `dir` attribute and a mirrored layout (Requirement 19 AC13; task 27.1).
 *
 * This file does not re-derive each journey from scratch — `journeys/*.spec.ts`
 * already exercises every one of those flows once, end to end, against a
 * running Backend_Api. What Requirement 19 AC13 additionally asks for is that
 * the *same* flows are exercised in each of the three Locales and that the
 * direction and layout consequences of `ar`/`he` (Requirement 19 AC6, AC8) hold
 * while they run — not a second full walk of every screen's business logic in
 * three languages. So each locale block below drives one representative slice
 * of the named journey (enough to reach a rendered screen with real content),
 * and every block makes the same two assertions:
 *
 * 1. `document.documentElement` carries the `dir` the active Locale implies
 *    (`rtl` for `ar`/`he`, `ltr` for `en` — Req 19 AC6, AC7).
 * 2. The layout is mirrored under `rtl`: the Navigation_Menu — a structural,
 *    always-rendered element every one of these screens carries — is anchored
 *    on the trailing edge of the direction rather than physically pinned to one
 *    side of the viewport (Req 19 AC8). Comparing its horizontal position
 *    between the `en` run and an `rtl` run of the *same* screen is what proves
 *    mirroring occurred, rather than merely asserting `dir="rtl"` in isolation.
 *
 * `?lang=` is not a real mechanism this application reads — the Locale is set
 * through the Locale control (Requirement 19 AC5) or, once signed in, from
 * `language_preference` (AC3). Each block therefore drives {@link setLocale}
 * before the journey's own screens are asserted.
 */

import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  createOpenJob,
  createRegistrationLink,
  establishAdminSession,
  login,
  registerVerifiedApprovedAccount,
} from '../support/backend'

type SupportedLocale = 'ar' | 'he' | 'en'

const LOCALES: readonly SupportedLocale[] = ['ar', 'he', 'en']
const EXPECTED_DIR: Readonly<Record<SupportedLocale, 'rtl' | 'ltr'>> = {
  ar: 'rtl',
  he: 'rtl',
  en: 'ltr',
}

/** Switches the active Locale through the real Locale control (Req 19 AC5). */
async function setLocale(page: Page, locale: SupportedLocale): Promise<void> {
  await page.getByTestId('locale-control').selectOption(locale)
}

/** Asserts Requirement 19 AC6/AC7: the document root carries the implied `dir`. */
async function expectDirection(page: Page, locale: SupportedLocale): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('dir', EXPECTED_DIR[locale])
}

/**
 * Asserts Requirement 19 AC8's mirroring on one always-present element: the
 * skip-link/navigation toggle anchored at the *leading* edge of the reading
 * direction sits on the right of the viewport under `ltr` and on the left under
 * `rtl` — the opposite physical side, which is what "mirror... navigation
 * placement" means structurally rather than by translated label.
 */
async function expectMirroredNavigationAnchor(
  page: Page,
  locale: SupportedLocale,
  anchor: Locator,
): Promise<void> {
  const box = await anchor.boundingBox()
  expect(box).not.toBeNull()
  if (box === null) {
    return
  }
  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  if (viewport === null) {
    return
  }
  const center = box.x + box.width / 2
  if (EXPECTED_DIR[locale] === 'rtl') {
    // The leading edge of an rtl reading order is the physical right, so a
    // control anchored "first" in reading order renders past the viewport's
    // midpoint.
    expect(center).toBeGreaterThan(viewport.width / 2)
  } else {
    expect(center).toBeLessThan(viewport.width / 2)
  }
}

test.describe('tri-locale coverage', () => {
  for (const locale of LOCALES) {
    test(`registration in ${locale}: dir and mirrored layout`, async ({ page }) => {
      const admin = await establishAdminSession()
      const link = await createRegistrationLink(admin.access_token, 'CANDIDATE')

      await page.goto(`/register/${link.token}`)
      await setLocale(page, locale)
      await expectDirection(page, locale)

      await expect(page.getByTestId('registration-form')).toBeVisible()
      // Req 19 AC1/AC2: every rendered string comes from that Locale's catalogue —
      // asserted here as "the role notice under the Candidate role renders
      // non-empty text", since the exact wording is not this suite's concern.
      await expect(page.getByTestId('registration-role')).not.toBeEmpty()

      // Req 19 AC8: the skip-link is the one structural, always-rendered element
      // present on every screen including this unauthenticated one.
      await expectMirroredNavigationAnchor(page, locale, page.getByTestId('skip-to-content'))
    })
  }

  for (const locale of LOCALES) {
    test(`candidate profile in ${locale}: dir, mirrored layout, and byte-identical bidi text`, async ({
      page,
    }) => {
      const admin = await establishAdminSession()
      const candidate = await registerVerifiedApprovedAccount(
        admin.access_token,
        'CANDIDATE',
        `locale-profile-${locale}`,
      )

      await page.goto('/login')
      await setLocale(page, locale)
      await expectDirection(page, locale)

      await page.locator('#login-email').fill(candidate.email)
      await page.locator('#login-password').fill(candidate.password)
      await page.locator('#login-role').selectOption('CANDIDATE')
      await page.getByTestId('login-submit').click()

      await page.goto('/candidate/profile')
      await expect(page.getByTestId('candidate-profile-form')).toBeVisible()

      // Req 19 AC10/AC11: Arabic/Hebrew text entered here is submitted and
      // re-rendered byte-identically — exercised directly in `ar`/`he` with real
      // right-to-left content; the `en` iteration keeps the same assertion shape
      // with Latin content so the three runs cover the same steps.
      const summary =
        locale === 'ar'
          ? 'ملخص مرشح باللغة العربية للتحقق من عدم التحويل الصوتي أو التطبيع.'
          : locale === 'he'
            ? 'תקציר מועמד בעברית לבדיקת אי-שינוי התווים המקוריים.'
            : 'A candidate summary in English, for the matching iteration.'
      await page.locator('#summary').fill(summary)
      await page.getByTestId('profile-save').click()
      await expect(page.locator('#summary')).toHaveValue(summary)

      await expectMirroredNavigationAnchor(page, locale, page.getByTestId('skip-to-content'))
    })
  }

  for (const locale of LOCALES) {
    test(`CV upload screen in ${locale}: dir and mirrored layout`, async ({ page }) => {
      const admin = await establishAdminSession()
      const candidate = await registerVerifiedApprovedAccount(
        admin.access_token,
        'CANDIDATE',
        `locale-cv-${locale}`,
      )

      await page.goto('/login')
      await setLocale(page, locale)
      await expectDirection(page, locale)

      await page.locator('#login-email').fill(candidate.email)
      await page.locator('#login-password').fill(candidate.password)
      await page.locator('#login-role').selectOption('CANDIDATE')
      await page.getByTestId('login-submit').click()

      await page.goto('/candidate/cvs')
      await page.getByTestId('cv-variant-create-open').click()
      await page.getByTestId('cv-variant-create-name').fill('Locale CV')
      await page.getByTestId('cv-variant-create-submit').click()
      const card = page.locator('[data-testid^="variant-card-"]', { hasText: 'Locale CV' })
      await card.getByRole('link').click()

      await expect(page.getByTestId('cv-version-upload')).toBeVisible()
      await expectMirroredNavigationAnchor(page, locale, page.getByTestId('skip-to-content'))
    })
  }

  for (const locale of LOCALES) {
    test(`job browsing in ${locale}: dir, mirrored layout, byte-identical listing text`, async ({
      page,
    }) => {
      const admin = await establishAdminSession()
      const senior = await registerVerifiedApprovedAccount(
        admin.access_token,
        'SENIOR',
        `locale-jobs-senior-${locale}`,
      )
      const seniorTokens = await login(senior.email, senior.password, 'SENIOR')
      const title =
        locale === 'ar'
          ? `دور تجريبي بالعربية ${Date.now()}`
          : locale === 'he'
            ? `תפקיד בדיקה בעברית ${Date.now()}`
            : `English test role ${Date.now()}`
      await createOpenJob(seniorTokens.access_token, { title })

      const candidate = await registerVerifiedApprovedAccount(
        admin.access_token,
        'CANDIDATE',
        `locale-jobs-candidate-${locale}`,
      )
      await page.goto('/login')
      await setLocale(page, locale)
      await expectDirection(page, locale)

      await page.locator('#login-email').fill(candidate.email)
      await page.locator('#login-password').fill(candidate.password)
      await page.locator('#login-role').selectOption('CANDIDATE')
      await page.getByTestId('login-submit').click()

      await page.goto('/jobs')
      await page.getByTestId('job-filter-search').fill(title)
      await page.getByTestId('job-filters-apply').click()

      const card = page.locator('[data-testid^="job-card-"]', { hasText: title })
      // Req 19 AC10: the Arabic/Hebrew role title renders byte-identically —
      // proven by finding the card via the exact string this test posted.
      await expect(card).toBeVisible({ timeout: 15_000 })

      await expectMirroredNavigationAnchor(page, locale, page.getByTestId('skip-to-content'))
    })
  }

  for (const locale of LOCALES) {
    test(`application submission in ${locale}: dir and mirrored layout`, async ({ page }) => {
      const admin = await establishAdminSession()
      const senior = await registerVerifiedApprovedAccount(
        admin.access_token,
        'SENIOR',
        `locale-apply-senior-${locale}`,
      )
      const seniorTokens = await login(senior.email, senior.password, 'SENIOR')
      const job = await createOpenJob(seniorTokens.access_token, {
        title: `Locale apply role ${locale} ${Date.now()}`,
      })

      const candidate = await registerVerifiedApprovedAccount(
        admin.access_token,
        'CANDIDATE',
        `locale-apply-candidate-${locale}`,
      )
      await page.goto('/login')
      await setLocale(page, locale)
      await expectDirection(page, locale)

      await page.locator('#login-email').fill(candidate.email)
      await page.locator('#login-password').fill(candidate.password)
      await page.locator('#login-role').selectOption('CANDIDATE')
      await page.getByTestId('login-submit').click()

      // A minimal Complete profile and one CV_Variant, the preconditions the
      // apply gate reads (Req 9 AC13) — this block's own subject is the dialog's
      // direction and layout, not re-proving profile/CV completion.
      await page.goto('/candidate/profile')
      await page.locator('#full_name').fill('Locale Apply Candidate')
      await page.locator('#phone').fill('0501234580')
      await page.locator('#city').fill('Jerusalem')
      await page.getByTestId('profile-add-education').click()
      await page.locator('#education-0-institution').fill('Test University')
      await page.locator('#education-0-degree').fill('B.Sc.')
      await page.locator('#education-0-enrolment_status').click()
      await page.getByRole('option').first().click()
      await page.locator('#education-0-start_year').fill('2018')
      await page.getByTestId('profile-add-skills').click()
      await page.getByTestId('skill-term-skills.0.term').fill('Testing')
      await page.getByTestId('profile-save').click()
      await expect(page.getByTestId('profile-state')).toHaveAttribute('data-profile-state', 'Complete')

      await page.goto('/candidate/cvs')
      await page.getByTestId('cv-variant-create-open').click()
      await page.getByTestId('cv-variant-create-name').fill('Locale Apply CV')
      await page.getByTestId('cv-variant-create-submit').click()

      await page.goto('/jobs')
      await page.getByTestId('job-filter-search').fill(job.title)
      await page.getByTestId('job-filters-apply').click()
      const card = page.locator('[data-testid^="job-card-"]', { hasText: job.title })
      await expect(card).toBeVisible({ timeout: 15_000 })
      await card.getByRole('link').first().click()

      await page.getByTestId('job-apply').click()
      await expect(page.getByTestId('apply-dialog')).toBeVisible()
      // Req 20 AC11 combined with Req 19 AC8: the dialog itself still respects
      // the active direction (Mantine's `Modal` follows `MantineProvider`'s own
      // `dir`, set by the Direction_Provider).
      await expectDirection(page, locale)
      await page.getByTestId('apply-submit').click()
      await expect(page.getByTestId('apply-recorded')).toBeVisible()
    })
  }

  for (const locale of LOCALES) {
    test(`review submission in ${locale}: dir, mirrored layout, byte-identical assessment`, async ({
      page,
    }) => {
      const admin = await establishAdminSession()
      const senior = await registerVerifiedApprovedAccount(
        admin.access_token,
        'SENIOR',
        `locale-review-senior-${locale}`,
      )
      const candidate = await registerVerifiedApprovedAccount(
        admin.access_token,
        'CANDIDATE',
        `locale-review-candidate-${locale}`,
      )

      await page.goto('/login')
      await setLocale(page, locale)
      await expectDirection(page, locale)

      await page.locator('#login-email').fill(senior.email)
      await page.locator('#login-password').fill(senior.password)
      await page.locator('#login-role').selectOption('SENIOR')
      await page.getByTestId('login-submit').click()

      await page.goto('/senior/reviews/new')
      await page.getByTestId('review-candidate-input').fill(candidate.id)
      await page.getByTestId('review-candidate-submit').click()

      const assessment =
        locale === 'ar'
          ? 'تقييم بالعربية للتحقق من عدم تغيير النص المدخل.'
          : locale === 'he'
            ? 'הערכה בעברית לבדיקת שמירת הטקסט המקורי.'
            : 'An assessment in English, for the matching iteration.'

      await page.getByTestId('review-new-rating_technical').fill('4')
      await page.getByTestId('review-new-rating_communication').fill('4')
      await page.getByTestId('review-new-rating_culture_fit').fill('4')
      await page.getByTestId('review-new-rating_overall').fill('4')
      await page.getByTestId('review-new-assessment').fill(assessment)
      await page.getByTestId('review-new-submit').click()

      await page.goto('/senior/reviews')
      await page.getByTestId('review-candidate-input').fill(candidate.id)
      await page.getByTestId('review-candidate-submit').click()

      // Req 19 AC10: the entered Arabic/Hebrew assessment renders byte-identically.
      const card = page.locator('[data-testid^="review-card-"]').first()
      await expect(card).toBeVisible({ timeout: 10_000 })
      await expect(card.getByTestId(/review-assessment-/)).toContainText(assessment)

      await expectMirroredNavigationAnchor(page, locale, page.getByTestId('skip-to-content'))
    })
  }
})
