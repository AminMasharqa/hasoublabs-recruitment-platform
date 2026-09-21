/**
 * Server violation → input placement mapper.
 *
 * Requirement 22:
 * - AC9  every reported violation is rendered simultaneously rather than only the
 *        first: {@link partitionViolations} places all of them in one pass.
 * - AC10 a violation whose `path` addresses no rendered input is placed in the
 *        form-level message region ({@link ViolationPartition.formLevel}).
 * - AC11 every value the user entered is retained: this module only reads the
 *        violation list and the rendered-input registry. It never touches, resets
 *        or rewrites a form value, so a failed submission leaves the entered
 *        values exactly as they were.
 *
 * Requirement 20 AC6: the rendered message is associated with its input through
 * the input's accessible description ({@link describeField},
 * {@link mergeDescribedBy}) and focus moves to the first affected input
 * ({@link focusFirstAffectedInput}, {@link useViolationFocus}).
 *
 * The partition itself ({@link partitionViolations}) is pure: no DOM, no React,
 * no i18n. It is *total* and *exact* — every element of the input list is placed
 * exactly once, either on a matched rendered input or in the form-level region,
 * and the original violation objects are carried through by reference so nothing
 * is dropped, duplicated or rewritten. The focus and `aria-describedby` helpers
 * live alongside it and are the only parts that touch the DOM.
 *
 * ### Reconciling the two path spellings
 *
 * The Backend_Api addresses a {@link FieldViolation} with a dotted path carrying
 * bracketed indices (`education[2].start_date`), while a client-side
 * {@link ValidationIssue} uses the dotted/indexed spelling
 * (`education.2.end_year`). Both are parsed into the same segment list by
 * {@link parsePath} and compared in the single canonical dotted form produced by
 * {@link normalizePath}, so one mapper places issues from either source against
 * one rendered-input registry.
 */

import { useEffect, useRef } from 'react'

import type { FieldViolation } from '../api/errors'

import type { ValidationIssue } from './validators'

// ── Path normalization ────────────────────────────────────────────────────────

/**
 * The minimum an issue must expose to be placed: a path addressing a field.
 *
 * Both {@link FieldViolation} (server) and {@link ValidationIssue} (client)
 * satisfy it, so the partition is generic over the issue rather than duplicated
 * per source.
 */
export interface PathAddressed {
  /** Dotted path, with bracketed or dotted indices, e.g. `education[2].start_date`. */
  readonly path: string
}

/** An issue from either source that {@link partitionViolations} can place. */
export type PlaceableIssue = FieldViolation | ValidationIssue

function stripSurroundingQuotes(segment: string): string {
  if (segment.length < 2) {
    return segment
  }
  const first = segment[0]
  const last = segment[segment.length - 1]
  if ((first === '"' || first === "'") && first === last) {
    return segment.slice(1, -1)
  }
  return segment
}

/**
 * Splits a field path into its segments, accepting either spelling of an index.
 *
 * `education[2].start_date` and `education.2.start_date` both yield
 * `['education', '2', 'start_date']`. Bracketed segments are read verbatim
 * (a surrounding quote pair is stripped), a `.` outside brackets separates
 * segments, and empty or whitespace-only segments are dropped so a stray
 * separator cannot produce a phantom segment.
 *
 * A non-string path yields an empty segment list, which addresses no input.
 */
export function parsePath(path: unknown): readonly string[] {
  if (typeof path !== 'string' || path.length === 0) {
    return []
  }
  const segments: string[] = []
  let current = ''
  let inBracket = false

  const flush = (): void => {
    const segment = stripSurroundingQuotes(current.trim()).trim()
    if (segment.length > 0) {
      segments.push(segment)
    }
    current = ''
  }

  for (const character of path) {
    if (character === '[') {
      flush()
      inBracket = true
      continue
    }
    if (character === ']') {
      flush()
      inBracket = false
      continue
    }
    if (character === '.' && !inBracket) {
      flush()
      continue
    }
    current += character
  }
  flush()
  return segments
}

/**
 * The canonical dotted form of a field path: segments joined by `.`, with every
 * index spelled as a bare segment.
 *
 * `education[2].start_date` and `education.2.start_date` both normalize to
 * `education.2.start_date`. The result is itself canonical, so normalizing twice
 * changes nothing. An unusable path (not a string, empty, only separators)
 * normalizes to `''`, which never matches a rendered input.
 */
