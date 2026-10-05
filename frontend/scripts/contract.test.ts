import { describe, expect, it } from 'vitest'

import { diffDeclarations } from './contract.ts'

describe('diffDeclarations', () => {
  it('is null for identical declarations', () => {
    expect(diffDeclarations('a\nb\n', 'a\nb\n')).toBeNull()
  })

  it('ignores CRLF versus LF line endings (a core.autocrlf checkout)', () => {
    expect(diffDeclarations('a\r\nb\r\n', 'a\nb\n')).toBeNull()
  })

  it('reports the divergent block, without carriage returns, when the content differs', () => {
    expect(diffDeclarations('a\r\nold\r\nz\r\n', 'a\nnew\nz\n')).toEqual({
      line: 2,
      committed: ['old'],
      regenerated: ['new'],
    })
  })
})
