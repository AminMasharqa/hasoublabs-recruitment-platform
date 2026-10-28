import { describe, expect, it } from 'vitest'

import { DEFAULT_API_BASE_URL, env, resolveApiBaseUrl } from './env'

describe('resolveApiBaseUrl', () => {
  it('defaults to /api/v1 when the variable is absent', () => {
    expect(resolveApiBaseUrl(undefined)).toBe(DEFAULT_API_BASE_URL)
    expect(resolveApiBaseUrl(null)).toBe(DEFAULT_API_BASE_URL)
  })

  it('defaults to /api/v1 when the variable is empty or whitespace', () => {
    expect(resolveApiBaseUrl('')).toBe(DEFAULT_API_BASE_URL)
    expect(resolveApiBaseUrl('   ')).toBe(DEFAULT_API_BASE_URL)
  })

  it('uses the configured value when present', () => {
    expect(resolveApiBaseUrl('https://api.example.test/api/v1')).toBe(
      'https://api.example.test/api/v1',
    )
    expect(resolveApiBaseUrl('  /custom/base  ')).toBe('/custom/base')
  })

  it('strips trailing slashes so path joining stays single-slashed', () => {
    expect(resolveApiBaseUrl('https://api.example.test/api/v1///')).toBe(
      'https://api.example.test/api/v1',
    )
    expect(resolveApiBaseUrl('/')).toBe('/')
  })
})

describe('env', () => {
  it('exposes a non-empty api base URL', () => {
    expect(env.apiBaseUrl.length).toBeGreaterThan(0)
  })
})