export function normalizePath(path: unknown): string {
  return parsePath(path).join('.')
}

/** Whether two paths address the same field, regardless of index spelling. */
export function isSamePath(left: unknown, right: unknown): boolean {
  const normalized = normalizePath(left)
  return normalized !== '' && normalized === normalizePath(right)
}

// ── Rendered-input registry ───────────────────────────────────────────────────

/**
 * One input the form currently renders.
 *
 * A form registers its inputs in rendering order, which is the order the
 * partition reports affected inputs in, so "the first affected input" of
 * Requirement 20 AC6 is the first one a person reaches.
 */
export interface RenderedInput {
  /** The path this input is addressed by, in either spelling. */
  readonly path: string
  /**
   * DOM `id` of the input element. Defaults to a slug derived from the
   * canonical path — see {@link inputElementId}.
   */
  readonly id?: string
  /**
   * Further paths this input also answers for, for a composed field — e.g. an
   * Address Residency_Proof whose parts render as separate inputs but whose
   * violations arrive against `residency_proof_value`.
   */
  readonly aliases?: readonly string[]
}

/** Every canonical path a rendered input answers for. */
function claimedPaths(input: RenderedInput): readonly string[] {
  const paths = [normalizePath(input.path)]
  for (const alias of input.aliases ?? []) {
    paths.push(normalizePath(alias))
  }
  return paths.filter((path) => path !== '')
}

// ── The partition (pure) ──────────────────────────────────────────────────────

/** The violations placed on one rendered input, in the order they were reported. */
export interface FieldPlacement<TIssue extends PathAddressed, TInput extends RenderedInput> {
  /** The rendered input the violations are attached to, exactly as registered. */
  readonly input: TInput
  /** Canonical path of {@link input}. */
  readonly path: string
  /** Every violation addressed to this input; never empty. */
  readonly violations: readonly TIssue[]
}

/**
 * The total partition of a reported violation list against the rendered inputs.
 *
 * `fields` and `formLevel` are disjoint and jointly exhaustive: the number of
 * violations across every {@link FieldPlacement} plus `formLevel.length` equals
 * the length of the list that was partitioned, and each element is carried
 * through by reference exactly once.
 */
export interface ViolationPartition<
  TIssue extends PathAddressed = PlaceableIssue,
  TInput extends RenderedInput = RenderedInput,
> {
  /** Affected inputs in rendering order; an unaffected input is absent. */
  readonly fields: readonly FieldPlacement<TIssue, TInput>[]
  /** Violations addressing no rendered input, for the form-level region (AC10). */
  readonly formLevel: readonly TIssue[]
  /** Total number of violations placed; equals the length of the source list. */
  readonly placedCount: number
}

/** A partition of nothing: no affected input, no form-level message. */
export const EMPTY_PARTITION: ViolationPartition<never, never> = {
  fields: [],
  formLevel: [],
  placedCount: 0,
}

/**
 * Partitions reported violations against the inputs a form renders (AC9, AC10).
 *
 * A violation is attached to a rendered input when its canonical path equals a
 * path that input claims — its own or one of its {@link RenderedInput.aliases}.
 * Every other violation, including one with an absent, empty or unparseable
 * path and one addressing a field the form does not render, goes to the
 * form-level region.
 *
 * The placement is total and exact by construction: the source list is walked
 * once and each element is appended to exactly one bucket, so none is dropped
 * and none is duplicated. Repeated elements are each placed, and the reported
 * order is preserved within every bucket.
 *
 * Two inputs claiming the same canonical path is a form-authoring mistake; the
 * first registration wins so a violation still lands on exactly one input.
 *
 * Entered values are untouched (AC11): the result only references the violation
 * objects and the input registrations it was given.
 */
