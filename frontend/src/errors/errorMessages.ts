/**
 * The Error_Presenter's message mapping, as pure logic.
 *
 * Requirement 21:
 * - AC1 every Error_Envelope `error` member maps to a localized catalogue entry
 *   ({@link localizeError}, {@link errorCatalogueKey}).
 * - AC2 an `error` member with no catalogue entry falls back to the generic
 *   localized failure message, and the Support_Reference is surfaced with it
 *   ({@link ERROR_FALLBACK_KEY}, {@link LocalizedErrorMessage.usedFallback}).
 * - AC3 a 403 carrying `not_authorized` is classified here and nowhere else
 *   ({@link isAuthorizationDenial}), so the surface that renders it can be a
 *   single component that never learns which resource was requested.
 *
 * Requirement 23 AC1/AC4: the Support_Reference of a failure is read from the
 * decoded {@link ApiError} ({@link supportReferenceOf}). A successful outcome
 * never reaches this module, so there is no path by which it could produce one.
 *
 * No React, no i18next initialization and no DOM: this module takes an i18next
 * instance and a decoded error and returns strings. `ErrorPresenter.tsx` renders
 * what it returns.
 *
 * ## Why the catalogue wins over the body `message`
 *
 * An Error_Envelope may carry a `message` the Backend_Api localized through
 * `Accept-Language`. It is deliberately not rendered. Requirement 21 AC1 makes
 * the `error` key the thing that maps to a message, which keeps the rendered
 * text a property of the client catalogue rather than of one server response —
 * and that is what lets Requirement 21 AC3–AC5 hold: server text for a denial
 * could differ per resource, while a catalogue entry cannot. Features that need
 * machine context from `details` pass it as interpolation values instead.
 */

import type { i18n as I18nextInstance, TOptions } from 'i18next'

import type { ApiError } from '../api/errors'
import { ERROR_FALLBACK_KEY, ERROR_NAMESPACE } from '../i18n'

/** The `error` member of the uniform authorization denial (AC3). */
export const AUTHORIZATION_DENIED_ERROR_KEY = 'not_authorized'

/** The status code of the uniform authorization denial (AC3). */
export const AUTHORIZATION_DENIED_STATUS = 403

/**
 * The one catalogue entry every authorization denial renders (AC3–AC5).
 *
 * A single constant rather than a per-call lookup, so the text cannot vary with
 * the requested route or resource identifier.
 */
export const AUTHORIZATION_DENIED_CATALOGUE_KEY = `${ERROR_NAMESPACE}:${AUTHORIZATION_DENIED_ERROR_KEY}`

/** The catalogue entry rendered for an unrecognized `error` member (AC2). */
export const ERROR_FALLBACK_CATALOGUE_KEY = `${ERROR_NAMESPACE}:${ERROR_FALLBACK_KEY}`

/**
 * The shape an `error` member must have to be looked up in the catalogue.
 *
 * i18next reads `:` as a namespace separator and `.` as a key separator, so a
 * key carrying either would address something other than an `errors` entry. The
 * Backend_Api taxonomy is `snake_case`, so restricting lookups to that shape
 * costs nothing and makes an unexpected key fall back (AC2) instead of
 * traversing the catalogue.
 */
const LOOKUPABLE_ERROR_KEY = /^[A-Za-z0-9_-]+$/

/** A localized error message together with how it was resolved. */
export interface LocalizedErrorMessage {
  /** The `error` member the message was resolved from, or `null` when absent. */
  readonly errorKey: string | null
  /** The catalogue key actually resolved, namespace included. */
  readonly catalogueKey: string
  /** The localized message to render. Never empty. */
  readonly message: string
  /** `true` when the generic fallback entry was used (AC2). */
  readonly usedFallback: boolean
  /** The failure's Support_Reference, or `null` when the response carried none. */
  readonly supportReference: string | null
  /** `true` for a 403 `not_authorized` outcome (AC3). */
  readonly isAuthorizationDenial: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonBlankString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/**
 * Whether a value is a decoded {@link ApiError} from `src/api/errors.ts`.
 *
 * Structural rather than nominal, because an error travels through TanStack
 * Query and an error boundary as `unknown`.
 */
export function isApiError(value: unknown): value is ApiError {
  return (
    isRecord(value) && typeof value.error === 'string' && typeof value.httpStatus === 'number'
  )
}

/**
 * The `error` member of a failure, or `null` when the value carries none.
 *
 * `null` covers everything that is not an Error_Envelope — a thrown `TypeError`,
 * a rejected promise with a string reason — and resolves to the generic fallback
 * message (AC2).
 */
export function errorKeyOf(value: unknown): string | null {
  return isRecord(value) ? nonBlankString(value.error) : null
}

/**
 * The Support_Reference of a failure (Req 23 AC1).
 *
 * Reads the decoded `supportReference` and falls back to the envelope's
 * `request_id`, which is the same value when the header was present and the
 * body's own value when it was not.
 */
export function supportReferenceOf(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }
  return nonBlankString(value.supportReference) ?? nonBlankString(value.request_id)
}

/**
 * Whether a failure is the uniform authorization denial (AC3).
 *
 * Exactly a 403 whose `error` member is `not_authorized`. Another `error` member
 * on a 403 — `account_not_approved`, which Requirement 7 AC6 handles by
 * replacing the retained status and redirecting — keeps its own catalogue entry
 * and its own surface; only `not_authorized` is the non-disclosing one.
 */
