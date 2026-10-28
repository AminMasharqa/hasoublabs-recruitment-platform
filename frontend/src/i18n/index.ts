/**
 * i18next initialization and the bundled `ar` / `he` / `en` catalogues.
 *
 * Requirement 19:
 * - AC1 complete message catalogues for `ar`, `he` and `en` ({@link RESOURCES}).
 *   All three carry an identical key set, asserted by `index.test.ts`.
 * - AC2 every user-visible string is a catalogue entry; components resolve keys
 *   through `useTranslation`, never through an embedded literal.
 * - AC3 on login the active Locale comes from the account's `language_preference`
 *   ({@link applySessionLocale}).
 * - AC4 with no session the active Locale comes from the browser preference when
 *   that preference names a supported Locale, else `en`
 *   ({@link resolveInitialLocale}).
 *
 * Locale resolution itself lives in `src/lib/locale.ts` and is reused verbatim
 * here — no `i18next-browser-languagedetector` is registered, so the resolution
 * order this module applies is exactly the one Requirement 19 AC3/AC4 describes
 * and the one Property 9 covers.
 *
 * Direction is not this module's concern: `DirectionProvider` (task 6.5) reads
 * the active Locale and applies `src/lib/direction.ts` to the document root and
 * to Mantine.
 *
 * Catalogues are bundled rather than fetched, so no backend plugin is registered
 * and `init` settles without a network round trip.
 */

import i18next, {
  createInstance,
  type i18n as I18nextInstance,
  type InitOptions,
} from 'i18next'
import { initReactI18next } from 'react-i18next'

import {
  browserLanguagePreferences,
  FALLBACK_LOCALE,
  localeFromLanguageTag,
  resolveLocale,
  resolveLocaleForSession,
  SUPPORTED_LOCALES,
  type Locale,
} from '../lib/locale'

import arApplications from './locales/ar/applications.json'
import arAudit from './locales/ar/audit.json'
import arAdminAccounts from './locales/ar/adminAccounts.json'
import arAuth from './locales/ar/auth.json'
import arCvs from './locales/ar/cvs.json'
import arErrors from './locales/ar/errors.json'
import arJobs from './locales/ar/jobs.json'
import arOnboarding from './locales/ar/onboarding.json'
import arProfiles from './locales/ar/profiles.json'
import arRegistration from './locales/ar/registration.json'
import arReports from './locales/ar/reports.json'
import arReviews from './locales/ar/reviews.json'
import arShell from './locales/ar/shell.json'
import arValidation from './locales/ar/validation.json'
import enApplications from './locales/en/applications.json'
import enAudit from './locales/en/audit.json'
import enAdminAccounts from './locales/en/adminAccounts.json'
import enAuth from './locales/en/auth.json'
import enCvs from './locales/en/cvs.json'
import enErrors from './locales/en/errors.json'
import enJobs from './locales/en/jobs.json'
import enOnboarding from './locales/en/onboarding.json'
import enProfiles from './locales/en/profiles.json'
import enRegistration from './locales/en/registration.json'
import enReports from './locales/en/reports.json'
import enReviews from './locales/en/reviews.json'
import enShell from './locales/en/shell.json'
import enValidation from './locales/en/validation.json'
import heApplications from './locales/he/applications.json'
import heAudit from './locales/he/audit.json'
import heAdminAccounts from './locales/he/adminAccounts.json'
import heAuth from './locales/he/auth.json'
import heCvs from './locales/he/cvs.json'
import heErrors from './locales/he/errors.json'
import heJobs from './locales/he/jobs.json'
import heOnboarding from './locales/he/onboarding.json'
import heProfiles from './locales/he/profiles.json'
import heRegistration from './locales/he/registration.json'
import heReports from './locales/he/reports.json'
import heReviews from './locales/he/reviews.json'
import heShell from './locales/he/shell.json'
import heValidation from './locales/he/validation.json'

