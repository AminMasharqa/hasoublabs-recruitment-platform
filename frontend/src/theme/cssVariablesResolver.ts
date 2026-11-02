/**
 * Scheme-specific CSS variables, passed to the `MantineProvider` beside `appTheme`.
 *
 * Mantine's variables are overridden where its defaults differ from the design
 * system. `--app-*` covers what Mantine has no slot for; use those in CSS rather
 * than a colour value.
 *
 * `--mantine-color-body` is the *surface*, because Mantine paints cards, the header
 * and the navbar with it. The page behind them reads `--app-canvas` (`theme.css`).
 */

import type { CSSVariablesResolver } from '@mantine/core'

import { gradients, red, surfaces } from './tokens'

const NO_SHADOW = 'none'

export const appCssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {
    '--app-gradient-brand': gradients.brand,
    '--app-gradient-senior': gradients.senior,
    '--app-gradient-candidate': gradients.candidate,
    '--app-shadow-glow-primary': '0 8px 16px rgba(0, 181, 181, 0.3)',
    '--app-focus-ring': '0 0 0 4px rgba(0, 181, 181, 0.12)',
  },

  light: {
    '--mantine-color-body': surfaces.light.surface,
    '--mantine-color-text': surfaces.light.text,
    '--mantine-color-dimmed': surfaces.light.dimmed,
    '--mantine-color-placeholder': surfaces.light.placeholder,
    '--mantine-color-default-border': surfaces.light.border,
    '--mantine-color-anchor': surfaces.light.anchor,
    '--mantine-color-error': red[7],

    '--app-ink': surfaces.light.ink,
    '--app-canvas': surfaces.light.canvas,
    '--app-sidebar': surfaces.light.sidebar,
    '--app-border': surfaces.light.border,
    '--app-border-control': surfaces.light.borderControl,
    '--app-text-muted': surfaces.light.textMuted,
    '--app-input-bg': surfaces.light.inputBg,
    '--app-input-focus-border': surfaces.light.inputFocusBorder,
  },

  dark: {
    '--mantine-color-body': surfaces.dark.surface,
    '--mantine-color-text': surfaces.dark.text,
    '--mantine-color-dimmed': surfaces.dark.dimmed,
    '--mantine-color-placeholder': surfaces.dark.placeholder,
    '--mantine-color-default': surfaces.dark.surface,
    '--mantine-color-default-hover': surfaces.dark.inputBg,
    '--mantine-color-default-border': surfaces.dark.border,
    '--mantine-color-anchor': surfaces.dark.anchor,
    // Mantine's dark default is `red.8`, a fill shade that is unreadable as text.
    '--mantine-color-error': red[4],
    '--mantine-shadow-xs': NO_SHADOW,
    '--mantine-shadow-sm': NO_SHADOW,
    '--mantine-shadow-md': NO_SHADOW,

    '--app-ink': surfaces.dark.ink,
    '--app-canvas': surfaces.dark.canvas,
    '--app-sidebar': surfaces.dark.sidebar,
    '--app-border': surfaces.dark.border,
    '--app-border-control': surfaces.dark.borderControl,
    '--app-text-muted': surfaces.dark.textMuted,
    '--app-input-bg': surfaces.dark.inputBg,
    '--app-input-focus-border': surfaces.dark.inputFocusBorder,
  },
})
