import { describe, expect, it } from 'vitest'
import { PUBLIC_ROUTE_PATH_IDS, routeAccessFor } from '../../routing/routes'
import { ADMIN_ACCESS } from '../../routing/routeAccess'
import { SCREEN_ELEMENTS } from '../../shell/screenElements'

const SOURCE_PATH_IDS = [
  'adminJobSources',
  'adminJobSourceNew',
  'adminJobSourceDetail',
  'adminJobFlags',
] as const

describe('the job sources routes (R23)', () => {
  for (const pathId of SOURCE_PATH_IDS) {
    it(`guards ${pathId} with ADMIN_ACCESS`, () => {
      expect(PUBLIC_ROUTE_PATH_IDS).not.toContain(pathId)
      expect(routeAccessFor(pathId)).toBe(ADMIN_ACCESS)
    })
  }

  it('registers the four screens on those guarded paths', () => {
    expect(SCREEN_ELEMENTS.adminJobSources).toBeDefined()
    expect(SCREEN_ELEMENTS.adminJobSourceNew).toBeDefined()
    expect(SCREEN_ELEMENTS.adminJobSourceDetail).toBeDefined()
    expect(SCREEN_ELEMENTS.adminJobFlags).toBeDefined()
  })
})
