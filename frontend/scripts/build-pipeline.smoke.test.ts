// @vitest-environment node

// Build-pipeline exit-code smoke tests (Requirement 1 AC6, AC7, AC8, AC9).
//
// These tests drive the real npm scripts in a child process against
// temporarily injected erroneous sources, so they are slower than the rest of
// the suite. Every injected file is removed in a `finally` block and by an
// `afterEach` backstop so a failure can never leave the tree dirty.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const SCRIPT_TIMEOUT_MS = 240_000
const TEST_TIMEOUT_MS = 300_000

interface ScriptRun {
  readonly code: number | null
  readonly timedOut: boolean
  readonly output: string
}

/**
 * Child environment that cannot accidentally make the assertions vacuous:
 * `CI` and the inherited `VITEST_*` variables are dropped so a nested
 * `vitest` run only leaves watch mode because of the script's own `run` flag.
 */
function childEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key === 'CI' || key.startsWith('VITEST')) {
      delete env[key]
    }
  }
  return env
}

function killTree(pid: number | undefined, kill: () => void): void {
  if (process.platform === 'win32' && pid !== undefined) {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', shell: true })
    return
  }
  kill()
}

function runNpmScript(args: readonly string[]): Promise<ScriptRun> {
  return new Promise<ScriptRun>((settle, fail) => {
    const child = spawn('npm', [...args], {
      cwd: projectRoot,
      shell: true,
      env: childEnv(),
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

const injectedPaths: string[] = []

function inject(relativePath: string, contents: string): void {
  const absolute = join(projectRoot, relativePath)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, contents, 'utf8')
  injectedPaths.push(absolute)
}

function removeInjected(): void {
  for (const absolute of injectedPaths.splice(0)) {
    if (existsSync(absolute)) {
      rmSync(absolute, { force: true })
    }
  }
}

afterEach(removeInjected)

const TYPE_ERROR_SOURCE = `export const brokenTypecheckProbe: number = 'not a number'\n`

describe('build pipeline exit-code contracts', () => {
  it(
    'typecheck exits non-zero when a TypeScript error is present',
    async () => {
      try {
        inject('src/type-error.smoke.tmp.ts', TYPE_ERROR_SOURCE)

        const run = await runNpmScript(['run', 'typecheck'])

        expect(run.timedOut).toBe(false)
        expect(run.code).not.toBe(0)
        expect(run.output).toContain('type-error.smoke.tmp.ts')
        expect(run.output).toMatch(/error TS\d+/)
      } finally {
        removeInjected()
      }
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'lint exits non-zero when a lint error is present',
    async () => {
      try {
        // Violates the src/api no-console rule configured as the
        // secret-hygiene backstop.
        inject(
          'src/api/no-console.smoke.tmp.ts',
          `export function emitSmokeProbe(): void {\n  console.log('smoke probe')\n}\n`,
        )

        const run = await runNpmScript(['run', 'lint'])

        expect(run.timedOut).toBe(false)
        expect(run.code).not.toBe(0)
        expect(run.output).toContain('no-console.smoke.tmp.ts')
        expect(run.output).toContain('no-console')
      } finally {
        removeInjected()
      }
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'build exits non-zero when a TypeScript error is present',
    async () => {
      try {
        inject('src/type-error.smoke.tmp.ts', TYPE_ERROR_SOURCE)

        const run = await runNpmScript(['run', 'build'])

        expect(run.timedOut).toBe(false)
        expect(run.code).not.toBe(0)
        expect(run.output).toMatch(/error TS\d+/)
        // The bundle step must not run once the type check fails.
        expect(run.output).not.toMatch(/built in/i)
      } finally {
        removeInjected()
      }
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'test runs in single-execution mode and terminates on its own',
    async () => {
      const packageJson = JSON.parse(
        readFileSync(join(projectRoot, 'package.json'), 'utf8'),
      ) as { scripts: Record<string, string> }
      expect(packageJson.scripts.test).toMatch(/^vitest run\b/)

      try {
        // An isolated config plus fixture keeps the nested run from
        // re-entering this suite.
        inject(
          'scripts/single-run.smoke.tmp.fixture.ts',
          [
            "import { expect, it } from 'vitest'",
            '',
            "it('passes so the nested run can finish', () => {",
            '  expect(1 + 1).toBe(2)',
            '})',
            '',
          ].join('\n'),
        )
        inject(
          'vitest.single-run.smoke.tmp.config.ts',
          [
            "import { defineConfig } from 'vitest/config'",
            '',
            'export default defineConfig({',
            '  test: {',
            "    environment: 'node',",
            "    include: ['scripts/single-run.smoke.tmp.fixture.ts'],",
            '  },',
            '})',
            '',
          ].join('\n'),
        )

        const run = await runNpmScript([
          'test',
          '--',
          '--config',
          'vitest.single-run.smoke.tmp.config.ts',
        ])

        expect(run.timedOut).toBe(false)
        expect(run.code).toBe(0)
        expect(run.output).toMatch(/Test Files\s+1 passed/)
        expect(run.output).not.toMatch(/Waiting for file changes/i)
        expect(run.output).not.toMatch(/press h to show help/i)
      } finally {
        removeInjected()
      }
    },
    TEST_TIMEOUT_MS,
  )
})
