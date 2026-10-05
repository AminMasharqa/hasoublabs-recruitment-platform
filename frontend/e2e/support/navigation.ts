/**
 * In-app navigation for journeys that are already signed in.
 *
 * The Session_Manager holds the session in memory only, so a page reload
 * starts with no session (Requirement 4 AC3, AC11). `page.goto` *is* a page
 * load: called after a UI sign-in it discards the session, and the Route_Guard
 * sends the browser back to `/login`. That is the app working as specified, so
 * a journey that wants to move between screens while staying signed in has to
 * navigate the way the application itself does — through the router.
 *
 * {@link navigateInApp} pushes the target onto the browser history and fires
 * `popstate`, which the data router (`createBrowserRouter`) handles exactly as
 * it handles Back/Forward: a client-side navigation through the same
 * Route_Guard, with no reload. Use `page.goto` only where a fresh page load is
 * the point — `/login`, a Registration_Link, or asserting that a reload signs
 * the user out.
 */

import type { Page } from '@playwright/test'

/** Navigates to `path` (pathname plus optional query) without reloading the page. */
export async function navigateInApp(page: Page, path: string): Promise<void> {
  // A UI sign-in completes asynchronously. Navigating before it has left
  // `/login` would race the session being established, so wait for that first.
  if (new URL(page.url()).pathname.startsWith('/login')) {
    await page.waitForURL((url) => !url.pathname.startsWith('/login'))
  }
  await page.evaluate((target) => {
    window.history.pushState(null, '', target)
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  }, path)
}
