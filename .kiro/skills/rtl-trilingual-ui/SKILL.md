---
name: rtl-trilingual-ui
description: RTL-first layout and Arabic/English/Hebrew localization rules for the HasoubLabs SPA. Use when building or reviewing any component, page, or stylesheet, adding user-visible text, formatting dates/numbers/names, handling mixed-direction content, or wiring the language preference.
metadata:
  requirements: Localization constraints, design.md Internationalization section, D-17
---

# RTL-first trilingual UI

Arabic, English, Hebrew. **Two of three are RTL, so RTL is the default case.** Design RTL first, then confirm LTR. A layout that only looks right in English is broken for the majority of users.

## Direction wiring

Direction is driven by the account's stored language preference, not the browser.

```tsx
// AppProviders.tsx
import { DirectionProvider, MantineProvider } from '@mantine/core';

const RTL_LANGS = new Set(['ar', 'he']);
const dirFor = (lng: string) => (RTL_LANGS.has(lng) ? 'rtl' : 'ltr');

export function AppProviders({ children }: { children: React.ReactNode }) {
  const { i18n } = useTranslation();
  const dir = dirFor(i18n.language);

  useEffect(() => {
    document.documentElement.setAttribute('dir', dir);
    document.documentElement.setAttribute('lang', i18n.language);
  }, [dir, i18n.language]);

  return (
    <DirectionProvider initialDirection={dir} detectDirection={false}>
      <MantineProvider theme={theme}>{children}</MantineProvider>
    </DirectionProvider>
  );
}
```

`dir` and `lang` both belong on `<html>`. `lang` is what screen readers use to pick a voice — an Arabic page announced with an English synthesizer is unusable.

## Logical properties only

| Never write | Write instead |
| --- | --- |
| `margin-left` / `margin-right` | `margin-inline-start` / `margin-inline-end` |
| `padding-left` / `padding-right` | `padding-inline-start` / `padding-inline-end` |
| `left` / `right` | `inset-inline-start` / `inset-inline-end` |
| `text-align: left` / `right` | `text-align: start` / `end` |
| `border-left` / `border-right` | `border-inline-start` / `border-inline-end` |
| `border-radius: 4px 0 0 4px` | `border-start-start-radius` etc. |
| `float: left` | `float: inline-start` |
| `transform: translateX(8px)` | direction-aware value, or flip via `[dir='rtl']` |

Mantine's `ml`/`mr` style props map to logical properties, so `ml="md"` is margin-inline-start. That is correct and preferred over raw CSS.

Enforce it, do not rely on discipline:

```js
// .stylelintrc.cjs
module.exports = {
  rules: {
    'csstools/use-logical': true, // stylelint-use-logical-spec
    'declaration-property-value-disallowed-list': {
      'text-align': ['left', 'right'],
    },
  },
};
```

### Things that must NOT flip

Direction-agnostic content stays put even in RTL:

- Media playback controls (play always points in the reading direction of time, not text)
- Progress bars for time-based operations (upload progress, scan progress)
- Numbers themselves — `+972 50 123 4567` stays LTR
- Code, URLs, file paths, email addresses
- Chevrons that mean "expand/collapse" (vertical), as opposed to "next/previous" (horizontal — these do flip)

Wrap LTR-only runs so bidi does not scramble them:

```tsx
<span dir="ltr" style={{ unicodeBidi: 'isolate' }}>{profile.linkedinUrl}</span>
```

Use `unicode-bidi: isolate` (not `embed`) so the isolated run cannot leak direction into surrounding Arabic or Hebrew text. This matters most for: LinkedIn URLs, E.164 phone numbers, email addresses, national ID digits, CV filenames, and company names written in Latin script inside an Arabic sentence.

## Strings

**No user-visible literal ever appears in a component.** Not in a `placeholder`, not in an `aria-label`, not in a `title`, not in a chart axis, not in a `toast`, not in a `document.title`.

```tsx
// wrong
<Button aria-label="Upload CV">Upload</Button>

// right
<Button aria-label={t('cv.upload.aria')}>{t('cv.upload.label')}</Button>
```

### Never concatenate

Word order differs across the three languages. Interpolate whole sentences.

