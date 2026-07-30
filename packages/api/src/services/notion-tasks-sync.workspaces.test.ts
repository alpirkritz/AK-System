import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getDb,
  people,
  tasks,
  taskPeople,
  workspaces,
  workspaceNotionDatabases,
  notionStatusOverrides,
  eq,
} from '@ak-system/database'
import {
  buildWorkspaceLabelMap,
  resolveWorkspaceId,
  guessCanonicalStatus,
  resolveCanonicalStatus,
  syncNotionTasks,
  type CanonicalStatus,
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

  it('prefers an explicit database-id link over the label match', () => {
    const labels = buildWorkspaceLabelMap([{ id: 'ws_label', notionAccountLabel: 'DT - Action items' }])
    const byDbId = new Map<string, string>([['db-123', 'ws_linked']])
    expect(
      resolveWorkspaceId(labels, { name: 'DT - Action items', accountLabel: 'DAZ', databaseId: 'db-123' }, byDbId),
    ).toBe('ws_linked')
  })

  it('falls back to the label match when no database-id link exists', () => {
    const labels = buildWorkspaceLabelMap([{ id: 'ws_label', notionAccountLabel: 'DAZ' }])
    const byDbId = new Map<string, string>([['db-other', 'ws_other']])
    expect(
      resolveWorkspaceId(labels, { name: 'Tasks', accountLabel: 'DAZ', databaseId: 'db-123' }, byDbId),
    ).toBe('ws_label')
  })
})

describe('guessCanonicalStatus', () => {
  it('buckets common english + hebrew labels', () => {
    expect(guessCanonicalStatus('Done')).toBe('done')
    expect(guessCanonicalStatus('Completed')).toBe('done')
    expect(guessCanonicalStatus('הושלם')).toBe('done')
    expect(guessCanonicalStatus('Cancelled')).toBe('cancelled')
    expect(guessCanonicalStatus('בוטל')).toBe('cancelled')
    expect(guessCanonicalStatus('In progress')).toBe('in_progress')
    expect(guessCanonicalStatus('בתהליך')).toBe('in_progress')
    expect(guessCanonicalStatus('Blocked')).toBe('blocked')
    expect(guessCanonicalStatus('Not started')).toBe('not_started')
    expect(guessCanonicalStatus('')).toBe('not_started')
    expect(guessCanonicalStatus('Something odd')).toBe('not_started')
  })

  it('separates "waiting on something" (pending) from "blocked by something" (blocked)', () => {
    expect(guessCanonicalStatus('Pending')).toBe('pending')
    expect(guessCanonicalStatus('Waiting')).toBe('pending')
    expect(guessCanonicalStatus('Awaiting approval')).toBe('pending')
    expect(guessCanonicalStatus('On hold')).toBe('pending')
    expect(guessCanonicalStatus('בהמתנה')).toBe('pending')
    expect(guessCanonicalStatus('ממתין')).toBe('pending')

    expect(guessCanonicalStatus('Blocker')).toBe('blocked')
    expect(guessCanonicalStatus('Stuck')).toBe('blocked')
    expect(guessCanonicalStatus('חסום')).toBe('blocked')
    expect(guessCanonicalStatus('תקוע')).toBe('blocked')
  })

  it('maps every status option of the DAZ Tasks database', () => {
    // Options as configured in Notion: Pending / Not Started / In Progress / Testing / Done / Archived
    expect(guessCanonicalStatus('Pending')).toBe('pending')
    expect(guessCanonicalStatus('Not Started')).toBe('not_started')
    expect(guessCanonicalStatus('In Progress')).toBe('in_progress')
    expect(guessCanonicalStatus('Testing')).toBe('in_progress')
    expect(guessCanonicalStatus('Done')).toBe('done')
    expect(guessCanonicalStatus('Archived')).toBe('cancelled')
  })
})

