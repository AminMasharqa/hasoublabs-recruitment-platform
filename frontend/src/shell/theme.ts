/**
 * The shared Mantine theme (Requirement 1 AC2, Requirement 20 AC1, AC4).
 *
 * One theme object, passed to the single `MantineProvider` in `AppShell.tsx`, so
 * every interface primitive in the application resolves the same tokens. Nothing
 * here is decorative: each setting exists because a requirement or an existing
 * module depends on it.
 *
 * - `respectReducedMotion` makes Mantine emit its transitions behind
 *   `prefers-reduced-motion: reduce`, which is how `LoadingState` in
 *   `errors/ErrorPresenter.tsx` honours Requirement 20 AC12 "through the shared
 *   theme" rather than by hand-rolling a media query per component.
 * - The font stack names Arabic and Hebrew faces explicitly after the system UI
 *   font, so an `ar`/`he` locale renders in a face that actually has the glyphs
 *   instead of falling back per-platform (Requirement 19 AC1).
 * - Direction is deliberately *not* set here. `i18n/DirectionProvider.tsx` owns
 *   it and pushes it into Mantine's own `DirectionProvider`, which is the single
 *   source of truth for `dir` (Requirement 19 AC6, AC7).
 * - `primaryShade` and the `gray` override exist for Requirement 20 AC4: Mantine's
 *   own defaults (`blue.6` filled on white, `gray.6` for `Text c="dimmed"`) fall
 *   short of the 4.5:1 text contrast ratio the requirement demands — the
 *   accessibility gate of task 26.3 caught both across nearly every screen, since
 *   `c="dimmed"` and the default filled `Button`/`Badge`/link color are used
 *   throughout the shell and every feature slice. Both are corrected at the
 *   token level rather than per component, so no caller has to remember a
 *   contrast rule when it reaches for the ordinary "dimmed text" or "primary
 *   button" token.
 *
 * Spacing and radius are left at Mantine's defaults until a design decision needs
 * otherwise; the full accessibility pass is task 26.1, of which this contrast
 * correction is a part.
 */

import { createTheme, type MantineThemeOverride } from '@mantine/core'

/**
 * Mantine's own `gray` scale, shade 6 replaced with a darker value.
 *
 * `Text c="dimmed"` resolves to `gray.6` in the light scheme, and Mantine's own
 * `gray.6` (`#868e96`) reaches only 3.32:1 against a white background — short of
 * the 4.5:1 Requirement 20 AC4 asks of ordinary text. Every other shade is
 * Mantine's own `open-color` gray value, unchanged; only the one shade the
 * "dimmed" token reads is corrected. `gray.7` (`#495057`) is 8.18:1 against white,
 * comfortably clearing the ratio with margin for the range of backgrounds the
 * dimmed token is used against.
 */
const ACCESSIBLE_GRAY: MantineThemeOverride['colors'] = {
  gray: [
    '#f8f9fa',
    '#f1f3f5',
    '#e9ecef',
    '#dee2e6',
    '#ced4da',
    '#adb5bd',
    '#495057',
    '#495057',
    '#343a40',
    '#212529',
  ],
}

/**
 * Font stack for every locale the Web_Client supports.
 *
 * The system UI font first, then the Noto Arabic/Hebrew faces as a named
 * fallback for platforms whose UI font lacks those scripts, then a generic.
 */
export const APP_FONT_FAMILY =
  'system-ui, "Segoe UI", Roboto, "Noto Sans Arabic", "Noto Sans Hebrew", Arial, sans-serif'

/** The monospace stack used for Support_References, tokens and identifiers. */
export const APP_MONOSPACE_FONT_FAMILY = 'ui-monospace, SFMono-Regular, Consolas, monospace'

/** The single Mantine theme of the application. */
export const appTheme: MantineThemeOverride = createTheme({
  // Requirement 20 AC12: suppress non-essential motion when the operating system
  // asks for it. Mantine applies this to its own transitions and to `Loader`.
  respectReducedMotion: true,
  fontFamily: APP_FONT_FAMILY,
  fontFamilyMonospace: APP_MONOSPACE_FONT_FAMILY,
  headings: { fontFamily: APP_FONT_FAMILY },
  defaultRadius: 'sm',
  colors: ACCESSIBLE_GRAY,
  // Requirement 20 AC4: shade 6 (Mantine's default for a filled variant) is
  // `blue.6` (`#228be6`), 3.55:1 against white — below the 4.5:1 text ratio.
  // Shade 8 (`#1971c2`) is 5.02:1, which is what every filled `Button`, active
  // `NavLink` and similar primary-color surface renders with white text on top
  // of instead.
  primaryShade: 8,
})
