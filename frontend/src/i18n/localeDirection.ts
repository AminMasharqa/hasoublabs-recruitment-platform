/**
 * The direction side of the active Locale: document-root attributes and the
 * hooks that track a Locale change (Requirement 19 AC5, AC6, AC7).
 *
 * Separate from `DirectionProvider.tsx` because that file holds components only;
 * these are the non-component parts the provider and every consumer share.
 * Direction itself is decided by `resolveDirection` in `src/lib/direction.ts`
 * (Property 10) — nothing here re-decides it.
 */

import { useCallback, useSyncExternalStore } from 'react'
import type { i18n as I18nextInstance } from 'i18next'

import { resolveDirection, type Direction } from '../lib/direction'
import type { Locale } from '../lib/locale'

import { activeLocale, i18n as sharedI18n } from './index'

/** The document-root attributes an active Locale implies. */
export interface DocumentDirectionAttributes {
  /** `rtl` for `ar`/`he`, `ltr` for `en` (AC6, AC7). */
  readonly dir: Direction
  /** The BCP 47 tag assistive technology and hyphenation read. */
  readonly lang: Locale
}

/** Derives the document-root attributes of a Locale. Pure. */
export function documentDirectionAttributes(locale: Locale): DocumentDirectionAttributes {
  return { dir: resolveDirection(locale), lang: locale }
}

/**
 * Writes the direction and language of a Locale onto a document root.
 *
 * Idempotent, and a no-op where there is no document, so a non-DOM environment
 * can import this module. Returns the attributes it applied.
 */
export function applyDocumentDirection(
  locale: Locale,
  root: HTMLElement | null | undefined = typeof document === 'undefined'
    ? null
    : document.documentElement,
): DocumentDirectionAttributes {
  const attributes = documentDirectionAttributes(locale)
  if (root) {
    if (root.getAttribute('dir') !== attributes.dir) {
      root.setAttribute('dir', attributes.dir)
    }
    if (root.getAttribute('lang') !== attributes.lang) {
      root.setAttribute('lang', attributes.lang)
    }
  }
  return attributes
}

/**
 * The active Locale, re-read whenever i18next switches language.
 *
 * Subscribes to the instance rather than to a React context, so the value is the
 * one `activeLocale` reports and a locale change anywhere — the Locale control,
 * a login applying `language_preference` — re-renders the consumer without a
 * page reload (AC5).
 */
export function useActiveLocale(instance: I18nextInstance = sharedI18n): Locale {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      instance.on('languageChanged', onStoreChange)
      instance.on('initialized', onStoreChange)
      return () => {
        instance.off('languageChanged', onStoreChange)
        instance.off('initialized', onStoreChange)
      }
    },
    [instance],
  )
  const getSnapshot = useCallback(() => activeLocale(instance), [instance])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** The active layout direction (AC6, AC7). */
export function useActiveDirection(instance: I18nextInstance = sharedI18n): Direction {
  return resolveDirection(useActiveLocale(instance))
}
