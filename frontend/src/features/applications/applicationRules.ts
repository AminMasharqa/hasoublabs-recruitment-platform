/**
 * The Application decisions of Requirement 14, as pure functions.
 *
 * Requirement 14 states its rules about *outcomes* rather than about rendering,
 * and each one is answerable from a response or a decoded Error_Envelope alone:
 *
 * - **AC2** the apply request body carries the selected CV_Variant
 *   ({@link applyBody}).
 * - **AC3/AC4** a 201 records an Application while a 200 carrying `redirect_url`
 *   records none ({@link applyOutcome}).
 * - **AC5** the external address is offered only when it is one a browsing context
 *   may be pointed at ({@link externalRedirectUrl}), and only ever as a control the
 *   user activates — no function here navigates.
 * - **AC6/AC7/AC8** the three refusals are classified, and the machine context each
 *   one carries is extracted ({@link applyRefusal}, {@link unmetConditions},
 *   {@link retryAfterSeconds}).
 * - **AC9/AC10** the own-Application list is ordered newest first and paged with
 *   the last returned identifier ({@link orderApplicationsNewestFirst},
 *   {@link nextApplicationsPage}).
 * - **AC12** an Applicant_Card renders exactly three fields, enumerated here
 *   ({@link APPLICANT_CARD_FIELDS}, {@link applicantCardFields}).
 * - **AC13** the status control's target set and request body
 *   ({@link APPLICATION_STATUS_TARGETS}, {@link applicationStatusBody}).
 *
 * Free of React, the Api_Client and i18next, so every rule is checkable from a
 * unit test against a plain value — `applicationRules.test.ts` does exactly that.
 * The page size and the reason bounds are read from `lib/cursor.ts` and
 * `forms/validators.ts` rather than restated, so this module cannot drift from the
 * shared 20-row bound or from the Pydantic schemas on its own.
 *
 * Requirements: 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 14.12, 14.13.
 */

import type { ApplicationStatus } from '../../api/enums'
import type { components } from '../../api/generated/schema'
import {
  APPLICATION_STATUS_VALUES,
  BOUNDS,
  validateText,
  type ValidationIssue,
} from '../../forms/validators'
import { byId, deriveLastIdCursor, DEFAULT_PAGE_SIZE, type NextPage } from '../../lib/cursor'

// ── Contract shapes ───────────────────────────────────────────────────────────

/** One Application, exactly as the contract describes it (AC11). */
export type Application = components['schemas']['ApplicationDTO']

/**
 * One Applicant_Card: the three fields a Senior may ever see about a Candidate
 * (AC12).
 */
export type ApplicantCard = components['schemas']['ApplicantCardDTO']

/** Body of `POST /jobs/{jd_id}/apply` (AC2). */
export type ApplyBody = components['schemas']['ApplyRequest']

/** Body of `PATCH /admin/applications/{application_id}/status` (AC13). */
export type UpdateApplicationStatusBody = components['schemas']['UpdateStatusRequest']

// ── Paging (AC9, AC10) ────────────────────────────────────────────────────────

/** AC10: at most 20 Applications per page, the shared bound of `lib/cursor.ts`. */
export const APPLICATIONS_PAGE_SIZE: number = DEFAULT_PAGE_SIZE

/** The query of one `GET /me/applications` request (AC10). */
export interface MyApplicationsQueryParams {
  readonly limit: number
  readonly after_id?: string
}

/**
 * Builds the query of `GET /me/applications` (AC10).
 *
 * An absent cursor omits `after_id` rather than sending it empty, so the first
 * page of the list is one cache key instead of two.
 */
export function myApplicationsQueryParams(
  cursor: string | null = null,
): MyApplicationsQueryParams {
  const afterId = typeof cursor === 'string' ? cursor.trim() : ''
  return {
    limit: APPLICATIONS_PAGE_SIZE,
    ...(afterId === '' ? {} : { after_id: afterId }),
  }
}

/**
 * The Applications of one page, newest first (AC9).
 *
 * Ordered client-side rather than trusted from the response: AC9 fixes the order
 * the Candidate sees, and a list that renders in whatever order it arrived would
 * make that order a property of the Backend_Api instead of of the screen. The
 * submission instant decides, with the identifier as the tie-break so two
 * Applications submitted in the same millisecond still order deterministically.
 *
 * Returns a new array; the argument is left untouched.
 */
export function orderApplicationsNewestFirst(
  applications: readonly Application[] | null | undefined,
): readonly Application[] {
  return [...(applications ?? [])].sort((left, right) => {
    const byInstant = right.submitted_at.localeCompare(left.submitted_at)
    return byInstant === 0 ? right.id.localeCompare(left.id) : byInstant
  })
}

