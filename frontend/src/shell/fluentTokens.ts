/**
 * Fluent 2 design tokens, expressed as the values the shared Mantine theme
 * (`theme.ts`) consumes. This is not a second theme: nothing reads this module
 * except `theme.ts`, which maps every value onto a Mantine token or an `--app-*`
 * CSS variable emitted through Mantine's own `cssVariablesResolver`.
 *
 * Every colour comes from the Fluent 2 web palette (brand "communication blue",
 * the shared red / green / marigold / dark-orange families, and the grey
 * ramp). Each 10-shade ramp is ordered lightest to darkest, the way Mantine
 * expects, and is chosen so that the shades Mantine actually renders clear
 * Requirement 20 AC4 in both colour schemes:
 *
 * | Shade | Rendered as                                  | Ratio       |
 * |-------|----------------------------------------------|-------------|
 * | 7     | light filled bg (white text) and light text  | >= 4.5:1    |
 * | 8     | dark filled bg (white text)                  | >= 4.5:1    |
 * | 4     | dark-scheme text and outline                 | >= 4.5:1    |
 * | 1 / 9 | light-variant background / its text          | >= 4.5:1    |
 *
 * The pairs are verified by a contrast script; see the theme notes in
 * `theme.ts` for how the shades are wired.
 */

/** Fluent brand ramp (web "communication blue"): 160, 150, 140, 130, 110, 100, 90, 80, 70, 50. */
export const FLUENT_BRAND = [
  '#ebf3fc',
  '#cfe4fa',
  '#b4d6fa',
  '#96c6fa',
  '#62abf5',
  '#479ef5',
  '#2886de',
  '#0f6cbd',
  '#115ea3',
  '#0e4775',
] as const

/** Fluent red: tint60..tint30, tint10, primary, shade10..shade30. */
export const FLUENT_DANGER = [
  '#fdf6f6',
  '#f8dadb',
  '#f1bbbc',
  '#eeacb2',
  '#e37d80',
  '#d7474b',
  '#d13438',
  '#bc2f32',
  '#9f282b',
  '#751d1f',
] as const

/** Fluent green: tint60..tint30, tint20, tint10, primary, shade10, shade20. */
export const FLUENT_SUCCESS = [
  '#f1faf1',
  '#dcf2dc',
  '#c9eac9',
  '#9fd89f',
  '#54b054',
  '#359b35',
  '#218c21',
  '#107c10',
  '#0e700e',
  '#0c5e0c',
] as const

/** Fluent marigold (status "warning"): tint60..tint20, primary, shade10, shade30, shade35, shade40. */
export const FLUENT_WARNING = [
  '#fefbf4',
  '#f9e2ae',
  '#f2c661',
  '#efb839',
  '#eaa300',
  '#d39300',
  '#b27c00',
  '#835b00',
  '#6b4a00',
  '#463100',
] as const

/** Fluent dark orange (badge "severe"): tint60..tint30, tint20, primary, shade10..shade30. */
export const FLUENT_SEVERE = [
  '#fdf6f3',
  '#f9dcd1',
  '#f4bfab',
  '#ee9f80',
  '#e9835e',
  '#e36537',
  '#da3b01',
  '#c43501',
  '#a62d01',
  '#7a2101',
] as const

/**
 * Fluent grey ramp for the light scheme: grey98, 96, 92, 88, 82, 68, 38, 26, 20, 14.
 * Shade 6 is the "dimmed" text token, shade 3 the subtle divider, shade 4 the
 * neutral control border (Fluent `colorNeutralStroke1`).
 */
export const FLUENT_NEUTRAL = [
  '#fafafa',
  '#f5f5f5',
  '#ebebeb',
  '#e0e0e0',
  '#d1d1d1',
  '#adadad',
  '#616161',
  '#424242',
  '#333333',
  '#242424',
] as const

/**
 * Fluent grey ramp for the dark scheme, in Mantine's `dark` order: 0 is the
 * foreground, 2 "dimmed", 4 the control border, 6 input/hover fill, 7 the
 * surface (`colorNeutralBackground1`), 8 the canvas, 9 the deepest layer.
 */
export const FLUENT_DARK = [
  '#ffffff',
  '#d6d6d6',
  '#adadad',
  '#999999',
  '#666666',
  '#525252',
  '#3d3d3d',
  '#292929',
  '#1f1f1f',
  '#141414',
] as const

/** Scheme-dependent neutral tokens that have no slot in a Mantine ramp. */
export const FLUENT_NEUTRALS = {
  foregroundLight: '#242424',
  canvasLight: '#f5f5f5',
  canvasDark: '#1f1f1f',
  placeholderLight: '#707070',
  placeholderDark: '#adadad',
  strokeAccessibleLight: '#616161',
  strokeAccessibleDark: '#adadad',
  focusLight: '#000000',
  focusDark: '#ffffff',
} as const

/**
 * Fluent elevation. Each level is an ambient (key-less) shadow plus a key
 * shadow; the dark scheme uses deeper alphas so the edge stays visible on a
 * dark surface.
 */
const shadow = (ambientBlur: number, keyY: number, keyBlur: number, a1: number, a2: number) =>
  `0 0 ${ambientBlur}px rgba(0, 0, 0, ${a1}), 0 ${keyY}px ${keyBlur}px rgba(0, 0, 0, ${a2})`

export const FLUENT_SHADOWS = {
  light: {
    2: shadow(2, 1, 2, 0.12, 0.14),
    4: shadow(2, 2, 4, 0.12, 0.14),
    8: shadow(2, 4, 8, 0.12, 0.14),
    16: shadow(2, 8, 16, 0.12, 0.14),
    28: shadow(8, 14, 28, 0.2, 0.24),
    64: shadow(8, 32, 64, 0.2, 0.24),
  },
  dark: {
    2: shadow(2, 1, 2, 0.24, 0.28),
    4: shadow(2, 2, 4, 0.24, 0.28),
    8: shadow(2, 4, 8, 0.24, 0.28),
    16: shadow(2, 8, 16, 0.24, 0.28),
    28: shadow(8, 14, 28, 0.24, 0.28),
    64: shadow(8, 32, 64, 0.24, 0.28),
  },
} as const

/** Fluent motion: durations and the two curves the application uses. */
export const FLUENT_MOTION = {
  durationFaster: '100ms',
  durationNormal: '200ms',
  curveEasyEase: 'cubic-bezier(0.33, 0, 0.67, 1)',
  curveDecelerateMid: 'cubic-bezier(0.1, 0.9, 0.2, 1)',
} as const