export function partitionViolations<TIssue extends PathAddressed, TInput extends RenderedInput>(
  violations: readonly TIssue[] | null | undefined,
  inputs: readonly TInput[] | null | undefined,
): ViolationPartition<TIssue, TInput> {
  // Rendering order, so the first affected input is the first one reached.
  const rendered = [...(inputs ?? [])]
  const indexByPath = new Map<string, number>()
  rendered.forEach((input, index) => {
    for (const path of claimedPaths(input)) {
      if (!indexByPath.has(path)) {
        // First registration of a path wins, so a violation lands on one input.
        indexByPath.set(path, index)
      }
    }
  })

  const perInput: TIssue[][] = rendered.map(() => [])
  const formLevel: TIssue[] = []
  let placedCount = 0

  for (const violation of violations ?? []) {
    placedCount += 1
    const path = normalizePath(violation?.path)
    const index = path === '' ? undefined : indexByPath.get(path)
    if (index === undefined) {
      formLevel.push(violation)
      continue
    }
    perInput[index]?.push(violation)
  }

  const fields: FieldPlacement<TIssue, TInput>[] = []
  rendered.forEach((input, index) => {
    const placed = perInput[index]
    if (placed === undefined || placed.length === 0) {
      return
    }
    fields.push({
      input,
      path: claimedPaths(input)[0] ?? '',
      violations: placed,
    })
  })

  return { fields, formLevel, placedCount }
}

/**
 * {@link partitionViolations} bound to the server's {@link FieldViolation} shape —
 * the entry point a feature uses on a 422, passing `apiError.fieldViolations`
 * straight through.
 */
export function partitionFieldViolations<TInput extends RenderedInput>(
  violations: readonly FieldViolation[] | null | undefined,
  inputs: readonly TInput[] | null | undefined,
): ViolationPartition<FieldViolation, TInput> {
  return partitionViolations(violations, inputs)
}

/** Every violation the partition placed, field placements first then form-level. */
export function placedViolations<TIssue extends PathAddressed>(
  partition: ViolationPartition<TIssue, RenderedInput>,
): readonly TIssue[] {
  return [...partition.fields.flatMap((placement) => placement.violations), ...partition.formLevel]
}

/** Whether any violation was placed at all. */
export function hasViolations(partition: ViolationPartition<PathAddressed, RenderedInput>): boolean {
  return partition.placedCount > 0
}

/**
 * The placement focus moves to on a failed submission: the affected input that
 * renders first (Requirement 20 AC6), or `null` when only the form-level region
 * carries messages.
 */
export function firstAffectedPlacement<TIssue extends PathAddressed, TInput extends RenderedInput>(
  partition: ViolationPartition<TIssue, TInput>,
): FieldPlacement<TIssue, TInput> | null {
  return partition.fields[0] ?? null
}

/** The violations attached to one field, addressed in either path spelling. */
export function violationsForPath<TIssue extends PathAddressed>(
  partition: ViolationPartition<TIssue, RenderedInput>,
  path: string,
): readonly TIssue[] {
  const wanted = normalizePath(path)
  if (wanted === '') {
    return []
  }
  const placement = partition.fields.find(
    (candidate) =>
      candidate.path === wanted ||
      claimedPaths(candidate.input).some((claimed) => claimed === wanted),
  )
  return placement?.violations ?? []
}

// ── Accessible description wiring (Req 20 AC6) ────────────────────────────────

/** Appended to an input's element id to form its violation-message element id. */
export const VIOLATION_MESSAGE_ID_SUFFIX = '-violation'

/** Element id of the form-level violation region. */
export const FORM_LEVEL_REGION_ID = 'form-violations'

/**
 * Turns a canonical path into an id-safe slug: every character outside
 * `[A-Za-z0-9_-]` becomes `-`, so `education.2.start_date` yields
 * `education-2-start_date`.
 */
export function pathToElementId(path: string): string {
  const slug = normalizePath(path).replace(/[^A-Za-z0-9_-]+/g, '-')
  return slug === '' ? 'field' : slug
}

/** DOM `id` of a rendered input: the registered one, else a slug of its path. */
export function inputElementId(input: RenderedInput): string {
  return input.id ?? pathToElementId(input.path)
}

/** DOM `id` of the element rendering an input's violation messages. */
export function violationMessageId(input: RenderedInput): string {
  return `${inputElementId(input)}${VIOLATION_MESSAGE_ID_SUFFIX}`
}

/**
 * Merges `aria-describedby` token lists, preserving order and dropping
 * duplicates and blanks.
 *
 * Returns `undefined` when no token remains, so the attribute is omitted rather
 * than rendered empty.
 */
export function mergeDescribedBy(
  ...sources: readonly (string | readonly string[] | null | undefined)[]
): string | undefined {
  const tokens: string[] = []
  const seen = new Set<string>()
  for (const source of sources) {
    if (source == null) {
      continue
    }
    const candidates = typeof source === 'string' ? source.split(/\s+/) : source
    for (const candidate of candidates) {
      const token = typeof candidate === 'string' ? candidate.trim() : ''
      if (token === '' || seen.has(token)) {
        continue
      }
      seen.add(token)
      tokens.push(token)
    }
  }
  return tokens.length === 0 ? undefined : tokens.join(' ')
}

