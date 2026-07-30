import { describe, it, expect, beforeEach } from 'vitest'
import { createTestCaller, resetDb, getTestDb } from '../test-utils'
import { tasks } from '@ak-system/database'

describe('notionStatusOverrides router', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('upsert creates then updates a single override per raw label', async () => {
    const caller = await createTestCaller()
    const created = await caller.notionStatusOverrides.upsert({ rawLabel: 'In Review', canonicalStatus: 'blocked' })
    expect(created.canonicalStatus).toBe('blocked')

    const updated = await caller.notionStatusOverrides.upsert({ rawLabel: 'In Review', canonicalStatus: 'in_progress' })
    expect(updated.id).toBe(created.id)
    expect(updated.canonicalStatus).toBe('in_progress')

    const list = await caller.notionStatusOverrides.list()
    expect(list).toHaveLength(1)
  })

  it('delete removes an override', async () => {
    const caller = await createTestCaller()
    const created = await caller.notionStatusOverrides.upsert({ rawLabel: 'Parked', canonicalStatus: 'blocked' })
    await caller.notionStatusOverrides.delete({ id: created.id })
    expect(await caller.notionStatusOverrides.list()).toHaveLength(0)
  })

  it('unmapped returns distinct raw labels with counts + a guess, excluding overridden ones', async () => {
    const caller = await createTestCaller()
    const db = getTestDb()
    const now = new Date().toISOString()
    // Two notion tasks with a raw status, one with a different raw status.
    await db.insert(tasks).values([
      { id: 't1', title: 'A', done: false, status: 'not_started', priority: 'medium', source: 'notion', notionStatusRaw: 'In Review', createdAt: now, updatedAt: now },
      { id: 't2', title: 'B', done: false, status: 'not_started', priority: 'medium', source: 'notion', notionStatusRaw: 'In Review', createdAt: now, updatedAt: now },
      { id: 't3', title: 'C', done: true, status: 'done', priority: 'medium', source: 'notion', notionStatusRaw: 'Shipped', createdAt: now, updatedAt: now },
    ])

    let unmapped = await caller.notionStatusOverrides.unmapped()
    const review = unmapped.find((u) => u.rawLabel === 'In Review')
    expect(review?.taskCount).toBe(2)
    expect(review?.guessedStatus).toBe('not_started') // "In Review" has no keyword → falls through
    expect(unmapped.map((u) => u.rawLabel).sort()).toEqual(['In Review', 'Shipped'])

    // Once overridden, "In Review" drops out of the unmapped list.
    await caller.notionStatusOverrides.upsert({ rawLabel: 'In Review', canonicalStatus: 'blocked' })
    unmapped = await caller.notionStatusOverrides.unmapped()
    expect(unmapped.map((u) => u.rawLabel)).toEqual(['Shipped'])
  })
})

describe('tasks router — status ⇄ done coupling', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('create derives done from an explicit status', async () => {
    const caller = await createTestCaller()
    const done = await caller.tasks.create({ title: 'Finished', status: 'done' })
    expect(done.done).toBe(true)
    expect(done.status).toBe('done')

    const cancelled = await caller.tasks.create({ title: 'Dropped', status: 'cancelled' })
    expect(cancelled.done).toBe(true)

    const active = await caller.tasks.create({ title: 'Doing', status: 'in_progress' })
    expect(active.done).toBe(false)
  })

  it('create derives status from the legacy done flag when status omitted', async () => {
    const caller = await createTestCaller()
    const t = await caller.tasks.create({ title: 'Legacy done', done: true })
    expect(t.status).toBe('done')
  })

  it('update sets done in lockstep when status changes', async () => {
    const caller = await createTestCaller()
    const t = await caller.tasks.create({ title: 'Task', status: 'in_progress' })
    const blocked = await caller.tasks.update({ id: t.id, status: 'blocked' })
    expect(blocked!.status).toBe('blocked')
    expect(blocked!.done).toBe(false)
    const done = await caller.tasks.update({ id: t.id, status: 'done' })
    expect(done!.done).toBe(true)
  })

  it('toggleDone flips done and syncs the canonical status', async () => {
    const caller = await createTestCaller()
    const t = await caller.tasks.create({ title: 'Toggle me', status: 'in_progress' })
    const toggled = await caller.tasks.toggleDone({ id: t.id })
    expect(toggled!.done).toBe(true)
    expect(toggled!.status).toBe('done')
    const back = await caller.tasks.toggleDone({ id: t.id })
    expect(back!.done).toBe(false)
    expect(back!.status).toBe('not_started')
  })
})
