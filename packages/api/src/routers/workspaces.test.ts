import { describe, it, expect, beforeEach } from 'vitest'
import { createTestCaller, resetDb } from '../test-utils'

describe('workspaces router', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('list returns the seeded default workspaces', async () => {
    const caller = await createTestCaller()
    const list = await caller.workspaces.list()
    const names = list.map((w) => w.name)
    expect(names).toEqual(expect.arrayContaining(['Alpir Consulting', 'Dragontail', 'DAZ', 'פרטי']))
    expect(list.map((w) => w.id)).toEqual(expect.arrayContaining(['ws_personal']))
  })

  it('create adds a workspace with color and notion label', async () => {
    const caller = await createTestCaller()
    const created = await caller.workspaces.create({
      name: 'Side Project',
      color: '#38bdf8',
      notionAccountLabel: 'Side DB',
    })
    expect(created.name).toBe('Side Project')
    expect(created.color).toBe('#38bdf8')
    expect(created.notionAccountLabel).toBe('Side DB')

    const found = await caller.workspaces.getById({ id: created.id })
    expect(found!.name).toBe('Side Project')
  })

  it('create stores a blank notion label as null', async () => {
    const caller = await createTestCaller()
    const created = await caller.workspaces.create({ name: 'No Label', notionAccountLabel: '   ' })
    expect(created.notionAccountLabel).toBeNull()
  })

  it('update modifies name, color and notion label', async () => {
    const caller = await createTestCaller()
    const created = await caller.workspaces.create({ name: 'Temp' })
    const updated = await caller.workspaces.update({
      id: created.id,
      name: 'Renamed',
      color: '#fb7185',
      notionAccountLabel: 'DT - Action items',
    })
    expect(updated!.name).toBe('Renamed')
    expect(updated!.color).toBe('#fb7185')
    expect(updated!.notionAccountLabel).toBe('DT - Action items')
  })

  it('update clears the notion label when set to null', async () => {
    const caller = await createTestCaller()
    const created = await caller.workspaces.create({ name: 'Temp', notionAccountLabel: 'X' })
    const updated = await caller.workspaces.update({ id: created.id, notionAccountLabel: null })
    expect(updated!.notionAccountLabel).toBeNull()
    expect(updated!.name).toBe('Temp')
  })

  it('delete removes the workspace and unassigns its tasks', async () => {
    const caller = await createTestCaller()
    const ws = await caller.workspaces.create({ name: 'Doomed' })
    const task = await caller.tasks.create({ title: 'Orphan me', workspaceId: ws.id })
    expect(task.workspaceId).toBe(ws.id)

    await caller.workspaces.delete({ id: ws.id })

    expect(await caller.workspaces.getById({ id: ws.id })).toBeNull()
    const survivor = await caller.tasks.getById({ id: task.id })
    expect(survivor).not.toBeNull()
    expect(survivor!.workspaceId).toBeNull()
  })
})

describe('tasks router — workspace dimension', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('create persists workspaceId and defaults to null when omitted', async () => {
    const caller = await createTestCaller()
    const withWorkspace = await caller.tasks.create({ title: 'Scoped', workspaceId: 'ws_daz' })
    const without = await caller.tasks.create({ title: 'Unscoped' })
    expect(withWorkspace.workspaceId).toBe('ws_daz')
    expect(without.workspaceId).toBeNull()
  })

  it('update reassigns and clears the workspace', async () => {
    const caller = await createTestCaller()
    const task = await caller.tasks.create({ title: 'Movable', workspaceId: 'ws_daz' })
    const moved = await caller.tasks.update({ id: task.id, workspaceId: 'ws_dragontail' })
    expect(moved!.workspaceId).toBe('ws_dragontail')
    const cleared = await caller.tasks.update({ id: task.id, workspaceId: null })
    expect(cleared!.workspaceId).toBeNull()
  })

  it('update leaves the workspace untouched when the field is omitted', async () => {
    const caller = await createTestCaller()
    const task = await caller.tasks.create({ title: 'Keep source', workspaceId: 'ws_personal' })
    const renamed = await caller.tasks.update({ id: task.id, title: 'Renamed' })
    expect(renamed!.title).toBe('Renamed')
    expect(renamed!.workspaceId).toBe('ws_personal')
  })

  it('list returns every task when no filter is passed', async () => {
    const caller = await createTestCaller()
    await caller.tasks.create({ title: 'A', workspaceId: 'ws_daz' })
    await caller.tasks.create({ title: 'B' })
    const all = await caller.tasks.list()
    expect(all).toHaveLength(2)
  })

  it('list filters by workspaceId', async () => {
    const caller = await createTestCaller()
    await caller.tasks.create({ title: 'DAZ task', workspaceId: 'ws_daz' })
    await caller.tasks.create({ title: 'Personal task', workspaceId: 'ws_personal' })
    const dazOnly = await caller.tasks.list({ workspaceId: 'ws_daz' })
    expect(dazOnly.map((t) => t.title)).toEqual(['DAZ task'])
  })

  it('listByWorkspace returns only that workspace tasks', async () => {
    const caller = await createTestCaller()
    await caller.tasks.create({ title: 'DT task', workspaceId: 'ws_dragontail' })
    await caller.tasks.create({ title: 'Other', workspaceId: 'ws_daz' })
    const rows = await caller.tasks.listByWorkspace({ workspaceId: 'ws_dragontail' })
    expect(rows.map((t) => t.title)).toEqual(['DT task'])
  })
})
