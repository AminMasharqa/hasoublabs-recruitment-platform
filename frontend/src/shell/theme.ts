/**
 * The shared Mantine theme (Requirement 1 AC2, Requirement 20 AC1, AC4), styled
 * after Microsoft Fluent 2.
 *
 * One theme object, passed to the single `MantineProvider` in `AppShell.tsx`, so
 * every interface primitive in the application resolves the same tokens. The
 * Fluent values themselves live in `fluentTokens.ts`; this module maps them onto
 * Mantine's own token slots (colours, radius, shadows, spacing, type ramp) and,
 * through `appCssVariablesResolver`, onto the few `--app-*` variables Mantine has
 * no slot for (canvas, accessible stroke, focus stroke, elevation, motion). There
 * is no second theme system: a component reaches a Fluent value only through a
 * Mantine token or one of those variables.
 *
 * - `respectReducedMotion` makes Mantine emit its transitions behind
 *   `prefers-reduced-motion: reduce`, which is how `LoadingState` in
 *   `errors/ErrorPresenter.tsx` honours Requirement 20 AC12 "through the shared
 *   theme" rather than by hand-rolling a media query per component.
 * - The font stack leads with Segoe UI (Fluent's face), then the system UI font,
 *   then names Arabic and Hebrew faces explicitly, so an `ar`/`he` locale renders
 *   in a face that actually has the glyphs (Requirement 19 AC1).
 * - Direction is deliberately *not* set here. `i18n/DirectionProvider.tsx` owns
 *   it and pushes it into Mantine's own `DirectionProvider`, which is the single
 *   source of truth for `dir` (Requirement 19 AC6, AC7).
 * - Contrast (Requirement 20 AC4) is corrected at the token level, never per
 *   component: each Fluent ramp is chosen so the shades Mantine renders — shade 7
 *   for the light filled/text colour, shade 8 for the dark filled colour, shade 4
 *   for dark-scheme text — clear 4.5:1 (see `fluentTokens.ts`). `c="dimmed"`
 *   resolves to `gray.6` (`#616161`, 6.1:1 on white) in light and `dark.2`
 *   (`#adadad`, 6.4:1 on `#292929`) in dark.
 *
 * ## Semantic colours
 *
 * Feature code names a colour by what it means, not by its hue:
 *
 * | Name      | Meaning                                   | Fluent family |
 * |-----------|-------------------------------------------|---------------|
 * | `brand`   | primary actions, links, selection         | brand blue    |
 * | `info`    | neutral information, "primary" markers    | brand blue    |
 * | `success` | done, approved, available, verified       | green         |
 * | `warning` | pending, incomplete, needs attention      | marigold      |
 * | `severe`  | suspended, blocked, out of range          | dark orange   |
 * | `danger`  | rejected, failed, destructive             | red           |
 * | `neutral` | inactive, archived, closed-but-not-failed | grey          |
 *
 * Mantine's own hue names (`red`, `green`, `blue`, ...) are re-pointed at the same
 * ramps so a Mantine internal that reads them (input error, `Loader`) stays on
 * palette; feature code should not use them.
 */

import {
  createTheme,
  type CSSVariablesResolver,
  type MantineColorsTuple,
  type MantineThemeOverride,
  rem,
} from '@mantine/core'

import {
  FLUENT_BRAND,
  FLUENT_DANGER,
  FLUENT_DARK,
  FLUENT_MOTION,
  FLUENT_NEUTRAL,
  FLUENT_NEUTRALS,
  FLUENT_SEVERE,
  FLUENT_SHADOWS,
  FLUENT_SUCCESS,
  FLUENT_WARNING,
} from './fluentTokens'

/** The semantic colour names feature code uses; see the module note. */
export type SemanticColor = 'brand' | 'info' | 'success' | 'warning' | 'severe' | 'danger' | 'neutral'

const tuple = (ramp: readonly string[]): MantineColorsTuple => ramp as unknown as MantineColorsTuple

