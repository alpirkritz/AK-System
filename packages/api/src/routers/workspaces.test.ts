import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

describe('workspaces router — Notion database links', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('linkNotionDatabase attaches a database and surfaces it on getById + list', async () => {
    const caller = await createTestCaller()
    await caller.workspaces.linkNotionDatabase({
      workspaceId: 'ws_daz',
      notionDatabaseId: 'db-daz-1',
      notionDatabaseName: 'DAZ Tasks',
    })

    const daz = await caller.workspaces.getById({ id: 'ws_daz' })
    expect(daz!.notionDatabases.map((d) => d.notionDatabaseId)).toEqual(['db-daz-1'])

    const list = await caller.workspaces.list()
    const dazRow = list.find((w) => w.id === 'ws_daz')!
    expect(dazRow.notionDatabases).toHaveLength(1)
  })

  it('linking a database already claimed by another workspace throws', async () => {
    const caller = await createTestCaller()
    await caller.workspaces.linkNotionDatabase({ workspaceId: 'ws_daz', notionDatabaseId: 'db-shared' })
    await expect(
      caller.workspaces.linkNotionDatabase({ workspaceId: 'ws_dragontail', notionDatabaseId: 'db-shared' }),
    ).rejects.toThrow()
  })

  it('re-linking the same database to the same workspace is idempotent', async () => {
    const caller = await createTestCaller()
    const first = await caller.workspaces.linkNotionDatabase({ workspaceId: 'ws_daz', notionDatabaseId: 'db-x' })
    const second = await caller.workspaces.linkNotionDatabase({ workspaceId: 'ws_daz', notionDatabaseId: 'db-x' })
    expect(second.id).toBe(first.id)
    const daz = await caller.workspaces.getById({ id: 'ws_daz' })
    expect(daz!.notionDatabases).toHaveLength(1)
  })

  it('unlinkNotionDatabase removes the link', async () => {
    const caller = await createTestCaller()
    const link = await caller.workspaces.linkNotionDatabase({ workspaceId: 'ws_daz', notionDatabaseId: 'db-y' })
    await caller.workspaces.unlinkNotionDatabase({ id: link.id })
    const daz = await caller.workspaces.getById({ id: 'ws_daz' })
    expect(daz!.notionDatabases).toHaveLength(0)
  })

  it('deleting a workspace removes its database links', async () => {
    const caller = await createTestCaller()
    const ws = await caller.workspaces.create({ name: 'Linked' })
    await caller.workspaces.linkNotionDatabase({ workspaceId: ws.id, notionDatabaseId: 'db-del' })
    await caller.workspaces.delete({ id: ws.id })
    // The database id is now free to link elsewhere.
    await expect(
      caller.workspaces.linkNotionDatabase({ workspaceId: 'ws_daz', notionDatabaseId: 'db-del' }),
    ).resolves.toBeTruthy()
  })
})