describe('resolveCanonicalStatus', () => {
  it('an override wins over the keyword guess (case-insensitive)', () => {
    const overrides = new Map<string, CanonicalStatus>([['in review', 'blocked']])
    // Without the override "In Review" would guess not_started.
    expect(resolveCanonicalStatus('In Review', overrides)).toBe('blocked')
  })

  it('falls back to the guess when there is no override', () => {
    const overrides = new Map<string, CanonicalStatus>()
    expect(resolveCanonicalStatus('Done', overrides)).toBe('done')
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
function statusProp(name: string) {
  return { type: 'status', status: { name } }
}

let taskPages: Array<{ id: string; properties: Record<string, unknown> }> = []

const ORIGINAL_ENV = { ...process.env }

beforeEach(async () => {
  const db = getDb()
  await db.delete(taskPeople)
  await db.delete(tasks)
  await db.delete(people)
  await db.delete(notionStatusOverrides)
  await db.delete(workspaceNotionDatabases)
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

  it('assigns the workspace via an explicit database-id link (over any label)', async () => {
    const db = getDb()
    // Point the label at Dragontail, but link the db id to DAZ — the id must win.
    await db
      .update(workspaces)
      .set({ notionAccountLabel: 'DT - Action items' })
      .where(eq(workspaces.id, 'ws_dragontail'))
    await db.insert(workspaceNotionDatabases).values({
      id: 'wnd_test',
      workspaceId: 'ws_daz',
      notionDatabaseId: TASKS_DB,
      notionDatabaseName: 'DT - Action items',
      createdAt: new Date().toISOString(),
    })

    await syncNotionTasks({ windowDays: 60 })

    const [row] = await db.select().from(tasks).where(eq(tasks.title, 'Mapped task'))
    expect(row.workspaceId).toBe('ws_daz')
  })
})

describe('syncNotionTasks status handling', () => {
  it('keeps done/cancelled tasks and records their status (no longer skipped)', async () => {
    const db = getDb()
    taskPages = [
      {
        id: 'done-task',
        properties: {
          Name: titleProp('Finished task'),
          Assignee: peopleProp('Alpir Kritzler'),
          Status: statusProp('Done'),
        },
      },
      {
        id: 'cancelled-task',
        properties: {
          Name: titleProp('Dropped task'),
          Assignee: peopleProp('Alpir Kritzler'),
          Status: statusProp('Cancelled'),
        },
      },
      {
        id: 'active-task',
        properties: {
          Name: titleProp('Ongoing task'),
          Assignee: peopleProp('Alpir Kritzler'),
          Status: statusProp('In progress'),
        },
      },
    ]

    const result = await syncNotionTasks({ windowDays: 60 })
    expect(result.tasksCreated).toBe(3)

    const [done] = await db.select().from(tasks).where(eq(tasks.title, 'Finished task'))
    expect(done.status).toBe('done')
    expect(done.done).toBe(true)
    expect(done.notionStatusRaw).toBe('Done')

    const [cancelled] = await db.select().from(tasks).where(eq(tasks.title, 'Dropped task'))
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.done).toBe(true)

    const [active] = await db.select().from(tasks).where(eq(tasks.title, 'Ongoing task'))
    expect(active.status).toBe('in_progress')
    expect(active.done).toBe(false)
  })

  it('applies a user override when resolving the canonical status', async () => {
    const db = getDb()
    await db.insert(notionStatusOverrides).values({
      id: 'nso_test',
      rawLabel: 'In Review',
      canonicalStatus: 'blocked',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    taskPages = [
      {
        id: 'review-task',
        properties: {
          Name: titleProp('Awaiting review'),
          Assignee: peopleProp('Alpir Kritzler'),
          Status: statusProp('In Review'),
        },
      },
    ]

    await syncNotionTasks({ windowDays: 60 })

    const [row] = await db.select().from(tasks).where(eq(tasks.title, 'Awaiting review'))
    expect(row.status).toBe('blocked')
    expect(row.done).toBe(false)
    expect(row.notionStatusRaw).toBe('In Review')
  })
})
