import { describe, expect, it } from 'vitest'
import { migrateLegacyPending, patchPending, removePending, upsertPending, type PendingUpload } from './pending-recordings'

const item = (id: string, extra: Partial<PendingUpload> = {}): PendingUpload => ({
  id,
  createdAt: '2026-11-05T10:00:00.000Z',
  uri: `file:///doc/voice-pending/${id}.m4a`,
  durationSeconds: 3600,
  personIds: [],
  personNames: [],
  state: 'review',
  ...extra,
})

describe('pending recordings list', () => {
  it('migrates the old single-recording value into a list entry', () => {
    const raw = JSON.stringify({ uri: 'file:///cache/a.m4a', durationSeconds: 61.4, personIds: ['p1'], personNames: ['דנה'], meetingId: 'm1' })
    const migrated = migrateLegacyPending(raw, Date.UTC(2026, 10, 5))
    expect(migrated).toMatchObject({ uri: 'file:///cache/a.m4a', durationSeconds: 61.4, personIds: ['p1'], meetingId: 'm1', state: 'pending' })
    expect(migrated?.id).toMatch(/^mob/)
  })

  it('ignores an empty or broken legacy value', () => {
    expect(migrateLegacyPending(null)).toBeNull()
    expect(migrateLegacyPending('not json')).toBeNull()
    expect(migrateLegacyPending('{"durationSeconds":3}')).toBeNull()
  })

  it('keeps several recordings — a new one never replaces an unsent one', () => {
    let list = upsertPending([], item('a', { state: 'pending' }))
    list = upsertPending(list, item('b'))
    expect(list.map((p) => p.id)).toEqual(['a', 'b'])
    list = upsertPending(list, item('b', { personNames: ['דנה'] }))
    expect(list).toHaveLength(2)
    expect(list[1].personNames).toEqual(['דנה'])
  })

  it('patches and removes by id only', () => {
    const list = [item('a'), item('b')]
    expect(patchPending(list, 'b', { state: 'pending', lastError: 'x' })[1]).toMatchObject({ state: 'pending', lastError: 'x' })
    expect(patchPending(list, 'b', { state: 'pending' })[0].state).toBe('review')
    expect(removePending(list, 'a').map((p) => p.id)).toEqual(['b'])
  })
})
