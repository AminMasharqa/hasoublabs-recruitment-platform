# Design System — قسم التّربية غير المنهجيّة (Ara–Arara)

> **Source of truth for all UI work.** This replaces the previous Fluent 2 master.
> Code tokens live in `src/theme/` — never hard-code hex values in components; use Mantine
> props (`color="teal"`, `c="dimmed"`) or `--app-*` / `--mantine-*` CSS variables.

## How this application applies it

This spec came from a theme pack written for another product, so these rules take
precedence over the sections below for the HasoubLabs Recruitment Platform:

- **Name and roles:** the product is HasoubLabs Recruitment, with Admin, Candidate and
  Senior roles. Parent, student and coordinator guidance does not apply, so the mobile
  tab bar, icon tiles and gradient avatars are not implemented.
- **Role styles:** follow the active role, through `data-app-context` on the document.
  Admin is dark with teal and no header band. Senior is light with purple actions and a
  purple band. Candidate is light with teal actions, an amber active menu item and a
  deep amber-to-red band. Signed-out screens are light with teal and no band.
- **Direction and language:** the active Locale decides `dir` and `lang` (Arabic, Hebrew
  and English, Requirement 19). The app is not forced to RTL. Cairo has no Hebrew
  glyphs, so Noto Sans Hebrew is loaded for the `he` locale.
- **Colours in components:** use the semantic names in `src/theme/theme.ts` (`danger`,
  `success`, `warning`, `severe`, `info`, `neutral`), not hues. `severe` is an addition.
- **Contrast:** `warning` replaces amber shades 7 and 8 so filled badges and text pass
  AA. Input and checkbox edges use `--app-border-control` to reach 3:1.
  `src/theme/contrast.test.ts` holds these.

## Identity
- Arabic-first, **RTL**, warm and youthful but trustworthy (municipal youth department).
- Two surfaces:
  - **Mobile app** (parents, students, coordinators): **light** scheme, role-colored gradient headers.
  - **Admin desktop**: **dark** scheme, data-dense, teal/purple glow accents.
- Scheme is set by the active role (`useContextColorScheme`): an Administrator is dark on every screen. Never set by a user toggle or the URL.

## Color
| Role | Token | Hex | Use |
|---|---|---|---|
| Primary | `teal.7` | #008080 | Filled buttons, links, teal text on light |
| Brand teal | `teal.5` | #00B5B5 | Fills, dots, focus ring, progress — **never under white text** |
| Brand purple | `purple.6` | #7040A8 | Parent role, secondary CTA |
| Purple (dark) | `purple.5` / `purple.3` | #8B5CF6 / #A78BFA | Admin accents / text on dark |
| Amber | `amber.5` | #F5A623 | Student role, badges, highlights — **dark text on it** |
| Amber text | `amber.8` | #92400E | Small amber text on light |
| Ink | `--app-ink` | #1A2E3A | Headings on light |
| Success / Danger / Warning / Info | green.5 / red.5 / amber / blue.5 | #10B981 / #EF4444 / #F59E0B / #3B82F6 | Status, each with a `.0–.1` tint background |

- **Brand gradient**: `135deg #00B5B5 → #7040A8` (logo mark, splash, confirmation code card, section numbers). Max one per screen.
- **Role headers**: parent = purple, student = amber→red, coordinator/programs = teal, success = green. Class `app-header app-header--{role}`.
- **On dark**: text accents use shade 3–4 (`#06D0D0`, `#A78BFA`, `#FFB84D`, `#34D399`); tints use `rgba(color,.1)` fill + `rgba(color,.2)` border.
- Chart series order: teal-4, purple-3, amber-3, green-4, pink #F472B6, blue-4.

## Typography
- **Cairo** (variable, 400–900) only. Mono only for codes/IDs (`direction: ltr`).
- Scale: display 46/900 · h1 38/900 · h2 26/800 · h3 20/800 · h4 (phone screen title) 17/900 · h5 (card title) 14/800 · body 13/500 lh 1.6 · label 12/800 · overline/caption 11/800. **Never below 11px.**
- Numbers: `.app-num` (tabular, 900). Arabic-Indic digits in the mobile app; Latin digits in admin tables/KPIs.

## Shape & space
- Radius: xs 6 · sm 8 · **md 12 (buttons, inputs — default)** · lg 14 (cards) · xl 18 (floating cards, modals) · full (chips, badges, avatars, pills).
- Spacing: 4-based — 6, 10, 14, 20, 28. Phone screen padding 20; admin page padding 28; card gap 14.
- Shadows: sm for resting cards (light), lg for floating cards; colored glow only on filled primary buttons. Dark mode uses borders, not shadows.

## Components (Mantine)
- **Button**: filled teal (primary), filled purple (parent CTA), `default` (outline), `light` gray (secondary). Weight 800, min height 44 on mobile.
- **Badge/Chip**: `radius="xl"`, `variant="light"`, no uppercase. Filter chips: active = filled ink `#1A2E3A`.
- **Inputs**: 1.5px border, soft gray fill at rest → white + teal ring on focus. Required mark red.
- **Card**: `withBorder`, radius lg, white on light / `#151B26` on dark.
- **Icon tile**: `.app-icon-tile[data-tone]` 36×36 radius 10 for list items and KPIs.
- **Avatars**: gradient by tone (`.app-avatar-grad`), circle for people, radius 12 square for groups/brand.
- **Tab bar** (mobile): `.app-tabbar`, active color follows `data-role` on the layout root.
- **Admin NavLink**: active = teal→purple wash + border (global.css).
- **Progress / journey**: done = green, current = amber ring (`0 0 0 4px rgba(245,166,35,.2)`), upcoming = gray-1 / gray-5 text.

## Icons
- Line icons only (Tabler — ships with Mantine ecosystem), stroke 2, 16–20px, `currentColor`. **No emoji in UI.**
- Mirror directional icons (chevrons, arrows) in RTL.

## Accessibility (non-negotiable)
- Text contrast ≥ 4.5:1 (≥ 3:1 at 24px+). White text only on teal.7+, purple.6+, green.7+, red.6+.
- Touch targets ≥ 44px. Real `<button>`/`<a>`/`<label>`; `aria-label` on icon-only buttons.
- Respect `prefers-reduced-motion`.

## Anti-patterns
- Fluent leftovers: Segoe UI font, `#0F6CBD` blue, 4px radius, `--colorBrand*` / `--colorNeutral*` variables.
- Hard-coded hex in components; physical `left/right` margins (use `ms/me`, `ps/pe`, logical CSS).
- White text on `#00B5B5` or `#F5A623`; gray `#94A3B8` text on white.
- Gradients on body backgrounds, left-border accent cards, glassmorphism outside role headers.