const COLORS: MantineThemeOverride['colors'] = {
  // Semantic names (the ones feature code uses).
  brand: tuple(FLUENT_BRAND),
  info: tuple(FLUENT_BRAND),
  success: tuple(FLUENT_SUCCESS),
  warning: tuple(FLUENT_WARNING),
  severe: tuple(FLUENT_SEVERE),
  danger: tuple(FLUENT_DANGER),
  neutral: tuple(FLUENT_NEUTRAL),
  // Mantine's scheme ramps: `gray` drives light neutrals, `dark` the dark scheme.
  gray: tuple(FLUENT_NEUTRAL),
  dark: tuple(FLUENT_DARK),
  // Mantine's hue names, re-pointed so library internals stay on palette.
  blue: tuple(FLUENT_BRAND),
  red: tuple(FLUENT_DANGER),
  green: tuple(FLUENT_SUCCESS),
  teal: tuple(FLUENT_SUCCESS),
  yellow: tuple(FLUENT_WARNING),
  orange: tuple(FLUENT_SEVERE),
}

/**
 * Font stack for every locale the Web_Client supports.
 *
 * Fluent's Segoe UI first (it carries Arabic and Hebrew on Windows), then the
 * platform UI fonts, then the Noto Arabic/Hebrew faces as a named fallback for
 * platforms whose UI font lacks those scripts, then a generic.
 */
export const APP_FONT_FAMILY =
  '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, Roboto, "Noto Sans Arabic", "Noto Sans Hebrew", "Helvetica Neue", Arial, sans-serif'

/** The monospace stack used for Support_References, tokens and identifiers. */
export const APP_MONOSPACE_FONT_FAMILY = 'ui-monospace, "Cascadia Mono", SFMono-Regular, Consolas, monospace'

/** The single Mantine theme of the application. */
export const appTheme: MantineThemeOverride = createTheme({
  // Requirement 20 AC12: suppress non-essential motion when the operating system
  // asks for it. Mantine applies this to its own transitions and to `Loader`.
  respectReducedMotion: true,

  // Fluent pressed states darken the fill; they never nudge the control, so
  // Mantine's `translateY(1px)` active class is switched off.
  activeClassName: '',

  colors: COLORS,
  primaryColor: 'brand',
  // Requirement 20 AC4: brand 80 (`#0f6cbd`, 5.4:1 with white) in light, brand 70
  // (`#115ea3`) in dark — Fluent's own rest fills for each scheme.
  primaryShade: { light: 7, dark: 8 },

  fontFamily: APP_FONT_FAMILY,
  fontFamilyMonospace: APP_MONOSPACE_FONT_FAMILY,
  // Fluent type ramp: Caption1, Body1, Body2, Subtitle1, Title3.
  fontSizes: { xs: rem(12), sm: rem(14), md: rem(16), lg: rem(20), xl: rem(24) },
  lineHeights: { xs: '1.34', sm: '1.43', md: '1.5', lg: '1.4', xl: '1.34' },
  headings: {
    fontFamily: APP_FONT_FAMILY,
    fontWeight: '600',
    sizes: {
      h1: { fontSize: rem(32), lineHeight: '1.25' }, // Title1 32/40
      h2: { fontSize: rem(28), lineHeight: '1.29' }, // Title2 28/36
      h3: { fontSize: rem(24), lineHeight: '1.34' }, // Title3 24/32
      h4: { fontSize: rem(20), lineHeight: '1.4' }, // Subtitle1 20/28
      h5: { fontSize: rem(16), lineHeight: '1.38' }, // Subtitle2 16/22
      h6: { fontSize: rem(14), lineHeight: '1.43' }, // Body1Strong 14/20
    },
  },

  // Fluent spacing on the 4px grid: S, M, L, XXL, XXXL.
  spacing: { xs: rem(8), sm: rem(12), md: rem(16), lg: rem(24), xl: rem(32) },

  // Fluent corner radii: Small 2, Medium 4 (controls), Large 6, XLarge 8
  // (cards, dialogs), 2XLarge 12. `sm` stays the default, as it was.
  radius: { xs: rem(2), sm: rem(4), md: rem(6), lg: rem(8), xl: rem(12) },
  defaultRadius: 'sm',

  // Fluent elevation, resolved per colour scheme by `appCssVariablesResolver`.
  shadows: {
    xs: 'var(--app-shadow-2)',
    sm: 'var(--app-shadow-4)',
    md: 'var(--app-shadow-8)',
    lg: 'var(--app-shadow-16)',
    xl: 'var(--app-shadow-64)',
  },

  components: {
    Paper: { defaultProps: { radius: 'lg', shadow: 'xs' } },
    Card: { defaultProps: { radius: 'lg', shadow: 'xs', withBorder: true } },
    Modal: {
      defaultProps: { radius: 'lg', shadow: 'xl', overlayProps: { backgroundOpacity: 0.4 } },
    },
    Badge: {
      // Fluent badges are pill-shaped and sentence case.
      defaultProps: { radius: 'xl' },
      styles: { root: { textTransform: 'none', fontWeight: 600 } },
    },
    Alert: { defaultProps: { radius: 'sm' } },
    Tooltip: { defaultProps: { radius: 'sm' } },
    NavLink: { styles: { label: { fontSize: 'var(--mantine-font-size-sm)' } } },
  },
})

