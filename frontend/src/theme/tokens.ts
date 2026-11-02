/**
 * Design tokens from the AYA theme pack; `theme.ts` and `cssVariablesResolver.ts`
 * read them, and `design-system/MASTER.md` is the written spec.
 *
 * Every ramp runs from shade 0 (lightest) to shade 9 (darkest), the order Mantine
 * expects. `contrast.test.ts` holds the shades Mantine renders to Requirement 20 AC4.
 */

import type { MantineColorsTuple } from '@mantine/core'

// ── Brand ────────────────────────────────────────────────────────────────────

export const teal: MantineColorsTuple = [
  '#E6F7F7',
  '#C2EEEE',
  '#8FE3E3',
  '#4FD8D8',
  '#06D0D0', // text and lines on dark
  '#00B5B5', // brand teal: fills and dots, never under white text
  '#009C9C',
  '#008080', // filled buttons and teal text on light
  '#007373',
  '#005757',
]

export const purple: MantineColorsTuple = [
  '#F4EFFA',
  '#E6DBF5',
  '#CDB8EC',
  '#A78BFA', // text and lines on dark
  '#9B74F7',
  '#8B5CF6', // accent on dark
  '#7040A8', // brand purple
  '#5E3590',
  '#4A2A6E',
  '#36204F',
]

export const amber: MantineColorsTuple = [
  '#FFF3D9',
  '#FFE7B3',
  '#FFD27A',
  '#FFB84D', // text on dark
  '#F7AE3A',
  '#F5A623', // brand amber: dark text on it
  '#DC8E12',
  '#B76E00', // large text and icons on light
  '#92400E', // small text on light
  '#6E3009',
]

// ── Status ───────────────────────────────────────────────────────────────────

export const green: MantineColorsTuple = [
  '#ECFDF5',
  '#D1FAE5',
  '#A7F3D0',
  '#6EE7B7',
  '#34D399',
  '#10B981',
  '#059669',
  '#047857',
  '#065F46',
  '#064E3B',
]

export const red: MantineColorsTuple = [
  '#FEF2F2',
  '#FEE2E2',
  '#FECACA',
  '#FCA5A5',
  '#F87171',
  '#EF4444',
  '#DC2626',
  '#B91C1C',
  '#991B1B',
  '#7F1D1D',
]

export const blue: MantineColorsTuple = [
  '#EFF6FF',
  '#DBEAFE',
  '#BFDBFE',
  '#93C5FD',
  '#60A5FA',
  '#3B82F6',
  '#2563EB',
  '#1D4ED8',
  '#1E40AF',
  '#1E3A8A',
]

/** Not in the pack: `severe` (suspended, blocked) needs a hue distinct from amber. */
export const orange: MantineColorsTuple = [
  '#FFF7ED',
  '#FFEDD5',
  '#FED7AA',
  '#FDBA74',
  '#FB923C',
  '#F97316',
  '#EA580C',
  '#C2410C',
  '#9A3412',
  '#7C2D12',
]

/**
 * Amber for status use. Mantine renders shade 7 as filled backgrounds and as text
 * on light, and the pack's amber.7 reaches only 3.9:1 there, so shades 7 and 8 move
 * to the values the pack itself reserves for small text.
 */
export const warning: MantineColorsTuple = [
  amber[0],
  amber[1],
  amber[2],
  amber[3],
  amber[4],
  amber[5],
  amber[6],
  '#92400E',
  '#6E3009',
  '#57260A',
]

// ── Neutrals ─────────────────────────────────────────────────────────────────

/** Slate: Mantine's `gray`, for the light scheme. */
export const gray: MantineColorsTuple = [
  '#F8FAFC',
  '#F1F5F9',
  '#E2E8F0',
  '#CBD5E1',
  '#94A3B8',
  '#64748B',
  '#475569',
  '#334155',
  '#1E293B',
  '#0F172A',
]

/** Admin surfaces: Mantine's `dark`, for the dark scheme. */
export const dark: MantineColorsTuple = [
  '#F8FAFC', // text
  '#CBD5E1',
  '#94A3B8', // dimmed
  '#64748B',
  '#313B52', // strong border
  '#232B3D', // border
  '#1E2635', // raised surface
  '#151B26', // surface
  '#10151E', // sidebar
  '#0A0E14', // canvas
]

// ── Surfaces and lines ───────────────────────────────────────────────────────

export const surfaces = {
  light: {
    ink: '#1A2E3A',
    text: '#0F172A',
    textMuted: '#475569',
    dimmed: '#64748B',
    placeholder: '#64748B',
    canvas: '#F8FAFC',
    surface: '#FFFFFF',
    sidebar: '#FFFFFF',
    border: '#E2E8F0',
    // 3:1 against the surface (WCAG 1.4.11). The pack's #E2E8F0 reaches about 1.2:1,
    // which leaves an empty input's edge effectively invisible to low-vision users.
    borderControl: '#64748B',
    inputBg: '#F8FAFC',
    inputFocusBorder: '#008080',
    anchor: '#008080',
  },
  dark: {
    ink: '#F8FAFC',
    text: '#F8FAFC',
    textMuted: '#94A3B8',
    dimmed: '#94A3B8',
    placeholder: '#94A3B8',
    canvas: '#0A0E14',
    surface: '#151B26',
    sidebar: '#10151E',
    border: '#232B3D',
    borderControl: '#64748B',
    inputBg: '#1E2635',
    inputFocusBorder: '#06D0D0',
    anchor: '#06D0D0',
  },
} as const

/**
 * The header band of each role. White text sits on these, so `contrast.test.ts` holds
 * both ends and the midpoint to 4.5:1. The pack's student gradient (#F5A623 to #E74C3C)
 * reaches about 2:1 there, so the Candidate band uses deeper amber and red.
 */
export const roleBands = {
  senior: { from: '#7040A8', to: '#4A2A6E' },
  candidate: { from: '#B45309', to: '#B91C1C' },
} as const

const bandGradient = (band: { readonly from: string; readonly to: string }): string =>
  `linear-gradient(135deg, ${band.from}, ${band.to})`

export const gradients = {
  brand: 'linear-gradient(135deg, #00B5B5 0%, #7040A8 100%)',
  senior: bandGradient(roleBands.senior),
  candidate: bandGradient(roleBands.candidate),
} as const

// ── Type ─────────────────────────────────────────────────────────────────────

/**
 * Cairo carries Arabic and Latin but not Hebrew, so Noto Sans Hebrew is loaded for
 * the `he` locale (Requirement 19 AC1). Browsers fetch it only for Hebrew text.
 */
export const fontFamily =
  "'Cairo Variable', Cairo, 'Noto Sans Hebrew Variable', 'IBM Plex Sans Arabic', 'Noto Sans Arabic', 'Noto Sans Hebrew', system-ui, -apple-system, 'Segoe UI', sans-serif"

export const fontFamilyMono = "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace"