```tsx
// wrong — untranslatable
<Text>{t('you_have')} {count} {t('variants')}</Text>

// right
<Text>{t('cv.variantCount', { count })}</Text>
```

```json
{
  "cv": {
    "variantCount_one": "You have {{count}} CV variant",
    "variantCount_other": "You have {{count}} CV variants"
  }
}
```

Arabic has six plural categories (`zero`, `one`, `two`, `few`, `many`, `other`). Let i18next's ICU plural resolution handle it — supply every category Arabic needs in `ar.json` rather than assuming `one`/`other` is enough.

### Key conventions

- Namespaced by feature: `cv.variant.create.title`, `application.status.underReview`.
- Keys are English-ish and stable. Never key by the English copy itself — copy changes break keys.
- All three catalogs stay in sync. A missing key in `ar.json` or `he.json` is a build failure, not a runtime fallback:

```jsonc
// i18n lint: run in CI
// scripts/check-catalogs.mjs — asserts key sets in en/ar/he are identical
```

- Never mark a key "translate later" and ship English into an Arabic session.

## Formatting

Delegate to `Intl`, never format by hand.

```ts
// Dates: the backend sends UTC ISO-8601; render in the user's zone.
new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

// Relative time ("3 days ago") — audit timelines, review timelines
new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-3, 'day');

// Numbers
new Intl.NumberFormat(locale).format(n);
```

Hebrew and Arabic UIs commonly use Western Arabic numerals (0-9). Do not force Eastern Arabic-Indic numerals (٠-٩) unless product explicitly asks — `Intl` with `ar` defaults correctly per region, and forcing `-u-nu-arab` surprises Israeli Arabic-speaking users.

Never display a raw UTC timestamp to a user. Never display a locale-formatted date in a filename or an export column header where it must be machine-parseable.

## Names and non-Latin content

User-submitted Arabic and Hebrew content is stored and returned **byte-identical** — no transliteration, no normalization beyond input NFC. The UI must not "clean up" names either.

Design consequences:

- Never assume a name splits into first/last. The model has `full_name`. Do not derive initials by splitting on space for an avatar — Arabic names commonly have four or more parts. Use the first grapheme cluster (`Intl.Segmenter`), or a role icon.
- Never uppercase a name for display. `text-transform: uppercase` is meaningless in Arabic and Hebrew and destroys meaning in some scripts.
- Never truncate mid-word with `text-overflow: ellipsis` where the truncated form could read as a different word. Prefer wrapping, a line clamp, or a full value in a tooltip.
- Arabic renders taller than Latin at the same font size. Give text containers room; do not set fixed heights on anything containing user content.
- Hebrew and Arabic strings for the same content differ in length from English by up to 40% either way. Test with the longest of the three, not English.

Font stack must cover all three scripts:

```css
:root {
  --font-sans: 'Inter', 'Noto Sans Hebrew', 'Noto Sans Arabic', system-ui, sans-serif;
  line-height: 1.6; /* Arabic diacritics need more than the Latin default */
}
```

## Language switcher

- Each language is labelled **in its own language and script**: `العربية`, `English`, `עברית`. Never "Arabic" in an English list only.
- Switching writes the preference to the account (it is server-stored, per-account) and updates `dir`/`lang` without a full reload.
- Announce the change to assistive tech and move focus predictably (usually back to the trigger).
- The switcher is reachable before login — the registration flow itself must be usable in all three languages.

## Review checklist

- [ ] Rendered and eyeballed in `ar` (RTL), `he` (RTL), and `en` (LTR)
- [ ] Zero physical direction properties; Stylelint clean
- [ ] `dir` and `lang` both set on `<html>` from the account preference
- [ ] Every visible string, including `aria-label`, `placeholder`, `title`, from `t()`
- [ ] No string concatenation; plurals declared for all Arabic categories
- [ ] All three catalogs have identical key sets
- [ ] LTR runs (URLs, phones, emails, IDs) wrapped with `dir="ltr"` + `unicode-bidi: isolate`
- [ ] Dates, times, relative times, numbers via `Intl` with the active locale
- [ ] No fixed heights or space-splitting on user-supplied names
- [ ] Icons that mean next/previous flip; icons that mean time or progress do not
- [ ] Tested with the longest of the three translations, not English
