/**
 * Build-time environment access for the Web_Client.
 *
 * Requirement 1 AC10: the Backend_Api base URL comes from the build-time
 * `VITE_API_BASE_URL` variable and falls back to `/api/v1` when absent.
 */

export const DEFAULT_API_BASE_URL = '/api/v1'

/**
 * Normalizes a raw `VITE_API_BASE_URL` value into the base URL the Api_Client uses.
 *
 * An absent, empty or whitespace-only value resolves to {@link DEFAULT_API_BASE_URL}.
 * Trailing slashes are stripped so path joining never produces a double slash.
 */
export function resolveApiBaseUrl(raw: string | undefined | null): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  if (trimmed.length === 0) {
    return DEFAULT_API_BASE_URL
  }
  const withoutTrailingSlashes = trimmed.replace(/\/+$/, '')
  return withoutTrailingSlashes.length === 0 ? '/' : withoutTrailingSlashes
}

function readViteEnv(key: string): string | undefined {
  const value = (import.meta.env as Record<string, unknown> | undefined)?.[key]
  return typeof value === 'string' ? value : undefined
}

export interface Env {
  /** Base URL every Backend_Api request is issued against. */
  readonly apiBaseUrl: string
}

export const env: Env = {
  apiBaseUrl: resolveApiBaseUrl(readViteEnv('VITE_API_BASE_URL')),
}
