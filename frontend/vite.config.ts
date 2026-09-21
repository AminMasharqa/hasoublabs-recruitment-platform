import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The build-time constant the diagnostics surface reports (Requirement 23 AC5).
 *
 * The bundle version identifier has to be decided while the bundle is being
 * produced — after the build there is nothing left to ask. It is therefore
 * injected as `import.meta.env.VITE_BUNDLE_VERSION`, the same channel
 * `src/lib/env.ts` reads `VITE_API_BASE_URL` through, so the client reads one
 * kind of build-time value in one way and no runtime endpoint has to exist for
 * it.
 *
 * Resolution order, most authoritative first:
 *
 * 1. `VITE_BUNDLE_VERSION` in the build environment — the release pipeline knows
 *    the identifier it published under, and nothing here should second-guess it.
 * 2. The `package.json` version joined with the short commit the tree is at,
 *    e.g. `0.0.0+1a2b3c4`. The commit is what actually distinguishes two bundles
 *    during development, where the declared version rarely moves.
 * 3. The `package.json` version alone, when the build runs outside a git
 *    checkout (a Docker build context, a source tarball).
 *
 * A failure at any step is not a build failure: an unidentifiable bundle is a
 * degraded diagnostics surface, which `features/diagnostics/bundleVersion.ts`
 * renders as such, and not a reason to refuse to ship.
 */
function packageVersion(): string | null {
  try {
    const raw = readFileSync(new URL('./package.json', import.meta.url), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    const version = (parsed as { version?: unknown }).version
    return typeof version === 'string' && version.trim().length > 0 ? version.trim() : null
  } catch {
    return null
  }
}

/** The short commit of the checked-out tree, or `null` outside a git checkout. */
function gitCommit(): string | null {
  try {
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: new URL('.', import.meta.url),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const trimmed = commit.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

/** The identifier injected into the bundle, or `''` when none could be derived. */
function resolveBundleVersion(): string {
  const fromEnvironment = process.env.VITE_BUNDLE_VERSION?.trim()
  if (fromEnvironment !== undefined && fromEnvironment.length > 0) {
    return fromEnvironment
  }
  const version = packageVersion()
  if (version === null) {
    return ''
  }
  const commit = gitCommit()
  return commit === null ? version : `${version}+${commit}`
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Requirement 23 AC5. Serialized rather than interpolated, so a value
    // carrying a quote cannot break the replacement.
    'import.meta.env.VITE_BUNDLE_VERSION': JSON.stringify(resolveBundleVersion()),
  },
})
