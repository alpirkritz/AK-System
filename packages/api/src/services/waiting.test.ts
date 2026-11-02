import { beforeEach, describe, expect, it } from 'vitest'
import { commitments, people, tasks } from '@ak-system/database'
import { getTestDb, resetDb } from '../test-utils'
import { ensureSelfPerson } from './self-person'
import { bucketWaiting, listWaiting, type WaitingItem } from './waiting'

const item = (id: string, dueDate: string | null, personName = 'ולרי'): WaitingItem => ({
  kind: 'task', id, title: id, personId: 'p', personName, personColor: null, dueDate, source: 'manual', sourceLabel: null, meetingId: null,
})

describe('bucketWaiting', () => {
  it('splits by due date around today and sorts', () => {
    const b = bucketWaiting(
      [item('late', '2026-10-30'), item('now', '2026-11-02'), item('soon', '2026-11-05'), item('far', '2026-12-01'), item('none', null)],
      '2026-11-02',
    )
    expect(b.overdue.map((i) => i.id)).toEqual(['late'])
    expect(b.today.map((i) => i.id)).toEqual(['now'])
    expect(b.thisWeek.map((i) => i.id)).toEqual(['soon'])
    expect(b.later.map((i) => i.id)).toEqual(['far'])
    expect(b.noDate.map((i) => i.id)).toEqual(['none'])
  })
})

describe('listWaiting', () => {
  const db = getTestDb()
  const NOW = new Date('2026-11-02T09:00:00.000Z')
  const stamp = NOW.toISOString()

  beforeEach(async () => {
    await resetDb()
  })

  const task = (id: string, assigneeId: string | null, extra: Partial<typeof tasks.$inferInsert> = {}) =>
    db.insert(tasks).values({ id, title: id, assigneeId, createdAt: stamp, updatedAt: stamp, ...extra })

  it('includes only open tasks assigned to someone else, plus task-less accepted commitments', async () => {
    const self = await ensureSelfPerson(db)
    await db.insert(people).values([
      { id: 'p_val', name: 'ולרי', status: 'confirmed', source: 'manual', createdAt: stamp },
      { id: 'p_dan', name: 'דני', status: 'confirmed', source: 'manual', createdAt: stamp },
    ])
    await task('t_val_today', 'p_val', { dueDate: '2026-11-02' })
    await task('t_val_done', 'p_val', { dueDate: '2026-11-02', status: 'done', done: true })
    await task('t_mine', self.id, { dueDate: '2026-11-02' })
    await task('t_nobody', null, { dueDate: '2026-11-02' })
    await db.insert(commitments).values([
      { id: 'c_dan', personId: 'p_dan', owner: 'them', content: 'לשלוח הצעה', source: 'whatsapp_dm', status: 'accepted', dueInferred: '2026-10-30', createdAt: stamp, updatedAt: stamp },
      { id: 'c_prop', personId: 'p_dan', owner: 'them', content: 'עוד לא אושר', source: 'whatsapp_dm', status: 'proposed', createdAt: stamp, updatedAt: stamp },
      { id: 'c_me', personId: 'p_dan', owner: 'me', content: 'עליי', source: 'whatsapp_dm', status: 'accepted', createdAt: stamp, updatedAt: stamp },
    ])

    const res = await listWaiting(db, { now: NOW })
    expect(res.today.map((i) => i.id)).toEqual(['t_val_today'])
    expect(res.overdue.map((i) => i.id)).toEqual(['c_dan'])
    expect(res.noDate).toHaveLength(0)

    const onlyDan = await listWaiting(db, { personId: 'p_dan', now: NOW })
    expect(onlyDan.today).toHaveLength(0)
    expect(onlyDan.overdue).toHaveLength(1)
  })
})
