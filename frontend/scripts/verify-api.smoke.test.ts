// @vitest-environment node

// Contract_Generator verification smoke tests (Requirement 2 AC5, AC6).
//
// These tests drive the real `npm run verify:api` script in a child process so
// the exit-code contract is asserted end to end. No Backend_Api is involved: a
// throwaway `node:http` server publishes a controlled OpenAPI document and the
// script is pointed at it through `OPENAPI_URL`. Every server is closed in a
// `finally` block and by an `afterEach` backstop, and both cases assert the
// committed declarations are byte-for-byte unchanged afterwards.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const schemaPath = join(projectRoot, 'src/api/generated/schema.d.ts')

const SCRIPT_TIMEOUT_MS = 120_000
const TEST_TIMEOUT_MS = 180_000

/**
 * A valid but deliberately tiny OpenAPI document. Its declarations cannot match
 * the committed ones, which is exactly the drift condition of AC5.
 */
const DRIFTING_DOCUMENT = {
  openapi: '3.1.0',
  info: { title: 'Drift probe', version: '0.0.0' },
  paths: {
    '/api/v1/drift-probe': {
      get: {
        operationId: 'drift_probe',
        responses: {
          '200': {
            description: 'Successful Response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { probe: { type: 'string' } },
                  required: ['probe'],
                },
              },
            },
          },
        },
      },
    },
  },
} as const

interface ScriptRun {
  readonly code: number | null
  readonly timedOut: boolean
  readonly output: string
}

/**
 * Child environment that cannot accidentally make the assertions vacuous: the
 * inherited `VITEST_*` variables are dropped, and both contract-resolution
 * variables are cleared before the caller's override is applied so a developer's
 * `BACKEND_ORIGIN` can never redirect the run.
 */
function childEnv(overrides: Readonly<Record<string, string>>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key === 'CI' || key.startsWith('VITEST')) {
      delete env[key]
    }
  }
  delete env.OPENAPI_URL
  delete env.BACKEND_ORIGIN
  return { ...env, ...overrides }
}

function killTree(pid: number | undefined, kill: () => void): void {
  if (process.platform === 'win32' && pid !== undefined) {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', shell: true })
    return
  }
  kill()
}

function runVerifyApi(overrides: Readonly<Record<string, string>>): Promise<ScriptRun> {
  return new Promise<ScriptRun>((settle, fail) => {
    const child = spawn('npm', ['run', 'verify:api'], {
      cwd: projectRoot,
      shell: true,
      env: childEnv(overrides),
    })

    let output = ''
    let timedOut = false

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      output += chunk
    })
    child.stderr?.on('data', (chunk: string) => {
      output += chunk
    })

    const timer = setTimeout(() => {
      timedOut = true
      killTree(child.pid, () => child.kill('SIGKILL'))
    }, SCRIPT_TIMEOUT_MS)

    child.on('error', (error) => {
      clearTimeout(timer)
      fail(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      settle({ code, timedOut, output })
    })
  })
}

const openServers: Server[] = []

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((settle) => {
    server.close(() => {
      settle()
    })
  })
}

async function closeOpenServers(): Promise<void> {
  await Promise.all(openServers.splice(0).map(closeServer))
}

afterEach(closeOpenServers)

/** Serves `document` as JSON on every path, on an ephemeral loopback port. */
async function serveDocument(document: unknown): Promise<{ url: string }> {
  const body = JSON.stringify(document)
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(body)
  })
  openServers.push(server)

  await new Promise<void>((settle, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      settle()
    })
  })

  const address = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${String(address.port)}/api/openapi.json` }
}

/** Binds an ephemeral port, releases it, and returns a URL nothing listens on. */
async function closedPortUrl(): Promise<string> {
  const server = createServer()
  await new Promise<void>((settle, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      settle()
    })
  })
  const address = server.address() as AddressInfo
  const url = `http://127.0.0.1:${String(address.port)}/api/openapi.json`
  await closeServer(server)
  return url
}

function schemaDigest(): string {
  return createHash('sha256').update(readFileSync(schemaPath)).digest('hex')
}

describe('verify:api exit-code contracts', () => {
  it(
    'exits non-zero, reports the drift and leaves the committed declarations unchanged',
    async () => {
      const before = schemaDigest()

      try {
        const { url } = await serveDocument(DRIFTING_DOCUMENT)

        const run = await runVerifyApi({ OPENAPI_URL: url })

        expect(run.timedOut).toBe(false)
        expect(run.code).not.toBe(0)
        expect(run.output).toContain('src/api/generated/schema.d.ts')
        expect(run.output).toContain('has drifted')
        expect(run.output).toContain(url)
        // The divergent block is reported, not just the fact of divergence.
        expect(run.output).toMatch(/First difference at line \d+:/)
        expect(run.output).toContain('npm run gen:api')
      } finally {
        await closeOpenServers()
      }

      expect(schemaDigest()).toBe(before)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'exits non-zero, names the unreachable endpoint and leaves the committed declarations unchanged',
    async () => {
      const before = schemaDigest()
      const url = await closedPortUrl()

      const run = await runVerifyApi({ OPENAPI_URL: url })

      expect(run.timedOut).toBe(false)
      expect(run.code).not.toBe(0)
      expect(run.output).toContain(url)
      expect(run.output).toContain('could not be retrieved')
      expect(run.output).toContain('was left unchanged')
      // A retrieval failure must never be reported as drift.
      expect(run.output).not.toContain('has drifted')

      expect(schemaDigest()).toBe(before)
    },
    TEST_TIMEOUT_MS,
  )
})
