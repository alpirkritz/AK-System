import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { commitments, people, tasks } from '@ak-system/database'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'

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
