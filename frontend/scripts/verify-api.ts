// Contract_Generator: verify the committed API type declarations against a fresh
// regeneration (Requirement 2 AC5, AC6).
//
// Regenerates the declarations into a temporary file and diffs that file against
// the committed `src/api/generated/schema.d.ts`. Any difference fails with a
// non-zero exit status (AC5). If the OpenAPI document cannot be retrieved the
// script exits non-zero and names the endpoint (AC6). It never writes to the
// committed declarations — the only output path is the temporary directory — so a
// verification run can never mask drift by silently fixing it.

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  SCHEMA_RELATIVE_PATH,
  UnreachableDocumentError,
  diffDeclarations,
  formatDifference,
  generateDeclarations,
  readCommittedDeclarations,
  resolveOpenApiUrl,
} from './contract.ts'

function report(message: string): void {
  process.stderr.write(`${message}\n`)
}

async function main(): Promise<number> {
  const url = resolveOpenApiUrl()
  report(`verify:api: checking ${SCHEMA_RELATIVE_PATH} against ${url}`)

  const committed = await readCommittedDeclarations()

  let regenerated: string
  try {
    regenerated = await generateDeclarations(url)
  } catch (error: unknown) {
    if (error instanceof UnreachableDocumentError) {
      // AC6: non-zero exit, endpoint named, committed declarations untouched.
      report(
        `verify:api failed: the OpenAPI document at ${error.endpoint} could not be retrieved.`,
      )
      report(`  ${error.message}`)
      report(`  ${SCHEMA_RELATIVE_PATH} was left unchanged.`)
      report('  Start the Backend_Api, or set OPENAPI_URL / BACKEND_ORIGIN, and retry.')
      return 1
    }
    throw error
  }

  // The regeneration is materialized in a temporary file so the comparison is
  // made against a real artifact and never against the committed path.
  const scratch = await mkdtemp(join(tmpdir(), 'verify-api-'))
  try {
    const candidatePath = join(scratch, 'schema.d.ts')
    await writeFile(candidatePath, regenerated, 'utf8')

    if (committed === null) {
      report(`verify:api failed: ${SCHEMA_RELATIVE_PATH} is missing.`)
      report('  Run `npm run gen:api` and commit the generated declarations.')
      return 1
    }

    const difference = diffDeclarations(committed, regenerated)
    if (difference !== null) {
      report(
        `verify:api failed: ${SCHEMA_RELATIVE_PATH} has drifted from the OpenAPI document at ${url}.`,
      )
      report(formatDifference(difference))
      report('  Run `npm run gen:api` and commit the regenerated declarations.')
      return 1
    }

    report(`verify:api: ${SCHEMA_RELATIVE_PATH} matches the OpenAPI document.`)
    return 0
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

try {
  process.exitCode = await main()
} catch (error: unknown) {
  report(`verify:api failed unexpectedly: ${error instanceof Error ? error.stack : String(error)}`)
  process.exitCode = 1
}
