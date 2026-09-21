// Contract_Generator core (Requirement 2 AC1, AC2, AC4, AC5, AC6).
//
// Shared between `gen-api.ts` (regenerate and commit) and `verify-api.ts`
// (regenerate to a temporary file and diff). Keeping the retrieval and emission
// logic in one place guarantees the two scripts can never disagree about what
// "the generated declarations" are — which is the whole point of the drift check.

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import openapiTS, { astToString } from 'openapi-typescript'

/** Repository-relative root of the frontend project. */
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Path, relative to the Backend_Api origin, at which the OpenAPI document is
 * published (Requirement 2 AC1). Fixed by the Backend_Api, not configurable.
 */
export const OPENAPI_PATH = '/api/openapi.json'

/** Origin used when no override is supplied — the local development Backend_Api. */
export const DEFAULT_BACKEND_ORIGIN = 'http://127.0.0.1:8000'

/** Committed declaration file the Api_Client and enum unions are derived from (AC4). */
export const SCHEMA_RELATIVE_PATH = 'src/api/generated/schema.d.ts'

/** Absolute path of the committed declaration file. */
export const SCHEMA_PATH = resolve(PROJECT_ROOT, SCHEMA_RELATIVE_PATH)

/** How long retrieval of the OpenAPI document may take before it counts as unreachable. */
export const FETCH_TIMEOUT_MS = 30_000

const BANNER = [
  '/**',
  ' * Generated Backend_Api contract declarations - DO NOT EDIT BY HAND.',
  ' *',
  ` * Emitted by \`npm run gen:api\` from the OpenAPI document at ${OPENAPI_PATH}.`,
  ' * Run `npm run gen:api` after any Backend_Api contract change; `npm run verify:api`',
  ' * fails the Build_Pipeline when this file drifts from the reference document.',
  ' */',
  '',
].join('\n')

/**
 * Raised when the OpenAPI document cannot be retrieved (Requirement 2 AC6).
 *
 * Carries the endpoint so both scripts can name it in their failure output while
 * leaving the committed declarations untouched.
 */
export class UnreachableDocumentError extends Error {
  readonly endpoint: string

  constructor(endpoint: string, reason: string, options?: { cause?: unknown }) {
    super(`Could not retrieve the OpenAPI document from ${endpoint}: ${reason}`, options)
    this.name = 'UnreachableDocumentError'
    this.endpoint = endpoint
  }
}

/**
 * Resolves the URL the OpenAPI document is retrieved from.
 *
 * `OPENAPI_URL` names the document outright (used by CI to point at a published
 * reference document); `BACKEND_ORIGIN` names only the origin and keeps the
 * fixed {@link OPENAPI_PATH}. Absent both, the local development server is used.
 */
export function resolveOpenApiUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const explicit = env.OPENAPI_URL?.trim()
  if (explicit !== undefined && explicit.length > 0) {
    return explicit
  }
  const origin = env.BACKEND_ORIGIN?.trim()
  const base = origin !== undefined && origin.length > 0 ? origin : DEFAULT_BACKEND_ORIGIN
  return new URL(OPENAPI_PATH, base).toString()
}

function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return `no response within ${FETCH_TIMEOUT_MS}ms`
    }
    const cause = error.cause
    if (cause instanceof Error && cause.message !== error.message) {
      return `${error.message} (${cause.message})`
    }
    return error.message
  }
  return String(error)
}

/**
 * Retrieves and parses the OpenAPI document.
 *
 * Every failure mode — connection refused, timeout, non-2xx status, unparseable
 * body — surfaces as an {@link UnreachableDocumentError} naming the endpoint so
 * the caller can honour Requirement 2 AC6 uniformly.
 */
export async function fetchOpenApiDocument(url: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (error: unknown) {
    throw new UnreachableDocumentError(url, describeFailure(error), { cause: error })
  }

  if (!response.ok) {
    throw new UnreachableDocumentError(
      url,
      `responded ${String(response.status)} ${response.statusText}`.trimEnd(),
    )
  }

  const body = await response.text()
  try {
    return JSON.parse(body) as unknown
  } catch (error: unknown) {
    throw new UnreachableDocumentError(url, `response body is not valid JSON`, { cause: error })
  }
}

/**
 * Emits the TypeScript declarations for every operation, request body and
 * response body in the document (Requirement 2 AC1).
 */
export async function renderDeclarations(document: unknown): Promise<string> {
  const ast = await openapiTS(document as Parameters<typeof openapiTS>[0], {
    alphabetize: true,
    emptyObjectsUnknown: true,
  })
  return `${BANNER}${astToString(ast)}`
}

/** Retrieves the reference document and renders the declarations it implies. */
export async function generateDeclarations(url: string): Promise<string> {
  return renderDeclarations(await fetchOpenApiDocument(url))
}

/** Reads the committed declarations, or `null` when they have never been generated. */
export async function readCommittedDeclarations(): Promise<string | null> {
  try {
    return await readFile(SCHEMA_PATH, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

export interface LineDifference {
  /** 1-based line number in the committed file where the blocks diverge. */
  readonly line: number
  /** Lines present in the committed file but not in the regenerated output. */
  readonly committed: readonly string[]
  /** Lines present in the regenerated output but not in the committed file. */
  readonly regenerated: readonly string[]
}

/**
 * Compares two declaration texts line by line.
 *
 * Returns `null` when they are identical. Otherwise it trims the shared prefix
 * and suffix and reports the divergent block, which is enough for a developer to
 * see what the Backend_Api changed without pulling in a diff dependency.
 */
export function diffDeclarations(committed: string, regenerated: string): LineDifference | null {
  if (committed === regenerated) {
    return null
  }

  const left = committed.split('\n')
  const right = regenerated.split('\n')

  let prefix = 0
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) {
    suffix += 1
  }

  return {
    line: prefix + 1,
    committed: left.slice(prefix, left.length - suffix),
    regenerated: right.slice(prefix, right.length - suffix),
  }
}

const MAX_REPORTED_LINES = 20

/** Renders a {@link LineDifference} as human-readable failure output. */
export function formatDifference(difference: LineDifference): string {
  const render = (marker: string, lines: readonly string[]): string[] => {
    const shown = lines.slice(0, MAX_REPORTED_LINES).map((line) => `  ${marker} ${line}`)
    if (lines.length > MAX_REPORTED_LINES) {
      shown.push(`  ${marker} ... ${String(lines.length - MAX_REPORTED_LINES)} more line(s)`)
    }
    return shown
  }

  return [
    `First difference at line ${String(difference.line)}:`,
    ...render('-', difference.committed),
    ...render('+', difference.regenerated),
  ].join('\n')
}