/**
 * The shared catalogues every feature slice may rely on.
 *
 * - `shell` — application chrome: navigation, locale and context controls,
 *   session notices, the shared action labels and the loading/empty/error state
 *   primitives.
 * - `errors` — one entry per Error_Envelope `error` key of the Backend_Api
 *   taxonomy, plus `fallback` for an unrecognized key (Requirement 21 AC1, AC2)
 *   and `field.<code>` for a Field_Violation `code`.
 * - `validation` — one entry per `messageKey` the Form_Validator emits
 *   (Requirement 22).
 *
 * Feature slices add their own namespaces as they are built; the first three are
 * the baseline the cross-cutting infrastructure resolves against.
 *
 * - `auth` — the login screen and the session steps around it (Requirement 4).
 * - `registration` — the Registration_Link screen and its role-fixed form
 *   (Requirement 6).
 * - `profiles` — the Candidate and Senior profile editors and their read-only
 *   Admin views (Requirements 9 and 10).
 * - `jobs` — Job_Description browsing: the filter controls, the list, the detail
 *   and the contactable-Senior panel (Requirement 12).
 * - `cvs` — CV_Variant management and the CV_Versions of each variant
 *   (Requirement 11).
 * - `audit` — the Audit_Log_Viewer: the search filters, the entry list, the
 *   before/after field comparison and the chain-verification surface
 *   (Requirement 17).
 * - `reviews` — the review form, the correction control and the Admin and Senior
 *   Review_Timelines (Requirement 15).
 * - `adminAccounts` — Admin account management: the account list and its filters,
 *   Registration_Links, the lifecycle controls and the pending-skill review
 *   (Requirement 16).
 * - `reports` — the activity and candidate-progress reports and the Excel export
 *   control with its polling surface (Requirement 18).
 * - `applications` — the apply dialog and its outcomes, the Candidate's own
 *   Application list and detail, the Applicant_Cards and the Admin status control
 *   (Requirement 14).
 * - `onboarding` — the Status_Notice: the localized description of each
 *   Account_Status and the next step that accompanies it (Requirement 7).
 */
export const I18N_NAMESPACES = [
  'shell',
  'errors',
  'validation',
  'auth',
  'registration',
  'onboarding',
  'profiles',
  'jobs',
  'cvs',
  'audit',
  'reviews',
  'adminAccounts',
  'reports',
  'applications',
] as const

/** One of the baseline catalogue namespaces. */
export type I18nNamespace = (typeof I18N_NAMESPACES)[number]

/** Namespace assumed when a key carries no `namespace:` prefix. */
export const DEFAULT_NAMESPACE: I18nNamespace = 'shell'

/** Catalogue key prefix under which the Error_Presenter looks up an `error` key. */
export const ERROR_NAMESPACE: I18nNamespace = 'errors'

/** Catalogue key prefix under which a Field_Violation `code` is looked up. */
export const FIELD_VIOLATION_KEY_PREFIX = 'field'

/** Catalogue entry rendered for an `error` key with no dedicated entry (Req 21 AC2). */
export const ERROR_FALLBACK_KEY = 'fallback'

/** Every bundled catalogue, keyed by Locale and then by namespace (AC1). */
export const RESOURCES = {
  ar: {
    shell: arShell,
    errors: arErrors,
    validation: arValidation,
    auth: arAuth,
    registration: arRegistration,
    onboarding: arOnboarding,
    profiles: arProfiles,
    jobs: arJobs,
    cvs: arCvs,
    audit: arAudit,
    reviews: arReviews,
    adminAccounts: arAdminAccounts,
    reports: arReports,
    applications: arApplications,
  },
  he: {
    shell: heShell,
    errors: heErrors,
    validation: heValidation,
    auth: heAuth,
    registration: heRegistration,
    onboarding: heOnboarding,
    profiles: heProfiles,
    jobs: heJobs,
    cvs: heCvs,
    audit: heAudit,
    reviews: heReviews,
    adminAccounts: heAdminAccounts,
    reports: heReports,
    applications: heApplications,
  },
  en: {
    shell: enShell,
    errors: enErrors,
    validation: enValidation,
    auth: enAuth,
    registration: enRegistration,
    onboarding: enOnboarding,
    profiles: enProfiles,
    jobs: enJobs,
    cvs: enCvs,
    audit: enAudit,
    reviews: enReviews,
    adminAccounts: enAdminAccounts,
    reports: enReports,
    applications: enApplications,
  },
} as const satisfies Record<Locale, Record<I18nNamespace, object>>