/** The attributes an input and its message element need to be associated. */
export interface FieldDescription {
  /** `id` the input element must carry. */
  readonly inputId: string
  /** `id` the message element must carry. */
  readonly messageId: string
  /** Props to spread onto the input element. */
  readonly inputProps: {
    readonly id: string
    readonly 'aria-invalid': true
    readonly 'aria-describedby': string
  }
}

/**
 * Builds the association between an affected input and its rendered messages
 * (Requirement 20 AC6).
 *
 * `existingDescribedBy` keeps any description the input already had — a hint or
 * a character counter — ahead of the violation message.
 */
export function describeField(
  input: RenderedInput,
  existingDescribedBy?: string | readonly string[] | null,
): FieldDescription {
  const inputId = inputElementId(input)
  const messageId = violationMessageId(input)
  return {
    inputId,
    messageId,
    inputProps: {
      id: inputId,
      'aria-invalid': true,
      'aria-describedby': mergeDescribedBy(existingDescribedBy, messageId) ?? messageId,
    },
  }
}

// ── Focus management (Req 20 AC6) ─────────────────────────────────────────────

/** Where and how the first affected input is looked up in the DOM. */
export interface FocusOptions<TInput extends RenderedInput = RenderedInput> {
  /** Subtree to search; defaults to the document. */
  readonly root?: ParentNode | null
  /** Overrides the default id-based lookup. */
  readonly resolve?: (input: TInput) => HTMLElement | null
}

function escapeId(id: string): string {
  const escape = (globalThis as { CSS?: { escape?: (value: string) => string } }).CSS?.escape
  return typeof escape === 'function' ? escape(id) : id.replace(/["\\]/g, '\\$&')
}

function isFocusable(element: Element): element is HTMLElement {
  return typeof (element as HTMLElement).focus === 'function'
}

function focusTarget(element: HTMLElement): HTMLElement | null {
  if (element.matches('input, select, textarea, button, a[href], [tabindex]')) {
    return element
  }
  // A registered group (a fieldset, a Mantine wrapper) delegates to its first
  // focusable descendant.
  const inner = element.querySelector<HTMLElement>(
    'input:not([type="hidden"]), select, textarea, button, a[href], [tabindex]',
  )
  return inner ?? (isFocusable(element) ? element : null)
}

/**
 * Moves focus to the first affected input of a partition (Requirement 20 AC6).
 *
 * Returns the element that received focus, or `null` when the partition has no
 * affected input or the element is not in the DOM. Nothing else is changed: the
 * entered values and the rendered messages are untouched.
 */
export function focusFirstAffectedInput<TInput extends RenderedInput>(
  partition: ViolationPartition<PathAddressed, TInput>,
  options: FocusOptions<TInput> = {},
): HTMLElement | null {
  const placement = firstAffectedPlacement(partition)
  if (placement === null) {
    return null
  }
  const input = placement.input
  const resolved =
    options.resolve !== undefined
      ? options.resolve(input)
      : ((options.root ?? globalThis.document ?? null)?.querySelector<HTMLElement>(
          `#${escapeId(inputElementId(input))}`,
        ) ?? null)
  if (resolved == null) {
    return null
  }
  const target = focusTarget(resolved)
  target?.focus()
  return target
}

/**
 * Moves focus to the first affected input whenever a new partition is rendered
 * (Requirement 20 AC6).
 *
 * Focus moves only for a partition carrying at least one field placement, so a
 * form-level-only failure leaves focus where the user left it and is announced
 * by the message region instead.
 */
export function useViolationFocus<TInput extends RenderedInput>(
  partition: ViolationPartition<PathAddressed, TInput>,
  options: FocusOptions<TInput> = {},
): void {
  const latestOptions = useRef(options)
  useEffect(() => {
    // Kept in a ref so an inline `resolve` closure does not re-trigger the move.
    latestOptions.current = options
  })
  useEffect(() => {
    focusFirstAffectedInput(partition, latestOptions.current)
    // The partition identity is the trigger: a new failed submission produces a
    // new partition, and a re-render carrying the same one must not steal focus
    // back from wherever the user has moved since.
  }, [partition])
}
