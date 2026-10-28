import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

/**
 * jsdom implements no `matchMedia`, and `MantineProvider` reads it to resolve the
 * colour scheme and the reduced-motion preference, so any component test that
 * mounts Mantine throws without this stub.
 *
 * Every query reports `matches: false`, which is the "no preference expressed"
 * answer: light colour scheme and motion not reduced. A test that needs a
 * preference — the reduced-motion behaviour of Requirement 20 AC12 — overrides
 * `window.matchMedia` itself for the duration of that test.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList =>
      ({
        media: query,
        matches: false,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  })
}

/**
 * jsdom implements no `FontFaceSet`, so `document.fonts` is `undefined`, and
 * Mantine's autosizing `Textarea` subscribes to `document.fonts` `loadingdone` to
 * re-measure after a webfont swap. Any component test that mounts one throws
 * without this stub.
 *
 * The stub reports an empty, already-settled font set: nothing to load, so the
 * event never fires and the measurement Mantine performs on mount stands.
 */
if (typeof document !== 'undefined' && (document as Partial<Document>).fonts === undefined) {
  Object.defineProperty(document, 'fonts', {
    writable: true,
    configurable: true,
    value: {
      ready: Promise.resolve(),
      status: 'loaded',
      size: 0,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    } as unknown as FontFaceSet,
  })
}

/**
 * jsdom implements no `ResizeObserver`, and Mantine's `ScrollArea` — which every
 * `Select`, `Autocomplete` and `MultiSelect` dropdown is built on — constructs one
 * on mount. Any component test that mounts one of those controls throws without
 * this stub.
 *
 * The stub observes nothing and never notifies: jsdom performs no layout, so there
 * is no size change to report, and the measurement Mantine takes on mount stands.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    configurable: true,
    value: class {
      observe(): void {
        // No layout in jsdom, so nothing to observe.
      }

      unobserve(): void {
        // Nothing was observed.
      }

      disconnect(): void {
        // Nothing to disconnect.
      }
    },
  })
}
