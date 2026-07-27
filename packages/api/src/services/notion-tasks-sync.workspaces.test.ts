import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getDb, people, tasks, taskPeople, workspaces, eq } from '@ak-system/database'
import {
  buildWorkspaceLabelMap,
  resolveWorkspaceId,
  syncNotionTasks,
} from './notion-tasks-sync'

describe('buildWorkspaceLabelMap', () => {
  it('indexes labels lowercased and skips blank ones', () => {
    const map = buildWorkspaceLabelMap([
      { id: 'ws_a', notionAccountLabel: 'DT - Action items' },
      { id: 'ws_b', notionAccountLabel: '   ' },
      { id: 'ws_c', notionAccountLabel: null },
    ])
    expect(map.get('dt - action items')).toBe('ws_a')
    expect(map.size).toBe(1)
  })
})

describe('resolveWorkspaceId', () => {
  it('matches the database name case-insensitively', () => {
    const map = buildWorkspaceLabelMap([{ id: 'ws_dt', notionAccountLabel: 'dt - action items' }])
    expect(resolveWorkspaceId(map, { name: 'DT - Action items', accountLabel: 'DAZ' })).toBe('ws_dt')
  })

  it('falls back to the account label when the database name does not match', () => {
    const map = buildWorkspaceLabelMap([{ id: 'ws_daz', notionAccountLabel: 'DAZ' }])
    expect(resolveWorkspaceId(map, { name: 'Some DB', accountLabel: 'daz' })).toBe('ws_daz')
  })

  it('prefers the database name over the account label', () => {
    const map = buildWorkspaceLabelMap([
      { id: 'ws_dt', notionAccountLabel: 'DT - Action items' },
      { id: 'ws_daz', notionAccountLabel: 'DAZ' },
    ])
    expect(resolveWorkspaceId(map, { name: 'DT - Action items', accountLabel: 'DAZ' })).toBe('ws_dt')
  })

  it('returns null when nothing matches', () => {
    const map = buildWorkspaceLabelMap([{ id: 'ws_x', notionAccountLabel: 'Other' }])
    expect(resolveWorkspaceId(map, { name: 'Tasks', accountLabel: 'Test' })).toBeNull()
  })
})

// ── Integration: synced tasks land in the mapped workspace ───────────────────

const TASKS_DB = 'tasksdb1111111111111111111111111'

function titleProp(text: string) {
  return { type: 'title', title: [{ plain_text: text }] }
}
function peopleProp(...names: string[]) {
  return { type: 'people', people: names.map((name) => ({ name })) }
}

let taskPages: Array<{ id: string; properties: Record<string, unknown> }> = []

const ORIGINAL_ENV = { ...process.env }

beforeEach(async () => {
  const db = getDb()
  await db.delete(taskPeople)
  await db.delete(tasks)
  await db.delete(people)
  taskPages = [
    { id: 'ws-task-1', properties: { Name: titleProp('Mapped task'), Assignee: peopleProp('Alpir Kritzler') } },
  ]
  process.env.NOTION_USER_NAME = 'Alpir Kritzler'
  process.env.NOTION_ACCOUNTS = JSON.stringify([
    {
      label: 'DAZ',
      token: 'ntn_test',
      databases: [{ id: TASKS_DB, name: 'DT - Action items', type: 'tasks' }],
    },
  ])
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ results: taskPages, has_more: false, next_cursor: null }),
    }) as unknown as Response),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...ORIGINAL_ENV }
})

describe('syncNotionTasks workspace assignment', () => {
  it('assigns the workspace whose notion label matches the database name', async () => {
    const db = getDb()
    await db
      .update(workspaces)
      .set({ notionAccountLabel: 'DT - Action items' })
      .where(eq(workspaces.id, 'ws_dragontail'))

    await syncNotionTasks({ windowDays: 60 })

    const [row] = await db.select().from(tasks).where(eq(tasks.title, 'Mapped task'))
    expect(row.workspaceId).toBe('ws_dragontail')
    expect(row.notionDb).toBe('DT - Action items')
  })

  it('leaves workspaceId null when no workspace label matches', async () => {
    const db = getDb()
    await db.update(workspaces).set({ notionAccountLabel: null })

    await syncNotionTasks({ windowDays: 60 })

    const [row] = await db.select().from(tasks).where(eq(tasks.title, 'Mapped task'))
    expect(row.workspaceId).toBeNull()
  })

  it('re-running the sync keeps the mapped workspace on the existing task', async () => {
    const db = getDb()
    await db
      .update(workspaces)
      .set({ notionAccountLabel: 'DAZ' })
      .where(eq(workspaces.id, 'ws_daz'))

    await syncNotionTasks({ windowDays: 60 })
    const second = await syncNotionTasks({ windowDays: 60 })
    expect(second.tasksUpdated).toBe(1)

    const [row] = await db.select().from(tasks).where(eq(tasks.title, 'Mapped task'))
    expect(row.workspaceId).toBe('ws_daz')
  })
})
