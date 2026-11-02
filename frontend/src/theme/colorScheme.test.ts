import { describe, expect, it } from 'vitest'

import { colorSchemeForContext, contextSchemeManager } from './colorScheme'

describe('colorSchemeForContext', () => {
  it('renders an Administrator dark', () => {
    expect(colorSchemeForContext('ADMIN')).toBe('dark')
  })

  it.each(['CANDIDATE', 'SENIOR', null] as const)('renders %s light', (context) => {
    expect(colorSchemeForContext(context)).toBe('light')
  })
})

describe('contextSchemeManager', () => {
  it('keeps nothing, so the session alone decides the scheme', () => {
    contextSchemeManager.set('dark')

    expect(contextSchemeManager.get('light')).toBe('light')
  })
})