/**
 * The next page of the own-Application list (AC10).
 *
 * `GET /me/applications` answers a bare array with no continuation metadata, so a
 * further page is inferred from a full page being returned and the cursor is the
 * last returned Application identifier — which is what `after_id` accepts.
 *
 * Derived from the response in the order it arrived, not from the display order:
 * the cursor names the position the Backend_Api stopped at.
 */
export function nextApplicationsPage(
  applications: readonly Application[] | null | undefined,
): NextPage<string> {
  return deriveLastIdCursor(applications, { cursorOf: byId })
}

/** The query of one `GET /jobs/{jd_id}/applicants` request (AC12). */
export interface ApplicantsQueryParams {
  readonly limit: number
  readonly status?: ApplicationStatus
}

/**
 * Builds the query of `GET /jobs/{jd_id}/applicants` (AC12).
 *
 * Deliberately carries no `after_id`: an Applicant_Card holds exactly three fields
 * and none of them is an identifier (AC12), so the client has no value to continue
 * a keyset walk with — see {@link APPLICANT_CARD_FIELDS}. The page is therefore
 * bounded at the shared 20 rows and the screen presents no next-page control,
 * which is the same conclusion `lib/cursor.ts` reaches for a response that
 * advertises no usable continuation token.
 */
export function applicantsQueryParams(
  status: ApplicationStatus | null = null,
): ApplicantsQueryParams {
  return {
    limit: APPLICATIONS_PAGE_SIZE,
    ...(status === null ? {} : { status }),
  }
}

// ── Applying (AC2, AC3, AC4, AC5) ─────────────────────────────────────────────

/**
 * The `POST /jobs/{jd_id}/apply` body for a chosen CV_Variant (AC2).
 *
 * A `null` selection omits the member, which the contract documents as "resolve
 * the primary active variant" — the same variant the selection defaults to, so the
 * two paths agree.
 */
export function applyBody(cvVariantId: string | null | undefined): ApplyBody {
  const id = typeof cvVariantId === 'string' ? cvVariantId.trim() : ''
  return id === '' ? {} : { cv_variant_id: id }
}

/** HTTP status on which the Backend_Api recorded an Application (AC3). */
export const APPLICATION_RECORDED_STATUS = 201

/** Response member carrying the external destination of an off-platform apply (AC4). */
export const REDIRECT_URL_MEMBER = 'redirect_url'

/** Schemes a `redirect_url` may carry for the control of AC4 to be offered. */
const OPENABLE_URL_SCHEMES: readonly string[] = ['https:', 'http:']

/** The outcome of one apply submission (AC3, AC4). */
export type ApplyOutcome =
  /** AC3: an Application was recorded; its status and submission instant are hers. */
  | { readonly kind: 'recorded'; readonly application: Application }
  /**
   * AC4: no Application was recorded, and the external destination may be opened
   * by an explicit user action.
   */
  | { readonly kind: 'external'; readonly redirectUrl: string }
  /**
   * A success the client cannot act on: a 200 with no usable `redirect_url`, or a
   * 201 whose body is not an Application. Reported rather than guessed at, so the
   * screen says so instead of claiming an Application that may not exist.
   */
  | { readonly kind: 'unreadable' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonBlankString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** Whether a success body carries the members an {@link Application} needs. */
function isApplication(value: unknown): value is Application {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.status === 'string' &&
    typeof value.submitted_at === 'string'
  )
}

/**
 * The `redirect_url` a response carries, or `null` when it carries none the client
 * may point a browsing context at (AC4, AC5).
 *
 * Only an absolute `https:` or `http:` address qualifies. A `javascript:`, `data:`
 * or `blob:` value — or a relative one — is refused rather than rendered as a link,
 * because "open this in a new browsing context" is a capability and the Web_Client
 * hands it out only for addresses that are actually external navigations.
 */
export function externalRedirectUrl(value: unknown): string | null {
  const raw = nonBlankString(isRecord(value) ? value[REDIRECT_URL_MEMBER] : value)
  if (raw === null) {
    return null
  }
  try {
    const parsed = new URL(raw.trim())
    return OPENABLE_URL_SCHEMES.includes(parsed.protocol) ? raw.trim() : null
  } catch {
    return null
  }
}

/**
 * Classifies a successful apply response (AC3, AC4).
 *
 * The status decides first: a 201 is the recorded Application of AC3, and only a
 * non-201 success is read for the `redirect_url` of AC4. A 201 that also carried a
 * `redirect_url` is still a recorded Application — the Backend_Api recorded one,
 * and telling the Candidate otherwise would be wrong.
 */
