/**
 * The bundle version identifier the diagnostics surface reports (Requirement 23
 * AC5).
 *
 * ## Where the identifier comes from
 *
 * It is a build-time fact, so it is decided at build time and baked in: the
 * `define` in `vite.config.ts` replaces `import.meta.env.VITE_BUNDLE_VERSION`
 * with the identifier of the bundle being produced — `VITE_BUNDLE_VERSION` from
 * the release environment when set, otherwise the `package.json` version joined
 * with the short commit, e.g. `0.0.0+1a2b3c4`.
 *
 * Deliberately *not* a runtime read. An endpoint that reported the version would
 * describe the server that answered it, not the JavaScript the user is running —
 * which, with a cached bundle or a mid-deploy reload, is exactly the case worth
 * diagnosing. A stale bundle reporting its own identifier is the useful answer;
 * a fresh server reporting the version it wishes were loaded is not.
 *
 * ## Why absence is a first-class outcome
 *
 * A bundle can legitimately carry no identifier: `vitest` does not apply the
 * production `define`, and a build outside a git checkout with an unreadable
 * `package.json` derives nothing. Rather than inventing a placeholder that looks
 * like a version, {@link bundleVersion} reports `null` and the surface says the
 * build recorded none. A diagnostics screen that cannot be trusted to admit
 * ignorance is worse than one that has no answer.
 *
 * Pure and React-free, so the reading and the normalization are testable without
 * a build.
 */

/**
 * The build-time environment key carrying the identifier.
 *
 * Named here rather than inlined because `vite.config.ts` writes the same key on
 * the other side of the build; the two are only one grep apart.
 */
export const BUNDLE_VERSION_ENV_KEY = 'VITE_BUNDLE_VERSION'

/**
 * Normalizes a raw build-time value into an identifier, or `null`.
 *
 * Absent, non-string, empty and whitespace-only values all mean "this build
 * recorded no identifier". Surrounding whitespace is trimmed — a value threaded
 * through a shell pipeline often arrives with a trailing newline — but the
 * identifier itself is otherwise returned byte for byte, because it may name a
 * tag or a commit that must be quotable to an operator verbatim.
 */
export function normalizeBundleVersion(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }
  const trimmed = raw.trim()
  return trimmed.length === 0 ? null : trimmed
}

/**
 * Reads one key off the build-time environment.
 *
 * `import.meta.env` is replaced statically by Vite, so this is a constant after
 * the build; the indirection exists to keep the absence of the object — which is
 * what a non-Vite consumer of this module would see — from throwing.
 */
function readBuildEnv(key: string): unknown {
  return (import.meta.env as Record<string, unknown> | undefined)?.[key]
}

/**
 * The identifier of the running bundle, or `null` when the build recorded none
 * (Requirement 23 AC5).
 *
 * Accepts an explicit environment object so a test can exercise both outcomes
 * without a build; production callers pass nothing.
 */
export function bundleVersion(env?: Readonly<Record<string, unknown>>): string | null {
  const raw = env === undefined ? readBuildEnv(BUNDLE_VERSION_ENV_KEY) : env[BUNDLE_VERSION_ENV_KEY]
  return normalizeBundleVersion(raw)
}
