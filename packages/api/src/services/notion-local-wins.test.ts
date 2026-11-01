import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { tasks } from '@ak-system/database'
import { resetDb, getTestDb } from '../test-utils'
import { getLocalOverrides, resetNotionField, updateFromNotion } from './notion-local-wins'

const now = new Date().toISOString()

async function seedTask() {
  const db = getTestDb()
  await db.insert(tasks).values({
    id: 't1', title: 'From Notion', done: false, status: 'not_started', priority: 'medium',
    source: 'notion', notionPageId: 'np1', createdAt: now, updatedAt: now,
  })
  return db
}

describe('notion local-wins guard', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('applies Notion values while the row is untouched locally', async () => {
    const db = await seedTask()
    await updateFromNotion(db, tasks, 'task', 't1', { title: 'N1', priority: 'high' })
    await updateFromNotion(db, tasks, 'task', 't1', { title: 'N2', priority: 'high' })
    const [row] = await db.select().from(tasks).where(eq(tasks.id, 't1'))
    expect(row!.title).toBe('N2')
  })

  it('keeps a locally edited field but still updates the others', async () => {
    const db = await seedTask()
    await updateFromNotion(db, tasks, 'task', 't1', { title: 'N1', priority: 'low' })
    await db.update(tasks).set({ title: 'My title' }).where(eq(tasks.id, 't1'))

    const { skipped } = await updateFromNotion(db, tasks, 'task', 't1', { title: 'N2', priority: 'high' })

    const [row] = await db.select().from(tasks).where(eq(tasks.id, 't1'))
    expect(skipped).toEqual(['title'])
    expect(row!.title).toBe('My title')
    expect(row!.priority).toBe('high')
    expect(await getLocalOverrides(db, 'task', 't1', row as Record<string, unknown>)).toEqual(['title'])
  })

  it('converges when Notion catches up with the local edit (write-back)', async () => {
    const db = await seedTask()
    await updateFromNotion(db, tasks, 'task', 't1', { status: 'not_started' })
    await db.update(tasks).set({ status: 'done' }).where(eq(tasks.id, 't1'))
    await updateFromNotion(db, tasks, 'task', 't1', { status: 'done' })
    const [row] = await db.select().from(tasks).where(eq(tasks.id, 't1'))
    expect(await getLocalOverrides(db, 'task', 't1', row as Record<string, unknown>)).toEqual([])
    // Later Notion change now flows in again.
    await updateFromNotion(db, tasks, 'task', 't1', { status: 'blocked' })
    const [after] = await db.select().from(tasks).where(eq(tasks.id, 't1'))
    expect(after!.status).toBe('blocked')
  })

  it('reset-to-Notion lets the next sync overwrite the local edit', async () => {
    const db = await seedTask()
    await updateFromNotion(db, tasks, 'task', 't1', { title: 'N1' })
    await db.update(tasks).set({ title: 'Mine' }).where(eq(tasks.id, 't1'))
    await resetNotionField(db, 'task', 't1', 'title', 'Mine')
    await updateFromNotion(db, tasks, 'task', 't1', { title: 'N2' })
    const [row] = await db.select().from(tasks).where(eq(tasks.id, 't1'))
    expect(row!.title).toBe('N2')
  })
})
