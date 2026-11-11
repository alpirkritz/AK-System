import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { commitments, people, taskPeople, tasks } from '@ak-system/database'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'
import { ensureSelfPerson } from '../services/self-person'

describe('waiting.complete', () => {
  const db = getTestDb()
  const stamp = new Date().toISOString()

  beforeEach(async () => {
    await resetDb()
    await db.insert(people).values({ id: 'p_w', name: 'ולרי', status: 'confirmed', source: 'manual', createdAt: stamp })
  })

  it('closes a task and a task-less commitment', async () => {
    const caller = await createTestCaller()
    await db.insert(tasks).values({ id: 't_w', title: 'x', assigneeId: 'p_w', createdAt: stamp, updatedAt: stamp })
    await db.insert(commitments).values({
      id: 'c_w', personId: 'p_w', owner: 'them', content: 'y', source: 'whatsapp_dm', status: 'accepted', createdAt: stamp, updatedAt: stamp,
    })
    await caller.waiting.complete({ kind: 'task', id: 't_w' })
    await caller.waiting.complete({ kind: 'commitment', id: 'c_w' })
    const [t] = await db.select().from(tasks).where(eq(tasks.id, 't_w'))
    expect(t).toMatchObject({ status: 'done', done: true })
    const [c] = await db.select().from(commitments).where(eq(commitments.id, 'c_w'))
    expect(c!.status).toBe('dismissed')
    const left = await caller.waiting.list()
    expect(Object.values(left).flat()).toHaveLength(0)
  })

  it('reports a missing task', async () => {
    const caller = await createTestCaller()
    await expect(caller.waiting.complete({ kind: 'task', id: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('waiting.quickAdd', () => {
  const db = getTestDb()
  const stamp = new Date().toISOString()
  let waiting: Awaited<ReturnType<typeof createTestCaller>>['waiting']

  beforeEach(async () => {
    await resetDb()
    waiting = (await createTestCaller()).waiting
    await db.insert(people).values({ id: 'p_shani', name: 'שני', status: 'confirmed', source: 'manual', createdAt: stamp })
  })

  it('iOwe: task on me, linked to the person', async () => {
    const self = await ensureSelfPerson(db)
    const res = await waiting.quickAdd({ personId: 'p_shani', title: 'לשלוח הצעה', direction: 'iOwe' })
    const [t] = await db.select().from(tasks).where(eq(tasks.id, res.id))
    expect(t.assigneeId).toBe(self.id)
    const links = await db.select().from(taskPeople).where(eq(taskPeople.taskId, res.id))
    expect(links.map((l) => l.personId)).toEqual(['p_shani'])
    const owed = await waiting.owedByMe({ personId: 'p_shani' })
    expect(owed.noDate.map((i) => i.id)).toEqual([res.id])
  })

  it('theyOwe: task assigned to them shows in waiting.list, not owedByMe', async () => {
    const res = await waiting.quickAdd({ personId: 'p_shani', title: 'לשלוח חומר', direction: 'theyOwe' })
    const [t] = await db.select().from(tasks).where(eq(tasks.id, res.id))
    expect(t.assigneeId).toBe('p_shani')
    expect((await waiting.list({ personId: 'p_shani' })).noDate.map((i) => i.id)).toEqual([res.id])
    expect((await waiting.owedByMe({ personId: 'p_shani' })).noDate).toHaveLength(0)
  })

  it('commitment: accepted owner=them, and refuses the iOwe direction', async () => {
    const res = await waiting.quickAdd({ personId: 'p_shani', title: 'יחזור אליי', direction: 'theyOwe', as: 'commitment' })
    const [c] = await db.select().from(commitments).where(eq(commitments.id, res.id))
    expect(c).toMatchObject({ owner: 'them', status: 'accepted', personId: 'p_shani' })
    await expect(
      waiting.quickAdd({ personId: 'p_shani', title: 'x', direction: 'iOwe', as: 'commitment' }),
    ).rejects.toThrow()
  })

  it('rejects an unknown person and a blank title', async () => {
    await expect(waiting.quickAdd({ personId: 'nope', title: 'x', direction: 'iOwe' })).rejects.toThrow()
    await expect(waiting.quickAdd({ personId: 'p_shani', title: '  ', direction: 'iOwe' })).rejects.toThrow()
  })
})