/**
 * CSS variables for the Fluent tokens Mantine has no slot for, plus the few
 * Mantine semantic variables whose defaults read the wrong shade of a ramp.
 * Passed to the `MantineProvider` beside `appTheme`.
 */
export const appCssVariablesResolver: CSSVariablesResolver = (theme) => ({
  variables: {
    '--app-duration-faster': FLUENT_MOTION.durationFaster,
    '--app-duration-normal': FLUENT_MOTION.durationNormal,
    '--app-curve-easy-ease': FLUENT_MOTION.curveEasyEase,
    '--app-curve-decelerate-mid': FLUENT_MOTION.curveDecelerateMid,
    '--app-stroke-width-focus': rem(2),
  },
  light: {
    '--mantine-color-text': FLUENT_NEUTRALS.foregroundLight,
    '--mantine-color-default-color': FLUENT_NEUTRALS.foregroundLight,
    '--mantine-color-default-hover': theme.colors.gray[1],
    '--mantine-color-placeholder': FLUENT_NEUTRALS.placeholderLight,
    '--mantine-color-error': theme.colors.danger[7],
    '--app-color-canvas': FLUENT_NEUTRALS.canvasLight,
    '--app-color-stroke-subtle': theme.colors.gray[3],
    '--app-color-stroke-accessible': FLUENT_NEUTRALS.strokeAccessibleLight,
    '--app-color-stroke-focus': FLUENT_NEUTRALS.focusLight,
    '--app-shadow-2': FLUENT_SHADOWS.light[2],
    '--app-shadow-4': FLUENT_SHADOWS.light[4],
    '--app-shadow-8': FLUENT_SHADOWS.light[8],
    '--app-shadow-16': FLUENT_SHADOWS.light[16],
    '--app-shadow-28': FLUENT_SHADOWS.light[28],
    '--app-shadow-64': FLUENT_SHADOWS.light[64],
  },
  dark: {
    '--mantine-color-placeholder': FLUENT_NEUTRALS.placeholderDark,
    // Mantine's dark default is `red.8`, a fill shade; text needs shade 4.
    '--mantine-color-error': theme.colors.danger[4],
    '--app-color-canvas': FLUENT_NEUTRALS.canvasDark,
    '--app-color-stroke-subtle': theme.colors.dark[5],
    '--app-color-stroke-accessible': FLUENT_NEUTRALS.strokeAccessibleDark,
    '--app-color-stroke-focus': FLUENT_NEUTRALS.focusDark,
    '--app-shadow-2': FLUENT_SHADOWS.dark[2],
    '--app-shadow-4': FLUENT_SHADOWS.dark[4],
    '--app-shadow-8': FLUENT_SHADOWS.dark[8],
    '--app-shadow-16': FLUENT_SHADOWS.dark[16],
    '--app-shadow-28': FLUENT_SHADOWS.dark[28],
    '--app-shadow-64': FLUENT_SHADOWS.dark[64],
  },
})