/**
 * Resolves the Locale to start with when no session has been established yet
 * (AC4).
 *
 * Delegates to `resolveLocale` over the ordered browser preference list, so an
 * unsupported or absent preference yields {@link FALLBACK_LOCALE}.
 */
export function resolveInitialLocale(
  navigatorLike?: Pick<Navigator, 'language' | 'languages'>,
): Locale {
  return resolveLocale(browserLanguagePreferences(navigatorLike))
}

/**
 * The i18next options every instance is initialized with.
 *
 * `escapeValue` is off because React escapes interpolated values itself; leaving
 * i18next's escaping on would rewrite characters inside Arabic and Hebrew values
 * taken from the Backend_Api, which Requirement 19 AC10 forbids.
 */
export function i18nOptions(locale: Locale = resolveInitialLocale()): InitOptions {
  return {
    resources: RESOURCES,
    lng: locale,
    fallbackLng: FALLBACK_LOCALE,
    supportedLngs: [...SUPPORTED_LOCALES],
    // A regional tag such as `ar-SA` resolves onto the `ar` catalogue.
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    ns: [...I18N_NAMESPACES],
    defaultNS: DEFAULT_NAMESPACE,
    fallbackNS: false,
    interpolation: { escapeValue: false },
    // A missing key is a catalogue defect, so surface the key rather than an
    // empty string; `index.test.ts` fails the build before that can ship.
    parseMissingKeyHandler: (key: string) => key,
  }
}

/**
 * Creates a standalone, initialized i18next instance.
 *
 * Used by tests and by any surface that needs its own instance; it is not
 * registered with react-i18next, so it never displaces the shared instance.
 */
export function createI18n(locale: Locale = resolveInitialLocale()): I18nextInstance {
  const instance = createInstance()
  // Resources are bundled, so initialization completes before `init` returns and
  // the callback runs synchronously. The callback keeps the promise handled.
  void instance.init(i18nOptions(locale), () => undefined)
  return instance
}

/**
 * Initializes the shared i18next instance the React tree reads from.
 *
 * Idempotent: a second call leaves an already-initialized instance untouched so
 * a hot reload or a re-entrant mount does not reset the active Locale.
 */
export function initI18n(locale: Locale = resolveInitialLocale()): I18nextInstance {
  if (!i18next.isInitialized) {
    i18next.use(initReactI18next)
    void i18next.init(i18nOptions(locale), () => undefined)
  }
  return i18next
}

/** The shared i18next instance. Call {@link initI18n} before reading from it. */
export const i18n: I18nextInstance = i18next

/**
 * The Locale an instance is currently rendering in.
 *
 * Reads i18next's resolved language, so a regional tag reports the supported
 * Locale it resolved onto; an uninitialized instance reports
 * {@link FALLBACK_LOCALE}.
 */
export function activeLocale(instance: I18nextInstance = i18next): Locale {
  return (
    localeFromLanguageTag(instance.resolvedLanguage) ??
    localeFromLanguageTag(instance.language) ??
    FALLBACK_LOCALE
  )
}

/**
 * Switches the active Locale without reloading the page (AC5).
 *
 * Resolves to the Locale actually applied, which is {@link FALLBACK_LOCALE} when
 * the requested value does not name a supported Locale.
 */
export async function setActiveLocale(
  locale: unknown,
  instance: I18nextInstance = i18next,
): Promise<Locale> {
  const target = localeFromLanguageTag(locale) ?? FALLBACK_LOCALE
  await instance.changeLanguage(target)
  return target
}

/**
 * Applies the Locale of a newly established session (AC3).
 *
 * Uses the account's `language_preference` when it names a supported Locale and
 * falls back to the browser-preference resolution of AC4 otherwise, which also
 * covers an account payload that carries no preference at all.
 */
export async function applySessionLocale(
  languagePreference: unknown,
  options: {
    readonly instance?: I18nextInstance
    readonly navigatorLike?: Pick<Navigator, 'language' | 'languages'>
  } = {},
): Promise<Locale> {
  const target = resolveLocaleForSession(
    languagePreference,
    browserLanguagePreferences(options.navigatorLike),
  )
  return setActiveLocale(target, options.instance ?? i18next)
}
