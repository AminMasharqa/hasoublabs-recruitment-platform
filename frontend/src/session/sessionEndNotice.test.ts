/**
 * The session-end reason store (Requirement 4 AC7, AC9).
 *
 * The rendered notice is asserted in `features/auth/LoginScreen.test.tsx`, through
 * the real runtime and the real Route_Guard — which is where the competing redirect
 * this store exists for actually occurs. Here only the store's own contract is
 * pinned: an expiry is remembered, a logout replaces it, establishing a session
 * forgets it, and a subscriber sees each change.
 */

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  clearSessionEnd,
  latestSessionEnd,
  recordSessionEnd,
  useSessionExpired,
} from './sessionEndNotice'

afterEach(() => {
  clearSessionEnd()
})

describe('the recorded session-end reason', () => {
  it('remembers nothing until a session ends', () => {
    expect(latestSessionEnd()).toBeNull()
  })

  it('remembers an expiry, which is the notice AC7 owes', () => {
    recordSessionEnd('session-expired')
    expect(latestSessionEnd()).toBe('session-expired')
  })

  it('lets a later logout replace an earlier expiry, so AC9 shows no notice', () => {
    recordSessionEnd('session-expired')
    recordSessionEnd('logout')
    expect(latestSessionEnd()).toBe('logout')
  })

  it('is forgotten when cleared, as establishing a session does', () => {
    recordSessionEnd('session-expired')
    clearSessionEnd()
    expect(latestSessionEnd()).toBeNull()
  })
})

describe('useSessionExpired', () => {
  it('re-renders a mounted reader when a session expires and when it is cleared', () => {
    const { result } = renderHook(() => useSessionExpired())
    expect(result.current).toBe(false)

    act(() => {
      recordSessionEnd('session-expired')
    })
    expect(result.current).toBe(true)

    act(() => {
      clearSessionEnd()
    })
    expect(result.current).toBe(false)
  })

  it('owes no notice for a deliberate logout', () => {
    const { result } = renderHook(() => useSessionExpired())

    act(() => {
      recordSessionEnd('logout')
    })

    expect(result.current).toBe(false)
  })
})
