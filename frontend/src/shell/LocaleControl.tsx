/**
 * The Locale control: changes the active Locale in place (Requirement 19 AC5).
 *
 * "Without a full page reload" is satisfied structurally rather than carefully.
 * This component's only effect is `setActiveLocale`, which calls i18next's
 * `changeLanguage` on the instance the tree already renders from; it touches no
 * `window.location`, mounts no `<a href>` and sets no query parameter, so there
 * is no navigation for a reload to happen on. Everything downstream then follows
 * from the subscription already in place:
 *
 * - every `useTranslation` consumer re-renders against the new catalogue (AC1, AC2),
 * - `DirectionProvider` re-reads the active Locale through `useActiveLocale` and
 *   rewrites `dir`/`lang` on the document root and Mantine's direction (AC6, AC7),
 * - the session, the TanStack Query cache and the router are untouched, so no
 *   in-flight read is cancelled and no screen state is lost.
 *
 * `Accept-Language` follows too, without this component knowing: the Api_Client
 * reads `activeLocale()` per request (Requirement 3 AC3), so the next Backend_Api
 * call negotiates the new Locale.
 *
 * ## Why a native select
 *
 * A real `<select>` is keyboard-operable by construction (Req 20 AC2), needs no
 * focus management, and gets its accessible name from the catalogue rather than
 * from a visual cue (Req 20 AC5, AC8). Each Locale is named **in its own
 * language** — `العربية`, `עברית`, `English` — because a reader who cannot read
 * the current interface language is exactly the reader who needs this control;
 * the three `shell:locale.*` entries are therefore identical across the three
 * catalogues by design.
 *
 * Requirements: 19.5.
 */

import { NativeSelect } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { setActiveLocale } from '../i18n'
import { useActiveLocale } from '../i18n/localeDirection'
import { SUPPORTED_LOCALES } from '../lib/locale'

/** Namespace the control resolves its strings against (Requirement 19 AC2). */
const NAMESPACES = ['shell'] as const

/**
 * Presents the supported Locales and applies the selected one in place (AC5).
 *
 * Reads and writes the i18next instance the surrounding `I18nextProvider`
 * supplies — the shared instance in the application, the case's own instance in a
 * test — so the control never reaches past its tree for the Locale.
 */
export function LocaleControl() {
  const { t, i18n } = useTranslation(NAMESPACES)
  const active = useActiveLocale(i18n)

  return (
    <NativeSelect
      size="xs"
      // The label is the only string here that *is* translated; the option labels
      // deliberately are not (see the module comment).
      aria-label={t('shell:locale.label')}
      value={active}
      data={SUPPORTED_LOCALES.map((locale) => ({ value: locale, label: t(`shell:locale.${locale}`) }))}
      onChange={(event) => {
        // `setActiveLocale` resolves once the catalogue is active. Nothing waits
        // on it: the catalogues are bundled, so the switch settles without a
        // network round trip, and a rejection would leave the previous Locale in
        // place rather than anything for this control to recover from.
        void setActiveLocale(event.currentTarget.value, i18n)
      }}
      data-testid="locale-control"
    />
  )
}