export function applyOutcome(httpStatus: number, data: unknown): ApplyOutcome {
  if (httpStatus === APPLICATION_RECORDED_STATUS && isApplication(data)) {
    return { kind: 'recorded', application: data }
  }
  const redirectUrl = externalRedirectUrl(data)
  if (redirectUrl !== null) {
    return { kind: 'external', redirectUrl }
  }
  // A 201 whose body did not decode still recorded something server-side, so it is
  // not reported as an external redirect either.
  return isApplication(data) ? { kind: 'recorded', application: data } : { kind: 'unreadable' }
}

// ── Refusals (AC6, AC7, AC8) ──────────────────────────────────────────────────

/** AC6: the Error_Envelope `error` member listing unmet conditions. */
export const PRECONDITION_UNMET_ERROR = 'precondition_unmet'

/** AC7: the Error_Envelope `error` member of an Application that already exists. */
export const CONFLICTING_STATE_ERROR = 'conflicting_state'

/** AC8: the Error_Envelope `error` member of a throttled submission. */
export const RATE_LIMITED_ERROR = 'rate_limited'

/** `details` member carrying the unmet conditions of AC6. */
export const UNMET_DETAILS_MEMBER = 'unmet'

/** `details` member carrying the retry hint of AC8. */
export const RETRY_AFTER_DETAILS_MEMBER = 'retry_after_seconds'

/** Which of the three refusals Requirement 14 names, or `other` for anything else. */
export type ApplyRefusal =
  | typeof PRECONDITION_UNMET_ERROR
  | typeof CONFLICTING_STATE_ERROR
  | typeof RATE_LIMITED_ERROR
  | 'other'

/**
 * Classifies an apply failure (AC6, AC7, AC8).
 *
 * `other` covers every failure Requirement 14 does not name — a denial, a timeout,
 * a 422 — and those are rendered by the Error_Presenter from the shared `errors`
 * catalogue (Requirement 21 AC1, AC2) rather than by a message this slice invents.
 */
export function applyRefusal(failure: unknown): ApplyRefusal {
  const key = isRecord(failure) ? failure.error : null
  switch (key) {
    case PRECONDITION_UNMET_ERROR:
    case CONFLICTING_STATE_ERROR:
    case RATE_LIMITED_ERROR:
      return key
    default:
      return 'other'
  }
}

/** One unmet condition, as the screen renders it (AC6). */
export interface UnmetCondition {
  /**
   * The machine code of the condition when the entry carried one, for a localized
   * catalogue entry; `null` when the entry named none.
   */
  readonly code: string | null
  /** Text to render when the catalogue has no entry for {@link code}. */
  readonly text: string
}

/** Members an object-shaped `unmet` entry may carry its code or text in. */
const UNMET_CODE_MEMBERS: readonly string[] = ['code', 'condition', 'field', 'key']
const UNMET_TEXT_MEMBERS: readonly string[] = ['message', 'detail', 'description', 'text']

function unmetEntry(entry: unknown): UnmetCondition | null {
  const asString = nonBlankString(entry)
  if (asString !== null) {
    return { code: asString.trim(), text: asString }
  }
  if (!isRecord(entry)) {
    return null
  }
  const code = UNMET_CODE_MEMBERS.map((member) => nonBlankString(entry[member])).find(
    (value): value is string => value !== null,
  )
  const text = UNMET_TEXT_MEMBERS.map((member) => nonBlankString(entry[member])).find(
    (value): value is string => value !== null,
  )
  if (code === undefined && text === undefined) {
    return null
  }
  return { code: code?.trim() ?? null, text: text ?? code ?? '' }
}

/**
 * Every entry of `details.unmet`, in the order the Backend_Api reported them
 * (AC6).
 *
 * AC6 asks for *each* entry as a separate condition, so nothing is collapsed,
 * deduplicated or truncated: a Candidate who is told about one of three unmet
 * conditions fixes one third of the problem. An entry that carries neither a code
 * nor text is dropped, because there is nothing to render for it; everything else
 * survives.
 *
 * Accepts both shapes the envelope may use — a list of codes, or a list of objects
 * carrying a code and a message — so a `details` shape that is a list of strings
 * today and of objects tomorrow renders either way.
 */
export function unmetConditions(failure: unknown): readonly UnmetCondition[] {
  const details = isRecord(failure) ? failure.details : null
  const raw = isRecord(details) ? details[UNMET_DETAILS_MEMBER] : null
  if (!Array.isArray(raw)) {
    return []
  }
  return raw
    .map((entry) => unmetEntry(entry))
    .filter((entry): entry is UnmetCondition => entry !== null)
}