export function isAuthorizationDenial(value: unknown): boolean {
  return (
    isApiError(value) &&
    value.httpStatus === AUTHORIZATION_DENIED_STATUS &&
    value.error === AUTHORIZATION_DENIED_ERROR_KEY
  )
}

/**
 * The catalogue key an `error` member is looked up under (AC1), or the fallback
 * key when it is absent or not a lookupable key (AC2).
 *
 * Whether the key resolves to an entry is a separate question —
 * {@link hasErrorCatalogueEntry} answers it against a catalogue.
 */
export function errorCatalogueKey(errorKey: string | null | undefined): string {
  const key = nonBlankString(errorKey)
  if (key === null || !LOOKUPABLE_ERROR_KEY.test(key)) {
    return ERROR_FALLBACK_CATALOGUE_KEY
  }
  return `${ERROR_NAMESPACE}:${key}`
}

/**
 * i18next's `t` as a plain string function.
 *
 * The catalogues are not declared to i18next's type system, so its key generics
 * degrade to `string`; this narrows the return type at the single point the
 * module calls into i18next rather than at every call site.
 */
function translator(instance: I18nextInstance): (key: string, options?: TOptions) => unknown {
  return (key, options) => instance.t(key, options) as unknown
}

/**
 * Resolves a catalogue key to a rendered string, or `null` when the catalogue
 * holds no string entry for it.
 *
 * A missing key is `null` even though `parseMissingKeyHandler` echoes the key
 * back, and so is a key that addresses a nested object — the `errors` catalogue
 * holds a `field.*` map — so neither can be mistaken for a message.
 */
function resolveEntry(
  instance: I18nextInstance,
  catalogueKey: string,
  values?: TOptions,
): string | null {
  if (!instance.exists(catalogueKey)) {
    return null
  }
  const entry = translator(instance)(catalogueKey, values)
  if (typeof entry !== 'string') {
    return null
  }
  // `parseMissingKeyHandler` echoes the key, which is not a message.
  if (entry === catalogueKey || entry.trim().length === 0) {
    return null
  }
  return entry
}

/** Whether an `error` member has a dedicated catalogue entry (AC1 vs AC2). */
export function hasErrorCatalogueEntry(
  instance: I18nextInstance,
  errorKey: string | null | undefined,
): boolean {
  const catalogueKey = errorCatalogueKey(errorKey)
  if (catalogueKey === ERROR_FALLBACK_CATALOGUE_KEY) {
    return false
  }
  return resolveEntry(instance, catalogueKey) !== null
}

/**
 * The generic localized failure message (AC2).
 *
 * The catalogue always carries `errors:fallback` — `src/i18n/index.test.ts`
 * fails the build otherwise — so the empty-string guard exists only so this
 * function cannot return a blank message under a misconfigured instance.
 */
export function fallbackErrorMessage(instance: I18nextInstance): string {
  return resolveEntry(instance, ERROR_FALLBACK_CATALOGUE_KEY) ?? ERROR_FALLBACK_CATALOGUE_KEY
}

/**
 * The single authorization-denied message (AC3).
 *
 * Takes no error: the denial surface is rendered from a constant key, so nothing
 * about the requested resource can reach the resolved text, and resolving it
 * costs the same for every resource (AC5).
 */
export function authorizationDeniedMessage(instance: I18nextInstance): string {
  return resolveEntry(instance, AUTHORIZATION_DENIED_CATALOGUE_KEY) ?? fallbackErrorMessage(instance)
}

/**
 * Maps a failure to the message the Error_Presenter renders (AC1, AC2, AC3).
 *
 * The denial check runs first and short-circuits, so a 403 `not_authorized`
 * resolves one constant key with no catalogue probe and no interpolation —
 * identical work, and therefore identical timing, for every resource (AC5).
 *
 * @param values Interpolation values for entries that name machine context,
 *   e.g. `illegal_transition` naming `from` and `to`. Never the resource
 *   identifier of a denial: that branch ignores them.
 */
export function localizeError(
  instance: I18nextInstance,
  error: unknown,
  values?: TOptions,
): LocalizedErrorMessage {
  const supportReference = supportReferenceOf(error)

  if (isAuthorizationDenial(error)) {
    return {
      errorKey: AUTHORIZATION_DENIED_ERROR_KEY,
      catalogueKey: AUTHORIZATION_DENIED_CATALOGUE_KEY,
      message: authorizationDeniedMessage(instance),
      usedFallback: false,
      supportReference,
      isAuthorizationDenial: true,
    }
  }

  const errorKey = errorKeyOf(error)
  const catalogueKey = errorCatalogueKey(errorKey)
  const entry = resolveEntry(instance, catalogueKey, values)

  if (entry === null) {
    return {
      errorKey,
      catalogueKey: ERROR_FALLBACK_CATALOGUE_KEY,
      message: fallbackErrorMessage(instance),
      usedFallback: true,
      supportReference,
      isAuthorizationDenial: false,
    }
  }

  return {
    errorKey,
    catalogueKey,
    message: entry,
    usedFallback: false,
    supportReference,
    isAuthorizationDenial: false,
  }
}
