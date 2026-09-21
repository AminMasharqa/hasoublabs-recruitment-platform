/**
 * The Direction_Provider: propagates the active Locale's layout direction to the
 * document root and to Mantine (Requirement 19 AC6, AC7).
 *
 * `document.documentElement` carries `dir` and `lang`, and Mantine's own
 * `DirectionProvider` carries the same direction so every Mantine component
 * mirrors with the application (AC8). Both are re-applied whenever the active
 * Locale changes, in place and without a page reload (AC5).
 *
 * This module decides nothing: `resolveDirection` in `src/lib/direction.ts` maps
 * a Locale to a direction (Property 10), `src/i18n/index.ts` owns the active
 * Locale and `localeDirection.ts` holds the document-attribute and subscription
 * helpers. The conventions that make mirroring work — logical CSS properties and
 * bidi isolation — are documented in `direction.css`, which this module imports
 * so the classes ship wherever the provider does. The byte-identical text
 * passthrough behind {@link BidiText} lives in `formatting.ts` (AC10, AC11).
 */

import { DirectionProvider as MantineDirectionProvider, useDirection } from '@mantine/core'
import { useLayoutEffect, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import type { i18n as I18nextInstance } from 'i18next'

import type { Direction } from '../lib/direction'

import { textForDisplay } from './formatting'
import { i18n as sharedI18n } from './index'
import { applyDocumentDirection, documentDirectionAttributes, useActiveLocale } from './localeDirection'

import './direction.css'

/**
 * Keeps Mantine's direction equal to the direction its parent resolved.
 *
 * Mantine's `initialDirection` only seeds the first render, so a later Locale
 * change is pushed through its `setDirection`. Runs in a layout effect, so the
 * update lands before paint and no frame is painted mirrored the wrong way.
 */
function MantineDirectionSync({ direction }: { readonly direction: Direction }): null {
  const { dir, setDirection } = useDirection()
  useLayoutEffect(() => {
    if (dir !== direction) {
      setDirection(direction)
    }
  }, [dir, direction, setDirection])
  return null
}

export interface DirectionProviderProps {
  readonly children?: ReactNode
  /**
   * The i18next instance to read the active Locale from. Defaults to the shared
   * instance; a test or an isolated surface can pass its own.
   */
  readonly instance?: I18nextInstance
  /**
   * The document root to write `dir` and `lang` onto. Defaults to
   * `document.documentElement`; an explicit `null` suppresses the write.
   */
  readonly root?: HTMLElement | null
}

/**
 * Applies the active Locale's direction to the document root and to Mantine.
 *
 * Mount this above the application shell. `detectDirection` is off on the
 * Mantine provider because the active Locale is the single source of truth for
 * the direction: nothing else is allowed to write `dir`, so there is nothing to
 * detect, and a stale attribute cannot win over the Locale.
 */
export function DirectionProvider({
  children,
  instance = sharedI18n,
  root,
}: DirectionProviderProps) {
  const locale = useActiveLocale(instance)
  const { dir } = documentDirectionAttributes(locale)

  useLayoutEffect(() => {
    applyDocumentDirection(locale, root)
  }, [locale, root])

  return (
    <MantineDirectionProvider initialDirection={dir} detectDirection={false}>
      <MantineDirectionSync direction={dir} />
      {children}
    </MantineDirectionProvider>
  )
}

export interface BidiTextProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children' | 'dir'> {
  /** The Backend_Api or user-entered value, rendered byte-identically (AC10). */
  readonly value: string | null | undefined
}

/**
 * Renders text of unknown direction byte-identically and bidi-isolated (AC10).
 *
 * `dir="auto"` lets the browser resolve the value's own base direction from its
 * first strong character and `unicode-bidi: isolate` stops the surrounding run
 * from reordering it visually. Neither touches a stored character: the rendered
 * text is exactly `textForDisplay(value)`, which is the value itself.
 *
 * Use this for every value that comes from the Backend_Api or from a user —
 * names, job titles, review notes, filenames — because such a value may be
 * Arabic or Hebrew regardless of the active Locale. Interface strings resolved
 * from a catalogue do not need it: they match the active direction by
 * construction.
 */
export function BidiText({ value, className, ...rest }: BidiTextProps) {
  const classes = className === undefined ? 'bidi-isolate' : `bidi-isolate ${className}`
  return (
    <span dir="auto" className={classes} {...rest}>
      {textForDisplay(value)}
    </span>
  )
}