/**
 * The `details.retry_after_seconds` of a `rate_limited` refusal (AC8), or `null`
 * when the envelope named none.
 *
 * Falls back to the `retryAfterSeconds` the Api_Client resolved from the
 * `Retry-After` header (Requirement 3 AC10), which is the same quantity expressed
 * in the transport rather than in the body.
 */
export function retryAfterSeconds(failure: unknown): number | null {
  if (!isRecord(failure)) {
    return null
  }
  const details = failure.details
  const fromDetails = isRecord(details) ? details[RETRY_AFTER_DETAILS_MEMBER] : null
  if (typeof fromDetails === 'number' && Number.isFinite(fromDetails)) {
    return Math.max(0, Math.ceil(fromDetails))
  }
  const fromHeader = failure.retryAfterSeconds
  return typeof fromHeader === 'number' && Number.isFinite(fromHeader)
    ? Math.max(0, Math.ceil(fromHeader))
    : null
}

// ── Applicant_Card (AC12) ─────────────────────────────────────────────────────

/**
 * The three — and only three — fields an Applicant_Card renders (AC12).
 *
 * Declared as a tuple of the DTO's own keys, so it cannot silently grow: the
 * contract marks `ApplicantCardDTO` as restricted ("adding any field here requires
 * an explicit RBAC review"), and `applicantCardFields` maps over this tuple rather
 * than over `Object.keys(card)` — so a fourth member appearing in the payload is
 * not rendered, and a fourth member added here would not typecheck against the
 * three-element tuple type below.
 */
export const APPLICANT_CARD_FIELDS = [
  'full_name',
  'applied_role_title',
  'application_status',
] as const satisfies readonly [
  keyof ApplicantCard,
  keyof ApplicantCard,
  keyof ApplicantCard,
]

/** One of the three rendered Applicant_Card fields. */
export type ApplicantCardField = (typeof APPLICANT_CARD_FIELDS)[number]

/** One rendered field of an Applicant_Card. */
export interface ApplicantCardEntry {
  readonly field: ApplicantCardField
  readonly value: string
}

/**
 * The Applicant_Card as exactly three rendered entries (AC12).
 *
 * Always three, in a fixed order, whatever the payload holds: a missing member
 * renders as the empty string rather than dropping a row, so the card's shape is
 * the requirement's shape and not the response's.
 */
export function applicantCardFields(card: ApplicantCard): readonly ApplicantCardEntry[] {
  return APPLICANT_CARD_FIELDS.map((field) => ({
    field,
    value: typeof card[field] === 'string' ? card[field] : '',
  }))
}

// ── Admin status control (AC13, AC14) ─────────────────────────────────────────

/**
 * The four target statuses the Admin control offers (AC13).
 *
 * Keyed off the contract's `ApplicationStatus` union through `enumValues`, so a
 * status the Backend_Api adds or renames fails the typecheck instead of quietly
 * disappearing from the control.
 */
export const APPLICATION_STATUS_TARGETS: readonly ApplicationStatus[] =
  APPLICATION_STATUS_VALUES.values

/** Whether a value names a target status the control may send (AC13). */
export function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return APPLICATION_STATUS_VALUES.includes(value)
}

/** Input path the optional reason is addressed by, for Field_Violation placement. */
export const STATUS_REASON_PATH = 'reason'

/** Inclusive length bounds of the optional reason, as the Backend_Api declares them. */
export const STATUS_REASON_BOUNDS = BOUNDS.admin.reason

/**
 * Applies the reason bounds (AC13).
 *
 * The reason is optional, so a blank one yields no issue and is omitted from the
 * request; a reason that *is* entered has to satisfy the same bounds the
 * Backend_Api declares for an Admin reason.
 */
export function validateStatusReason(reason: string): ValidationIssue | null {
  return validateText(reason, { kind: 'text', path: STATUS_REASON_PATH, ...STATUS_REASON_BOUNDS })
}

/**
 * The `PATCH /admin/applications/{application_id}/status` body (AC13).
 *
 * The reason is omitted when it was left empty rather than sent as an empty string,
 * so "no reason given" is expressed as the absence the contract declares. Entered
 * text is sent exactly as entered (Requirement 19 AC11) — no trimming.
 */
export function applicationStatusBody(
  status: ApplicationStatus,
  reason: string | null | undefined,
): UpdateApplicationStatusBody {
  const entered = typeof reason === 'string' ? reason : ''
  return entered.trim() === '' ? { status } : { status, reason: entered }
}
