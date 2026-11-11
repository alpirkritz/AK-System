/**
 * Tests for docs/specs/waiting-commitment-open.md — commitments.linkTask.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { commitments, people, tasks } from '@ak-system/database'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'

const db = getTestDb()
const stamp = new Date().toISOString()

async function seedCommitment(over: { id?: string; status?: string; owner?: string; taskId?: string | null } = {}) {
  const id = over.id ?? 'c_l'
  await db.insert(commitments).values({
    id,
    personId: 'p_l',
    owner: over.owner ?? 'them',
    content: 'מתן פידבק ישיר לירדן',
    source: 'voice',
    status: over.status ?? 'accepted',
    taskId: over.taskId ?? null,
    createdAt: stamp,
    updatedAt: stamp,
  })
  return id
}

describe('commitments.linkTask', () => {
  beforeEach(async () => {
    await resetDb()
    await db.insert(people).values({ id: 'p_l', name: 'טל זמיר', status: 'confirmed', source: 'manual', createdAt: stamp })
  })

  it('links a task to an accepted them-commitment and the waiting list swaps it for the task', async () => {
    const caller = await createTestCaller()
    await seedCommitment()
    const before = Object.values(await caller.waiting.list()).flat()
    expect(before.map((i) => i.kind)).toEqual(['commitment'])

    const task = await caller.tasks.create({ title: 'מתן פידבק ישיר לירדן', assigneeId: 'p_l' })
    const res = await caller.commitments.linkTask({ commitmentId: 'c_l', taskId: task.id })
    expect(res).toEqual({ ok: true, taskId: task.id })

    const [c] = await db.select().from(commitments).where(eq(commitments.id, 'c_l'))
    expect(c!.taskId).toBe(task.id)
    const after = Object.values(await caller.waiting.list()).flat()
    expect(after.map((i) => [i.kind, i.id])).toEqual([['task', task.id]])
  })

  it.each([
    ['already linked', { taskId: 't_existing' }],
    ['proposed', { status: 'proposed' }],
    ['dismissed', { status: 'dismissed' }],
    ['owner=me', { owner: 'me' }],
  ])('rejects a commitment that is %s', async (_label, over) => {
    const caller = await createTestCaller()
    await db.insert(tasks).values({ id: 't_existing', title: 'x', createdAt: stamp, updatedAt: stamp })
    await db.insert(tasks).values({ id: 't_new', title: 'y', createdAt: stamp, updatedAt: stamp })
    await seedCommitment(over)
    await expect(caller.commitments.linkTask({ commitmentId: 'c_l', taskId: 't_new' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    const [c] = await db.select().from(commitments).where(eq(commitments.id, 'c_l'))
    expect(c!.taskId).toBe(over.taskId ?? null)
  })

  it('reports a missing commitment or task', async () => {
    const caller = await createTestCaller()
    await seedCommitment()
    await expect(caller.commitments.linkTask({ commitmentId: 'nope', taskId: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(caller.commitments.linkTask({ commitmentId: 'c_l', taskId: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