describe('workspaces router — paste-a-link task databases', () => {
  const CUSTOM_ID = 'abcdef01-2345-6789-abcd-ef0123456789'
  const ENV_TASK_ID = 'envtaskdb0000000000000000000000'
  let prevAccounts: string | undefined
  let prevKey: string | undefined

  beforeEach(async () => {
    await resetDb()
    prevAccounts = process.env.NOTION_ACCOUNTS
    prevKey = process.env.NOTION_API_KEY
    delete process.env.NOTION_API_KEY
    process.env.NOTION_ACCOUNTS = JSON.stringify([
      {
        label: 'Test',
        token: 'ntn_test',
        databases: [{ id: ENV_TASK_ID, name: 'Env Tasks', type: 'tasks' }],
      },
    ])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (prevAccounts === undefined) delete process.env.NOTION_ACCOUNTS
    else process.env.NOTION_ACCOUNTS = prevAccounts
    if (prevKey === undefined) delete process.env.NOTION_API_KEY
    else process.env.NOTION_API_KEY = prevKey
  })

  it('addNotionTaskDatabase links a pasted database to the workspace', async () => {
    const caller = await createTestCaller()
    const created = await caller.workspaces.addNotionTaskDatabase({
      workspaceId: 'ws_daz',
      accountLabel: 'Test',
      notionDatabaseId: CUSTOM_ID,
      notionDatabaseName: 'Engineering Tasks',
    })
    expect(created.accountLabel).toBe('Test')
    expect(created.workspaceId).toBe('ws_daz')

    const listed = await caller.workspaces.listNotionDatabases()
    const custom = listed.find((d) => d.notionDatabaseId === CUSTOM_ID)
    expect(custom?.source).toBe('custom')
    expect(custom?.linkedWorkspaceId).toBe('ws_daz')
    const env = listed.find((d) => d.notionDatabaseId === ENV_TASK_ID)
    expect(env?.source).toBe('env')
  })

  it('rejects a database that is already registered', async () => {
    const caller = await createTestCaller()
    await caller.workspaces.addNotionTaskDatabase({
      workspaceId: 'ws_daz',
      accountLabel: 'Test',
      notionDatabaseId: CUSTOM_ID,
      notionDatabaseName: 'Engineering Tasks',
    })
    await expect(
      caller.workspaces.addNotionTaskDatabase({
        workspaceId: 'ws_dragontail',
        accountLabel: 'Test',
        notionDatabaseId: CUSTOM_ID,
        notionDatabaseName: 'Engineering Tasks',
      }),
    ).rejects.toThrow('כבר רשום')
  })

  it('rejects an unknown Notion account and an unknown workspace', async () => {
    const caller = await createTestCaller()
    await expect(
      caller.workspaces.addNotionTaskDatabase({
        workspaceId: 'ws_daz',
        accountLabel: 'Missing',
        notionDatabaseId: CUSTOM_ID,
        notionDatabaseName: 'Engineering Tasks',
      }),
    ).rejects.toThrow('חשבון Notion לא נמצא')
    await expect(
      caller.workspaces.addNotionTaskDatabase({
        workspaceId: 'ws_missing',
        accountLabel: 'Test',
        notionDatabaseId: CUSTOM_ID,
        notionDatabaseName: 'Engineering Tasks',
      }),
    ).rejects.toThrow('המקור לא נמצא')
  })

  it('rejects an empty workspace id', async () => {
    const caller = await createTestCaller()
    await expect(
      caller.workspaces.addNotionTaskDatabase({
        workspaceId: '',
        accountLabel: 'Test',
        notionDatabaseId: CUSTOM_ID,
        notionDatabaseName: 'Engineering Tasks',
      }),
    ).rejects.toThrow()
  })

  it('resolveNotionTaskDatabaseLink rejects text with no database id before calling Notion', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const caller = await createTestCaller()
    await expect(
      caller.workspaces.resolveNotionTaskDatabaseLink({ accountLabel: 'Test', link: 'not-a-link' }),
    ).rejects.toThrow('לא זיהיתי מזהה')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('resolveNotionTaskDatabaseLink reports when the integration is not shared', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => 'object_not_found',
    } as unknown as Response)))
    const caller = await createTestCaller()
    await expect(
      caller.workspaces.resolveNotionTaskDatabaseLink({ accountLabel: 'Test', link: CUSTOM_ID }),
    ).rejects.toThrow('לא משותפת')
  })

  it('tasks.notionConfigured is true from a pasted database when env has no task databases', async () => {
    process.env.NOTION_ACCOUNTS = JSON.stringify([
      { label: 'Test', token: 'ntn_test', databases: [{ id: 'people-only', name: 'People', type: 'people' }] },
    ])
    const caller = await createTestCaller()
    expect((await caller.tasks.notionConfigured()).configured).toBe(false)
    await caller.workspaces.addNotionTaskDatabase({
      workspaceId: 'ws_daz',
      accountLabel: 'Test',
      notionDatabaseId: CUSTOM_ID,
      notionDatabaseName: 'Engineering Tasks',
    })
    expect((await caller.tasks.notionConfigured()).configured).toBe(true)
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
