import { beforeEach, describe, expect, it } from 'vitest'
import { commitments, people, taskPeople, tasks } from '@ak-system/database'
import { getTestDb, resetDb } from '../test-utils'
import { ensureSelfPerson } from './self-person'
import { bucketWaiting, listOwedByMe, listWaiting, type WaitingItem } from './waiting'

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

describe('listOwedByMe', () => {
  const db = getTestDb()
  const NOW = new Date('2026-11-02T09:00:00.000Z')
  const stamp = NOW.toISOString()

  beforeEach(async () => {
    await resetDb()
  })

  it('counts only open tasks assigned to me and linked to the person', async () => {
    const self = await ensureSelfPerson(db)
    await db.insert(people).values([
      { id: 'p_shani', name: 'שני', status: 'confirmed', source: 'manual', createdAt: stamp },
      { id: 'p_dan', name: 'דני', status: 'confirmed', source: 'manual', createdAt: stamp },
    ])
    const task = (id: string, assigneeId: string | null, extra: Partial<typeof tasks.$inferInsert> = {}) =>
      db.insert(tasks).values({ id, title: id, assigneeId, createdAt: stamp, updatedAt: stamp, ...extra })
    await task('t_mine_late', self.id, { dueDate: '2026-10-30' })
    await task('t_mine_nodate', self.id)
    await task('t_mine_done', self.id, { status: 'done', done: true })
    await task('t_nobody', null)
    await task('t_dan_owns', 'p_dan')
    await task('t_mine_other_person', self.id)
    await db.insert(taskPeople).values([
      { taskId: 't_mine_late', personId: 'p_shani' },
      { taskId: 't_mine_nodate', personId: 'p_shani' },
      { taskId: 't_mine_done', personId: 'p_shani' },
      { taskId: 't_nobody', personId: 'p_shani' },
      { taskId: 't_dan_owns', personId: 'p_shani' },
      { taskId: 't_mine_other_person', personId: 'p_dan' },
    ])
    await db.insert(commitments).values({
      id: 'c_me', personId: 'p_shani', owner: 'me', content: 'עליי', source: 'whatsapp_dm', status: 'accepted', createdAt: stamp, updatedAt: stamp,
    })

    const res = await listOwedByMe(db, { personId: 'p_shani', now: NOW })
    expect(res.overdue.map((i) => i.id)).toEqual(['t_mine_late'])
    expect(res.noDate.map((i) => i.id)).toEqual(['t_mine_nodate'])
    expect(res.today).toHaveLength(0)
    expect(res.thisWeek).toHaveLength(0)
    expect(res.later).toHaveLength(0)
  })

  it('returns nothing for the owner themself', async () => {
    const self = await ensureSelfPerson(db)
    const res = await listOwedByMe(db, { personId: self.id, now: NOW })
    expect(res.noDate).toHaveLength(0)
  })
})
