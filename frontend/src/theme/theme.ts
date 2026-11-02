/**
 * The shared Mantine theme (Requirement 1 AC2, Requirement 20 AC1, AC4), styled by
 * the AYA theme pack and specified in `design-system/MASTER.md`.
 *
 * One theme object, passed to the single `MantineProvider` in `shell/AppShell.tsx`,
 * so every interface primitive resolves the same tokens.
 *
 * - `respectReducedMotion` makes Mantine emit its transitions behind
 *   `prefers-reduced-motion: reduce`, which is how `LoadingState` in
 *   `errors/ErrorPresenter.tsx` honours Requirement 20 AC12.
 * - Direction is deliberately *not* set here. `i18n/DirectionProvider.tsx` owns it,
 *   because the active Locale decides it (Requirement 19 AC6, AC7).
 *
 * ## Semantic colours
 *
 * Feature code names a colour by what it means, not by its hue:
 *
 * | Name      | Meaning                                   | Ramp    |
 * |-----------|-------------------------------------------|---------|
 * | `brand`   | primary actions, links, selection         | teal    |
 * | `info`    | neutral information, "primary" markers    | blue    |
 * | `success` | done, approved, available, verified       | green   |
 * | `warning` | pending, incomplete, needs attention      | warning |
 * | `severe`  | suspended, blocked, out of range          | orange  |
 * | `danger`  | rejected, failed, destructive             | red     |
 * | `neutral` | inactive, archived, closed-but-not-failed | gray    |
 */

import {
  ActionIcon,
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  createTheme,
  Input,
  type MantineThemeOverride,
  Modal,
  NavLink,
  Notification,
  Paper,
  Progress,
  rem,
  SegmentedControl,
  Table,
  Tabs,
  Tooltip,
} from '@mantine/core'

import {
  amber,
  blue,
  dark,
  fontFamily,
  fontFamilyMono,
  gray,
  green,
  orange,
  purple,
  red,
  teal,
  warning,
} from './tokens'

/** The single Mantine theme of the application. */
export const appTheme: MantineThemeOverride = createTheme({
  // Requirement 20 AC12: Mantine applies this to its own transitions and `Loader`.
  respectReducedMotion: true,

  colors: {
    // Semantic names, the ones feature code uses.
    brand: teal,
    info: blue,
    success: green,
    warning,
    severe: orange,
    danger: red,
    neutral: gray,
    // The pack's palette, and Mantine's own names so its internals stay on palette.
    teal,
    purple,
    amber,
    green,
    red,
    blue,
    orange,
    gray,
    dark,
  },
  primaryColor: 'brand',
  // Shade 7 (#008080) carries white text in both schemes.
  primaryShade: { light: 7, dark: 7 },
  autoContrast: true,
  luminanceThreshold: 0.35,

  white: '#FFFFFF',
  black: '#0F172A',

  fontFamily,
  fontFamilyMonospace: fontFamilyMono,
  // Mantine 9 made 600 its default medium weight; these are pinned to the pack's.
  fontWeights: { regular: '500', medium: '700', bold: '800' },

  headings: {
    fontFamily,
    fontWeight: '800',
    sizes: {
      h1: { fontSize: rem(38), lineHeight: '1.25', fontWeight: '900' },
      h2: { fontSize: rem(26), lineHeight: '1.3' },
      h3: { fontSize: rem(20), lineHeight: '1.35' },
      h4: { fontSize: rem(17), lineHeight: '1.4', fontWeight: '900' },
      h5: { fontSize: rem(14), lineHeight: '1.4' },
      h6: { fontSize: rem(12), lineHeight: '1.4' },
    },
  },

  fontSizes: { xs: rem(11), sm: rem(12), md: rem(13), lg: rem(14), xl: rem(17) },
  lineHeights: { xs: '1.4', sm: '1.45', md: '1.6', lg: '1.6', xl: '1.5' },

  radius: { xs: rem(6), sm: rem(8), md: rem(12), lg: rem(14), xl: rem(18) },
  defaultRadius: 'md',

  spacing: { xs: rem(6), sm: rem(10), md: rem(14), lg: rem(20), xl: rem(28) },

  // `cssVariablesResolver.ts` removes the resting shadows in the dark scheme, which
  // separates surfaces with borders instead.
  shadows: {
    xs: '0 1px 2px rgba(15, 23, 42, 0.05)',
    sm: '0 1px 3px rgba(15, 23, 42, 0.06)',
    md: '0 4px 12px rgba(15, 23, 42, 0.08)',
    lg: '0 10px 30px rgba(0, 0, 0, 0.08)',
    xl: '0 25px 50px -12px rgba(15, 23, 42, 0.25)',
  },

  cursorType: 'pointer',

  components: {
    Button: Button.extend({
      defaultProps: { radius: 'md' },
      // Mantine does not expose a button's colour to CSS, so the glow that only a
      // primary button carries (`theme.css`) is marked here.
      classNames: (_theme, props) => (props.color === undefined ? { root: 'app-button-primary' } : {}),
      // The type scale makes `sm` 12px, too small for an action at the default size.
      vars: (_theme, props) => ({
        root: props.size === undefined || props.size === 'sm' ? { '--button-fz': 'var(--mantine-font-size-lg)' } : {},
      }),
      styles: { root: { fontWeight: 800 } },
    }),
    ActionIcon: ActionIcon.extend({ defaultProps: { radius: 'xl', variant: 'light' } }),
    Badge: Badge.extend({
      defaultProps: { radius: 'xl', variant: 'light' },
      styles: { root: { textTransform: 'none', fontWeight: 800, letterSpacing: 0 } },
    }),
    Chip: Chip.extend({ defaultProps: { radius: 'xl' } }),
    Input: Input.extend({
      defaultProps: { radius: 'md' },
      styles: { input: { borderWidth: rem(1.5), fontWeight: 600 } },
    }),
    Card: Card.extend({ defaultProps: { radius: 'lg', shadow: 'sm', withBorder: true, padding: 'md' } }),
    Paper: Paper.extend({ defaultProps: { radius: 'lg', shadow: 'sm' } }),
    Modal: Modal.extend({ defaultProps: { radius: 'xl' } }),
    Notification: Notification.extend({ defaultProps: { radius: 'lg' } }),
    Avatar: Avatar.extend({ defaultProps: { radius: 'xl' } }),
    Progress: Progress.extend({ defaultProps: { radius: 'xl' } }),
    SegmentedControl: SegmentedControl.extend({ defaultProps: { radius: 'xl' } }),
    Tabs: Tabs.extend({ styles: { tab: { fontWeight: 700 } } }),
    Tooltip: Tooltip.extend({ defaultProps: { radius: 'sm', withArrow: true } }),
    NavLink: NavLink.extend({
      defaultProps: { variant: 'light' },
      styles: { root: { borderRadius: 'var(--mantine-radius-md)', fontWeight: 600 } },
    }),
    Table: Table.extend({
      defaultProps: { verticalSpacing: 'sm', horizontalSpacing: 'md', highlightOnHover: true },
      styles: {
        th: {
          fontSize: 'var(--mantine-font-size-xs)',
          fontWeight: 800,
          color: 'var(--mantine-color-dimmed)',
          letterSpacing: rem(0.4),
        },
      },
    }),
  },
})
