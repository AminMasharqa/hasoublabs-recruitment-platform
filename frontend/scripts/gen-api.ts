// Contract_Generator: regenerate the committed API type declarations
// (Requirement 2 AC1, AC2, AC4).
//
// Fetches the Backend_Api OpenAPI document published at `/api/openapi.json`, runs
// `openapi-typescript` over it, and writes `src/api/generated/schema.d.ts`, which
// is committed to version control. When the document cannot be retrieved the
// script exits non-zero, names the endpoint, and leaves the committed
// declarations untouched (AC6).

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative } from 'node:path'

import {
  PROJECT_ROOT,
  SCHEMA_PATH,
  SCHEMA_RELATIVE_PATH,
  UnreachableDocumentError,
  diffDeclarations,
  generateDeclarations,
  readCommittedDeclarations,
  resolveOpenApiUrl,
} from './contract.ts'

function report(message: string): void {
  process.stderr.write(`${message}\n`)
}

async function main(): Promise<number> {
  const url = resolveOpenApiUrl()
  report(`gen:api: reading the Backend_Api OpenAPI document from ${url}`)

  let declarations: string
  try {
    declarations = await generateDeclarations(url)
  } catch (error: unknown) {
    if (error instanceof UnreachableDocumentError) {
      // AC6: name the unreachable endpoint and leave the committed file alone.
      report(`gen:api failed: the OpenAPI document at ${error.endpoint} could not be retrieved.`)
      report(`  ${error.message}`)
      report(`  ${SCHEMA_RELATIVE_PATH} was left unchanged.`)
      report('  Start the Backend_Api, or set OPENAPI_URL / BACKEND_ORIGIN, and retry.')
      return 1
    }
    throw error
  }

  const previous = await readCommittedDeclarations()
  if (previous !== null && diffDeclarations(previous, declarations) === null) {
    report(`gen:api: ${SCHEMA_RELATIVE_PATH} is already up to date.`)
    return 0
  }

  await mkdir(dirname(SCHEMA_PATH), { recursive: true })
  await writeFile(SCHEMA_PATH, declarations, 'utf8')
  const action = previous === null ? 'created' : 'updated'
  report(`gen:api: ${action} ${relative(PROJECT_ROOT, SCHEMA_PATH).replaceAll('\\', '/')}`)
  return 0
}

try {
  process.exitCode = await main()
} catch (error: unknown) {
  report(`gen:api failed unexpectedly: ${error instanceof Error ? error.stack : String(error)}`)
  process.exitCode = 1
}
