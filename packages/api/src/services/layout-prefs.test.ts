import { beforeEach, describe, expect, it } from 'vitest'
import { applyLayout } from '@ak-system/types'
import { getTestDb, resetDb } from '../test-utils'
import { userSettings } from '@ak-system/database'
import { getLayoutPrefs, parseLayoutPrefs, resetScreenLayout, setScreenLayout } from './layout-prefs'

describe('applyLayout', () => {
  const defaults = ['a', 'b', 'c', 'd']

  it('is the default order with nothing saved', () => {
    expect(applyLayout(defaults, null)).toEqual({ visible: defaults, hidden: [] })
  })

  it('follows the saved order and appends blocks shipped later', () => {
    expect(applyLayout(defaults, { order: ['c', 'a'], hidden: [] }).visible).toEqual(['c', 'a', 'b', 'd'])
  })

  it('drops saved ids that no longer exist and ignores duplicates', () => {
    expect(applyLayout(defaults, { order: ['x', 'b', 'b'], hidden: ['zzz'] })).toEqual({
      visible: ['b', 'a', 'c', 'd'],
      hidden: [],
    })
  })

  it('splits hidden blocks out', () => {
    expect(applyLayout(defaults, { order: ['d', 'c', 'b', 'a'], hidden: ['c'] })).toEqual({
      visible: ['d', 'b', 'a'],
      hidden: ['c'],
    })
  })
})

describe('layout prefs storage', () => {
  beforeEach(async () => {
    await resetDb()
    await getTestDb().delete(userSettings)
  })

  it('saves per screen, survives a read, and resets one screen', async () => {
    expect(await getLayoutPrefs()).toEqual({})
    await setScreenLayout('dashboard', { order: ['mine', 'owed'], hidden: ['feed'] })
    await setScreenLayout('person', { order: ['tasks'], hidden: [], collapsed: ['x'] })
    const saved = await getLayoutPrefs()
    expect(saved.dashboard).toEqual({ order: ['mine', 'owed'], hidden: ['feed'] })
    expect(saved.person?.collapsed).toEqual(['x'])
    await resetScreenLayout('dashboard')
    const after = await getLayoutPrefs()
    expect(after.dashboard).toBeUndefined()
    expect(after.person).toBeDefined()
  })

  it('rejects junk from a damaged value', () => {
    expect(parseLayoutPrefs('not json')).toEqual({})
    expect(parseLayoutPrefs(JSON.stringify({ dashboard: { order: ['a', 3, 'a', ''], hidden: 'x' }, other: { order: ['q'] } }))).toEqual({
      dashboard: { order: ['a'], hidden: [] },
    })
  })
})
