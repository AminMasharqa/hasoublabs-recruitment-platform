/**
 * Holds the design tokens to Requirement 20 AC4 for every pairing Mantine renders:
 * text at 4.5:1, control boundaries and focus indicators at 3:1 (WCAG 1.4.11).
 *
 * Mantine derives a colour's states from fixed shades, so checking the shades covers
 * every `color=` and `c=` in the application:
 *
 * - Light: filled background and text use shade 7; the light variant is shade 9 on 1.
 * - Dark: filled background uses shade 7; text and outline use shade 4; the light
 *   variant is shade 0 on shade 9 darkened by half.
 */

import type { MantineColorsTuple } from '@mantine/core'
import { describe, expect, it } from 'vitest'

import {
  amber,
  blue,
  dark,
  gray,
  green,
  orange,
  purple,
  red,
  roleBands,
  surfaces,
  teal,
  warning,
} from './tokens'

const WHITE = '#FFFFFF'

function channels(hex: string): number[] {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16))
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = channels(hex).map((value) => {
    const channel = value / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(first: string, second: string): number {
  const [high = 0, low = 0] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (high + 0.05) / (low + 0.05)
}

/** Mantine's `darken`: each channel scaled down by `amount`. */
function darken(hex: string, amount: number): string {
  const scaled = channels(hex).map((value) =>
    Math.round(value * (1 - amount))
      .toString(16)
      .padStart(2, '0'),
  )
  return `#${scaled.join('')}`
}

function shade(ramp: MantineColorsTuple, index: number): string {
  const value = ramp[index]
  if (value === undefined) {
    throw new Error(`ramp has no shade ${String(index)}`)
  }
  return value
}

const light = surfaces.light
const night = surfaces.dark

describe.each<[string, MantineColorsTuple]>([
  ['brand', teal],
  ['purple', purple],
  ['info', blue],
  ['success', green],
  ['warning', warning],
  ['severe', orange],
  ['danger', red],
  ['neutral', gray],
])('the %s ramp', (_name, ramp) => {
  it.each<[string, string, string]>([
    ['white on the light filled background', WHITE, shade(ramp, 7)],
    ['text on a light surface', shade(ramp, 7), light.surface],
    ['text on the light canvas', shade(ramp, 7), light.canvas],
    ['the light variant', shade(ramp, 9), shade(ramp, 1)],
    ['white on the dark filled background', WHITE, shade(ramp, 7)],
    ['text on a dark surface', shade(ramp, 4), night.surface],
    ['text on the dark canvas', shade(ramp, 4), night.canvas],
    ['the dark light variant', shade(ramp, 0), darken(shade(ramp, 9), 0.5)],
  ])('reaches 4.5:1 for %s', (_pair, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('text on neutral surfaces', () => {
  it.each<[string, string, string]>([
    ['light text', light.text, light.surface],
    ['light ink', light.ink, light.canvas],
    ['light muted text', light.textMuted, light.surface],
    ['light dimmed on a surface', light.dimmed, light.surface],
    ['light dimmed on the canvas', light.dimmed, light.canvas],
    ['light placeholder in an input', light.placeholder, light.inputBg],
    ['light link', light.anchor, light.surface],
    ['dark text', night.text, night.surface],
    ['dark text in an input', night.text, night.inputBg],
    ['dark muted text', night.textMuted, night.surface],
    ['dark dimmed on the canvas', night.dimmed, night.canvas],
    ['dark dimmed on the sidebar', night.dimmed, night.sidebar],
    ['dark placeholder in an input', night.placeholder, night.inputBg],
    ['dark link', night.anchor, night.surface],
    ['light error', shade(red, 7), light.surface],
    ['dark error', shade(red, 4), night.surface],
  ])('reaches 4.5:1 for %s', (_pair, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5)
  })
})

/** The colour halfway along a band, the two ends being the other points checked. */
function midpoint(from: string, to: string): string {
  const [first, second] = [channels(from), channels(to)]
  const mixed = first.map((value, index) =>
    Math.round((value + (second[index] ?? 0)) / 2)
      .toString(16)
      .padStart(2, '0'),
  )
  return `#${mixed.join('')}`
}

describe('the role styles', () => {
  it.each(Object.entries(roleBands))('keeps white text readable across the %s band', (_role, band) => {
    for (const background of [band.from, midpoint(band.from, band.to), band.to]) {
      expect(contrast(WHITE, background)).toBeGreaterThanOrEqual(4.5)
    }
  })

  // `theme.css` re-points the Senior `brand` shades at these purple ones.
  it.each<[string, string, string]>([
    ['white on a Senior filled button', WHITE, shade(purple, 6)],
    ['Senior links on a surface', shade(purple, 6), light.surface],
    ['Senior links on the canvas', shade(purple, 6), light.canvas],
    ['the Senior light variant', shade(purple, 8), shade(purple, 1)],
    ['the Candidate active menu item', shade(amber, 8), shade(amber, 1)],
  ])('reaches 4.5:1 for %s', (_pair, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5)
  })

  it.each<[string, string, string]>([
    ['the Senior focus edge', shade(purple, 6), light.surface],
    ['the Candidate menu bar on its tint', shade(amber, 7), shade(amber, 1)],
  ])('reaches 3:1 for %s', (_pair, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(3)
  })
})

describe('control boundaries and focus', () => {
  it.each<[string, string, string]>([
    ['light input edge', light.borderControl, light.surface],
    ['light input edge on its fill', light.borderControl, light.inputBg],
    ['light focused input', light.inputFocusBorder, light.surface],
    ['dark input edge', night.borderControl, night.surface],
    ['dark input edge on its fill', night.borderControl, night.inputBg],
    ['dark focused input', night.inputFocusBorder, night.surface],
    ['focus ring on the light canvas', shade(teal, 7), light.canvas],
    ['focus ring on the dark canvas', shade(teal, 7), night.canvas],
    ['focus ring on a dark surface', shade(teal, 7), night.surface],
  ])('reaches 3:1 for %s', (_pair, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(3)
  })

  it('reads the dark scheme from the surface values it was given', () => {
    expect(shade(dark, 7)).toBe(night.surface)
    expect(shade(dark, 9)).toBe(night.canvas)
  })
})
