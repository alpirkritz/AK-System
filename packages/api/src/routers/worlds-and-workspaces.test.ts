import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { tasks, workspaces } from '@ak-system/database'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'

describe('worlds and workspaces', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('leaves existing workspaces as worlds', async () => {
    const caller = await createTestCaller()
    const list = await caller.workspaces.list()
    expect(list.every((w) => w.parentId == null)).toBe(true)
    const tree = await caller.workspaces.tree()
    expect(tree.map((w) => w.id)).toEqual(expect.arrayContaining(['ws_daz', 'ws_dragontail', 'ws_personal']))
    expect(tree.every((w) => w.children.length === 0)).toBe(true)
  })

  it('creates a workspace inside any world, including personal, and rejects a third level', async () => {
    const caller = await createTestCaller()
    const engineering = await caller.workspaces.create({ name: 'Engineering', parentId: 'ws_daz' })
    const family = await caller.workspaces.create({ name: 'משפחה', parentId: 'ws_personal' })
    expect(engineering.parentId).toBe('ws_daz')
    expect(family.parentId).toBe('ws_personal')

    await expect(caller.workspaces.create({ name: 'Squad', parentId: engineering.id })).rejects.toThrow(/עולם/)
    await expect(caller.workspaces.update({ id: 'ws_daz', parentId: 'ws_dragontail' })).rejects.toThrow()
  })

  it('merges a workspace into its world and keeps the task database link', async () => {
    const caller = await createTestCaller()
    const engineering = await caller.workspaces.create({ name: 'Engineering', parentId: 'ws_daz' })
    const db = getTestDb()
    const now = new Date().toISOString()
    await db.insert(tasks).values({
      id: 't_eng', title: 'משימה', workspaceId: engineering.id, status: 'not_started', priority: 'medium',
      source: 'manual', done: false, createdAt: now, updatedAt: now,
    })
    await caller.workspaces.linkNotionDatabase({
      workspaceId: engineering.id,
      notionDatabaseId: 'db_eng_test',
      notionDatabaseName: 'Engineering Tasks',
    })

    const preview = await caller.workspaces.mergePreview({ fromId: engineering.id, intoId: 'ws_daz' })
    expect(preview.tasks).toBe(1)
    expect(preview.databases).toBe(1)

    await caller.workspaces.merge({ fromId: engineering.id, intoId: 'ws_daz' })
    const [task] = await db.select().from(tasks).where(eq(tasks.id, 't_eng'))
    expect(task.workspaceId).toBe('ws_daz')
    const daz = await caller.workspaces.getById({ id: 'ws_daz' })
    expect(daz!.notionDatabases.map((d) => d.notionDatabaseName)).toContain('Engineering Tasks')
    expect(await db.select().from(workspaces).where(eq(workspaces.id, engineering.id))).toHaveLength(0)
  })

  it('refuses to merge across worlds', async () => {
    const caller = await createTestCaller()
    const engineering = await caller.workspaces.create({ name: 'Engineering', parentId: 'ws_daz' })
    await expect(caller.workspaces.merge({ fromId: engineering.id, intoId: 'ws_dragontail' })).rejects.toThrow(/אותו עולם/)
  })
})
