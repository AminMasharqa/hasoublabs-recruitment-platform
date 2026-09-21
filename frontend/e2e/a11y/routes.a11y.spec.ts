/**
 * The accessibility gate: `@axe-core/playwright` run over every rendered route
 * (Requirement 20 AC13).
 *
 * `npm run test:a11y` (`playwright test --grep "@a11y"`, task 1.2) selects this
 * file by its `@a11y` tag and nothing else, so the gate stays separable from the
 * broader `test:e2e` journey suite of task 27 while sharing the same
 * `playwright.config.ts` — the same served bundle, the same browser project.
 *
 * ## What "every rendered route" means here
 *
 * {@link scannedRoutes} enumerates the route catalogue from the single source of
 * truth the router itself is built from (`src/routing/paths.ts`,
 * `src/routing/routes.tsx`): every public path, the onboarding group, and every
 * feature group once for each identity whose role set and Active_Context the
 * group's own `RouteAccess` admits. That is what makes this "every route", not
 * "every route someone remembered to add here" — a new route or a widened
 * `RouteAccess` changes what this list contains without this file changing.
 *
 * ## Why a mocked Backend_Api rather than a running one
 *
 * Task 27 (not yet built) is where end-to-end journeys run against a running
 * Backend_Api. This gate has no journey to complete — it needs every screen to
 * *render*, once, in a state free of Level AA violations — so
 * {@link installMockBackend} answers every `/api/v1/**` call generically (see
 * that module's own note) rather than requiring a seeded database and a live
 * server in every environment this gate runs in, including this one.
 *
 * ## What axe checks, and what it cannot
 *
 * `AxeBuilder` is configured to the `wcag2a` and `wcag2aa` rule sets only — the
 * Level A and Level AA success criteria Requirement 20 AC1 asks for, not the
 * stricter `wcag2aaa` rules axe-core also knows about. A route with any
 * violation fails the assertion, and the failure message serializes every
 * violation axe found — the rule id, the impact and every affected node — so a
 * failure is diagnosable from the CI log alone.
 *
 * Automated scanning is necessarily partial: axe-core can detect missing labels,
 * insufficient contrast, malformed landmarks and the like, but it cannot judge
 * keyboard operability, focus order, reduced motion or the meaningfulness of a
 * text alternative — that is what the component tests of task 26.2 (focus traps,
 * focus indicators, label association, reduced motion) and a manual pass with
 * assistive technology are for. Full WCAG 2.1 AA conformance is not established
 * by this file alone.
 */

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { installMockBackend } from './mockBackend'
import { scannedRoutes, type ScannedRoute } from './routeCatalogue'

/** The rule sets Requirement 20 AC1/AC13 gate on: WCAG 2.1 Level A and Level AA. */
const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const

/**
 * Signs the page in as `route.identity` through the real login form.
 *
 * Driven through the UI rather than by injecting a token directly, so the scan
 * exercises the same login screen every other visitor reaches — and so a
 * regression that breaks sign-in itself fails this gate too, on every
 * authenticated route, instead of being silently bypassed by a shortcut.
 */
async function signIn(page: Page, route: ScannedRoute): Promise<void> {
  const { identity } = route
  if (identity === null) {
    return
  }
  await page.goto('/login')
  // By the stable input ids `LOGIN_INPUT_ID_PREFIX` mints (`src/features/auth/loginForm.ts`)
  // rather than by accessible name: the password input's accessible name also
  // matches the "Toggle password visibility" button Mantine renders beside it,
  // which makes an accessible-name locator ambiguous under Playwright's strict
  // mode even though it is exactly the kind of text alternative Requirement 20
  // AC8 asks that control to carry.
  await page.locator('#login-email').fill(identity.email)
  await page.locator('#login-password').fill(identity.password)
  await page.locator('#login-role').selectOption(identity.loginRole)
  await page.getByTestId('login-submit').click()
  // The post-login navigation is asynchronous (token decode, then the redirect);
  // waiting for the login form to disengage is enough to know the attempt
  // resolved one way or the other before the scan navigates on.
  await expect(page.getByTestId('login-screen')).toBeHidden({ timeout: 15_000 })
}

for (const route of scannedRoutes()) {
  test(`@a11y ${route.id} (${route.path}) has no WCAG 2.1 AA violations`, async ({ page }) => {
    await installMockBackend(page, { accountStatus: route.accountStatus })
    await signIn(page, route)

    await page.goto(route.path)
    // Every scanned route renders through the RecoveryBoundary and the router;
    // waiting for the network to settle lets a route's own reads (answered
    // instantly by the mock backend) resolve into their loaded/empty state before
    // the snapshot axe scans is taken (Requirement 21 AC6, AC7).
    await page.waitForLoadState('networkidle')

    const results = await new AxeBuilder({ page }).withTags([...WCAG_AA_TAGS]).analyze()

    expect(
      results.violations,
      `${route.path} (${route.identity?.id ?? 'unauthenticated'}):\n${JSON.stringify(
        results.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          nodes: violation.nodes.map((node) => node.target),
        })),
        null,
        2,
      )}`,
    ).toEqual([])
  })
}
