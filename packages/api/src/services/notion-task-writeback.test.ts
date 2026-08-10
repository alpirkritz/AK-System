import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getDb, people, tasks, workspaceNotionDatabases } from '@ak-system/database'
import { createTestCaller, resetDb } from '../test-utils'
import {
  clearStatusSchemaCache,
  pickNotionLabel,
  pickPriorityLabel,
  pushTaskStatus,
  pushTaskPeople,
  createNotionTask,
} from './notion-task-writeback'
import type { CanonicalStatus } from './notion-tasks-sync'

/** Status options exactly as the DAZ Tasks database exposes them. */
const DAZ_OPTIONS = ['Pending', 'Not Started', 'In Progress', 'Testing', 'Done', 'Archived']

const TASKS_DB = 'dazdb00000000000000000000000000'

function accountsEnv() {
  return JSON.stringify([
    {
      label: 'DAZ',
      token: 'secret-daz-token',
      databases: [{ id: TASKS_DB, name: 'DAZ Tasks', type: 'tasks' }],
    },
  ])
}

/** A `GET /databases/:id` reply carrying a real `status` property. */
function schemaResponse(options: string[], propName = 'Status', type: 'status' | 'select' = 'status') {
  const prop =
    type === 'status'
      ? { type: 'status', status: { options: options.map((name) => ({ name })) } }
      : { type: 'select', select: { options: options.map((name) => ({ name })) } }
  return {
    ok: true,
    status: 200,
    json: async () => ({
      properties: {
        'Task name': { type: 'title' },
        Priority: { type: 'select', select: { options: [{ name: 'High' }] } },
        [propName]: prop,
      },
    }),
    text: async () => '',
  }
}

describe('pickNotionLabel', () => {
  const noOverrides = new Map<string, CanonicalStatus>()

  it('maps each canonical status to the DAZ label', () => {
    expect(pickNotionLabel('pending', DAZ_OPTIONS, noOverrides)).toBe('Pending')
    expect(pickNotionLabel('not_started', DAZ_OPTIONS, noOverrides)).toBe('Not Started')
    expect(pickNotionLabel('done', DAZ_OPTIONS, noOverrides)).toBe('Done')
    expect(pickNotionLabel('cancelled', DAZ_OPTIONS, noOverrides)).toBe('Archived')
  })

  it('prefers the earlier option when two share a canonical status', () => {
    // Both "In Progress" and "Testing" resolve to in_progress; Notion's own order decides.
    expect(pickNotionLabel('in_progress', DAZ_OPTIONS, noOverrides)).toBe('In Progress')
  })

  it('returns null when the database has no matching option', () => {
    expect(pickNotionLabel('cancelled', ['Not Started', 'Done'], noOverrides)).toBeNull()
    expect(pickNotionLabel('blocked', DAZ_OPTIONS, noOverrides)).toBeNull()
  })

  it('honours a user override when choosing the label', () => {
    const overrides = new Map<string, CanonicalStatus>([['testing', 'blocked']])
    expect(pickNotionLabel('blocked', DAZ_OPTIONS, overrides)).toBe('Testing')
  })
})

describe('pushTaskStatus', () => {
  const originalAccounts = process.env.NOTION_ACCOUNTS
  const originalKey = process.env.NOTION_API_KEY

  beforeEach(async () => {
    await resetDb()
    clearStatusSchemaCache()
    process.env.NOTION_ACCOUNTS = accountsEnv()
    delete process.env.NOTION_API_KEY
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalAccounts === undefined) delete process.env.NOTION_ACCOUNTS
    else process.env.NOTION_ACCOUNTS = originalAccounts
    if (originalKey === undefined) delete process.env.NOTION_API_KEY
    else process.env.NOTION_API_KEY = originalKey
  })

  it('PATCHes the page with the database-specific label', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        if (init?.method === 'PATCH') {
          return { ok: true, status: 200, json: async () => ({}), text: async () => '' }
        }
        return schemaResponse(DAZ_OPTIONS)
      }),
    )

    const res = await pushTaskStatus({
      notionPageId: 'page-1',
      notionAccount: 'DAZ',
      notionDb: 'DAZ Tasks',
      status: 'done',
    })

    expect(res).toEqual({ ok: true, label: 'Done' })
    const patch = calls.find((c) => c.init?.method === 'PATCH')!
    expect(patch.url).toBe('https://api.notion.com/v1/pages/page-1')
    expect(JSON.parse(patch.init!.body as string)).toEqual({
      properties: { Status: { status: { name: 'Done' } } },
    })
    expect((patch.init!.headers as Record<string, string>).Authorization).toBe('Bearer secret-daz-token')
  })

  it('writes a select-typed status property with select shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          return { ok: true, status: 200, json: async () => ({}), text: async () => '' }
        }
        return schemaResponse(['Open', 'Done'], 'Status', 'select')
      }),
    )

    const res = await pushTaskStatus({
      notionPageId: 'page-2',
      notionAccount: 'DAZ',
      notionDb: 'DAZ Tasks',
      status: 'done',
    })
    expect(res).toEqual({ ok: true, label: 'Done' })
  })

  it('caches the schema so repeated writes issue a single GET', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return { ok: true, status: 200, json: async () => ({}), text: async () => '' }
      }
      return schemaResponse(DAZ_OPTIONS)
    })
    vi.stubGlobal('fetch', fetchMock)

    for (const status of ['done', 'not_started', 'done'] as CanonicalStatus[]) {
      await pushTaskStatus({
        notionPageId: 'page-3',
        notionAccount: 'DAZ',
        notionDb: 'DAZ Tasks',
        status,
      })
    }
    const gets = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method !== 'PATCH')
    expect(gets).toHaveLength(1)
  })

  it('reports no-matching-option instead of writing a wrong value', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => schemaResponse(['Not Started', 'Done'])),
    )
    const res = await pushTaskStatus({
      notionPageId: 'page-4',
      notionAccount: 'DAZ',
      notionDb: 'DAZ Tasks',
      status: 'cancelled',
    })
    expect(res).toEqual({ ok: false, reason: 'no-matching-option' })
  })

  it('reports account when no configured account matches', async () => {
    delete process.env.NOTION_ACCOUNTS
    const res = await pushTaskStatus({
      notionPageId: 'page-5',
      notionAccount: 'DAZ',
      notionDb: 'DAZ Tasks',
      status: 'done',
    })
    expect(res).toEqual({ ok: false, reason: 'account' })
  })

  it('reports api on a non-2xx PATCH without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          return { ok: false, status: 403, json: async () => ({}), text: async () => 'no access' }
        }
        return schemaResponse(DAZ_OPTIONS)
      }),
    )
    const res = await pushTaskStatus({
      notionPageId: 'page-6',
      notionAccount: 'DAZ',
      notionDb: 'DAZ Tasks',
      status: 'done',
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('api')
      expect(res.message).toContain('403')
    }
  })
})

describe('tasks router write-back integration', () => {
  const originalAccounts = process.env.NOTION_ACCOUNTS

  beforeEach(async () => {
    await resetDb()
    clearStatusSchemaCache()
    process.env.NOTION_ACCOUNTS = accountsEnv()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalAccounts === undefined) delete process.env.NOTION_ACCOUNTS
    else process.env.NOTION_ACCOUNTS = originalAccounts
  })

  it('toggleDone on a manual task performs no Notion call', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const caller = await createTestCaller()
    const created = await caller.tasks.create({ title: 'ידנית' })
    const toggled = await caller.tasks.toggleDone({ id: created.id })

    expect(toggled!.done).toBe(true)
    expect((toggled as { notionSync?: unknown }).notionSync).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('toggleDone on a notion task writes back and records the label locally', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          return { ok: true, status: 200, json: async () => ({}), text: async () => '' }
        }
        return schemaResponse(DAZ_OPTIONS)
      }),
    )

    const db = getDb()
    const now = new Date().toISOString()
    await db.insert(tasks).values({
      id: 't_notion_wb',
      title: 'Approve spec',
      done: false,
      status: 'not_started',
      priority: 'medium',
      source: 'notion',
      notionPageId: 'page-wb',
      notionAccount: 'DAZ',
      notionDb: 'DAZ Tasks',
      notionStatusRaw: 'Not Started',
      createdAt: now,
      updatedAt: now,
    })

    const caller = await createTestCaller()
    const toggled = await caller.tasks.toggleDone({ id: 't_notion_wb' })

    expect(toggled!.status).toBe('done')
    expect((toggled as { notionSync?: { ok: boolean; label: string } }).notionSync).toEqual({
      ok: true,
      label: 'Done',
    })
    expect((toggled as { notionStatusRaw?: string }).notionStatusRaw).toBe('Done')
  })

  it('a Notion failure still leaves the local status updated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )

    const db = getDb()
    const now = new Date().toISOString()
    await db.insert(tasks).values({
      id: 't_notion_fail',
      title: 'Send deck',
      done: false,
      status: 'not_started',
      priority: 'medium',
      source: 'notion',
      notionPageId: 'page-fail',
      notionAccount: 'DAZ',
      notionDb: 'DAZ Tasks',
      createdAt: now,
      updatedAt: now,
    })

    const caller = await createTestCaller()
    const updated = await caller.tasks.update({ id: 't_notion_fail', status: 'in_progress' })

    expect(updated!.status).toBe('in_progress')
    const sync = (updated as { notionSync?: { ok: boolean; reason?: string } }).notionSync
    expect(sync?.ok).toBe(false)
    expect(sync?.reason).toBe('api')
  })

  it('update without a status change does not touch Notion', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const db = getDb()
    const now = new Date().toISOString()
    await db.insert(tasks).values({
      id: 't_notion_title',
      title: 'Old title',
      done: false,
      status: 'not_started',
      priority: 'medium',
      source: 'notion',
      notionPageId: 'page-title',
      notionAccount: 'DAZ',
      notionDb: 'DAZ Tasks',
      createdAt: now,
      updatedAt: now,
    })

    const caller = await createTestCaller()
    const updated = await caller.tasks.update({ id: 't_notion_title', title: 'New title' })

    expect(updated!.title).toBe('New title')
    expect((updated as { notionSync?: unknown }).notionSync).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('createNotionTask', () => {
  const TARGET = { token: 'secret-daz-token', databaseId: TASKS_DB, accountLabel: 'DAZ', name: 'DAZ Tasks' }

  beforeEach(() => {
    clearStatusSchemaCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs a page with the title and a not_started-equivalent status', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        if (init?.method === 'POST') {
          return { ok: true, status: 200, json: async () => ({ id: 'new-page-1' }), text: async () => '' }
        }
        return schemaResponse(DAZ_OPTIONS)
      }),
    )

    const res = await createNotionTask({ target: TARGET, title: 'לבדוק חשבון' })

    expect(res).toEqual({ ok: true, pageId: 'new-page-1', accountLabel: 'DAZ', name: 'DAZ Tasks', label: 'Not Started' })
    const post = calls.find((c) => c.init?.method === 'POST')!
    expect(post.url).toBe('https://api.notion.com/v1/pages')
    const body = JSON.parse(post.init!.body as string)
    expect(body.parent).toEqual({ database_id: TASKS_DB })
    expect(body.properties['Task name']).toEqual({ title: [{ text: { content: 'לבדוק חשבון' } }] })
    expect(body.properties.Status).toEqual({ status: { name: 'Not Started' } })
  })

  it('writes the due date to the first date-type property when both exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return { ok: true, status: 200, json: async () => ({ id: 'new-page-2' }), text: async () => '' }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            properties: {
              'Task name': { type: 'title' },
              'Due date': { type: 'date' },
              Status: { type: 'status', status: { options: DAZ_OPTIONS.map((name) => ({ name })) } },
            },
          }),
          text: async () => '',
        }
      }),
    )

    const res = await createNotionTask({ target: TARGET, title: 'עם תאריך', dueDate: '2026-08-01' })
    expect(res.ok).toBe(true)

    const posts = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, init]: [string, RequestInit]) => init?.method === 'POST',
    )
    const body = JSON.parse(posts[0][1].body as string)
    expect(body.properties['Due date']).toEqual({ date: { start: '2026-08-01' } })
  })

  it('still creates the page when the database has no not_started-equivalent option', async () => {
    // Both options resolve to done/cancelled via the heuristic — neither is a not_started match.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return { ok: true, status: 200, json: async () => ({ id: 'new-page-3' }), text: async () => '' }
        }
        return schemaResponse(['Finished', 'Archived'])
      }),
    )
    const res = await createNotionTask({ target: TARGET, title: 'בלי סטטוס תואם' })
    expect(res).toEqual({ ok: true, pageId: 'new-page-3', accountLabel: 'DAZ', name: 'DAZ Tasks', label: null })
  })

  it('reports api on a failed POST without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return { ok: false, status: 401, json: async () => ({}), text: async () => 'unauthorized' }
        }
        return schemaResponse(DAZ_OPTIONS)
      }),
    )
    const res = await createNotionTask({ target: TARGET, title: 'ייכשל' })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('api')
      expect(res.message).toContain('401')
    }
  })

  /** Schema shaped like the real task databases: title, status, priority, date and one people prop. */
  function richSchemaResponse(priorityOptions = ['High', 'Medium', 'Low']) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        properties: {
          'Task name': { type: 'title' },
          Status: { type: 'status', status: { options: DAZ_OPTIONS.map((name) => ({ name })) } },
          Priority: { type: 'select', select: { options: priorityOptions.map((name) => ({ name })) } },
          'Due date': { type: 'date' },
          Assignee: { type: 'people' },
        },
      }),
      text: async () => '',
    }
  }

  const USERS = [
    { id: 'user-alpir', name: 'Alpir Kritzler', type: 'person', person: { email: 'alpirkritz@gmail.com' } },
    { id: 'bot-1', name: 'AK-System', type: 'bot' },
  ]

  /** Routes the three endpoints a full create touches. */
  function stubCreateFetch(opts: { users?: unknown[]; priorityOptions?: string[] } = {}) {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        if (init?.method === 'POST') {
          return { ok: true, status: 200, json: async () => ({ id: 'new-page' }), text: async () => '' }
        }
        if (url.includes('/v1/users')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ results: opts.users ?? USERS, has_more: false, next_cursor: null }),
            text: async () => '',
          }
        }
        return richSchemaResponse(opts.priorityOptions)
      }),
    )
    return calls
  }

  function postBody(calls: Array<{ url: string; init?: RequestInit }>) {
    return JSON.parse(calls.find((c) => c.init?.method === 'POST')!.init!.body as string)
  }

  it('assigns the Notion user matched by email to the people property', async () => {
    const calls = stubCreateFetch()
    const res = await createNotionTask({
      target: TARGET,
      title: 'עם אחראי',
      assignee: { name: 'Alpir Kritzler', email: 'alpirkritz@gmail.com' },
    })
    expect(res.ok).toBe(true)
    expect(postBody(calls).properties.Assignee).toEqual({ people: [{ id: 'user-alpir' }] })
  })

  it('falls back to matching the Notion user by name when the person has no email', async () => {
    const calls = stubCreateFetch()
    await createNotionTask({ target: TARGET, title: 'לפי שם', assignee: { name: 'alpir kritzler' } })
    expect(postBody(calls).properties.Assignee).toEqual({ people: [{ id: 'user-alpir' }] })
  })

  it('never assigns a bot, even when the name matches exactly', async () => {
    const calls = stubCreateFetch()
    const res = await createNotionTask({ target: TARGET, title: 'בוט', assignee: { name: 'AK-System' } })
    expect(res.ok).toBe(true)
    expect(postBody(calls).properties.Assignee).toBeUndefined()
  })

  it('still creates the page when the assignee is not a Notion user', async () => {
    const calls = stubCreateFetch()
    const res = await createNotionTask({
      target: TARGET,
      title: 'אחראי חיצוני',
      assignee: { name: 'Someone Else', email: 'nobody@example.com' },
    })
    expect(res.ok).toBe(true)
    expect(postBody(calls).properties.Assignee).toBeUndefined()
  })

  it('leaves the people property alone when no assignee is given', async () => {
    const calls = stubCreateFetch()
    await createNotionTask({ target: TARGET, title: 'ללא אחראי', assignee: null })
    expect(postBody(calls).properties.Assignee).toBeUndefined()
    // Resolving users is pointless without an assignee, so it must not even be requested.
    expect(calls.some((c) => c.url.includes('/v1/users'))).toBe(false)
  })

  it('writes the priority to the database priority property', async () => {
    const calls = stubCreateFetch()
    await createNotionTask({ target: TARGET, title: 'דחוף', priority: 'high' })
    expect(postBody(calls).properties.Priority).toEqual({ select: { name: 'High' } })
  })

  it('prefers the exact priority label over an earlier bucket match', async () => {
    const calls = stubCreateFetch({ priorityOptions: ['Critical', 'High', 'Medium', 'Low'] })
    await createNotionTask({ target: TARGET, title: 'לא קריטי', priority: 'high' })
    expect(postBody(calls).properties.Priority).toEqual({ select: { name: 'High' } })
  })

  it('pushes the status chosen at creation rather than a hardcoded not_started', async () => {
    const calls = stubCreateFetch()
    const res = await createNotionTask({ target: TARGET, title: 'בתהליך', status: 'in_progress' })
    expect(postBody(calls).properties.Status).toEqual({ status: { name: 'In Progress' } })
    expect(res.ok && res.label).toBe('In Progress')
  })
})

describe('pickPriorityLabel', () => {
  it('picks the exact label ahead of Critical when the task is merely high', () => {
    expect(pickPriorityLabel('high', ['Critical', 'High', 'Medium', 'Low'])).toBe('High')
  })

  it('maps each priority to its label', () => {
    const options = ['High', 'Medium', 'Low']
    expect(pickPriorityLabel('high', options)).toBe('High')
    expect(pickPriorityLabel('medium', options)).toBe('Medium')
    expect(pickPriorityLabel('low', options)).toBe('Low')
  })

  it('falls back to the keyword bucket for non-canonical labels', () => {
    expect(pickPriorityLabel('high', ['Urgent', 'Normal'])).toBe('Urgent')
    expect(pickPriorityLabel('medium', ['Urgent', 'Normal'])).toBe('Normal')
  })

  it('returns null when no option fits', () => {
    expect(pickPriorityLabel('low', ['Urgent'])).toBeNull()
  })
})

describe('tasks.create Notion push integration', () => {
  const originalAccounts = process.env.NOTION_ACCOUNTS

  beforeEach(async () => {
    await resetDb()
    clearStatusSchemaCache()
    process.env.NOTION_ACCOUNTS = accountsEnv()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalAccounts === undefined) delete process.env.NOTION_ACCOUNTS
    else process.env.NOTION_ACCOUNTS = originalAccounts
  })

  async function linkDazWorkspace() {
    const db = getDb()
    await db.insert(workspaceNotionDatabases).values({
      id: 'wnd_test_daz',
      workspaceId: 'ws_daz',
      notionDatabaseId: TASKS_DB,
      notionDatabaseName: 'DAZ Tasks',
      createdAt: new Date().toISOString(),
    })
  }

  it('creating a task with no workspace never calls Notion', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const caller = await createTestCaller()
    const created = await caller.tasks.create({ title: 'משימה פרטית' })

    expect((created as { notionSync?: unknown }).notionSync).toBeNull()
    expect(created.source).toBe('manual')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('creating a task in a workspace with no Notion link never calls Notion', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const caller = await createTestCaller()
    const created = await caller.tasks.create({ title: 'לא מקושר', workspaceId: 'ws_personal' })

    expect((created as { notionSync?: unknown }).notionSync).toBeNull()
    expect(created.source).toBe('manual')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('creating a task in a linked workspace pushes it to Notion and attaches the page', async () => {
    await linkDazWorkspace()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return { ok: true, status: 200, json: async () => ({ id: 'daz-new-page' }), text: async () => '' }
        }
        return schemaResponse(DAZ_OPTIONS)
      }),
    )

    const caller = await createTestCaller()
    const created = await caller.tasks.create({ title: 'משימה חדשה לדאז', workspaceId: 'ws_daz' })

    expect((created as { notionSync?: { ok: boolean; pageId: string } }).notionSync).toEqual({
      ok: true,
      pageId: 'daz-new-page',
      accountLabel: 'DAZ',
      name: 'DAZ Tasks',
      label: 'Not Started',
    })
    expect(created.source).toBe('notion')
    expect(created.notionPageId).toBe('daz-new-page')
    expect(created.notionAccount).toBe('DAZ')
    expect(created.notionDb).toBe('DAZ Tasks')
    expect(created.notionStatusRaw).toBe('Not Started')
  })

  it('a failed Notion push leaves the task as an ordinary manual task', async () => {
    await linkDazWorkspace()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )

    const caller = await createTestCaller()
    const created = await caller.tasks.create({ title: 'ייכשל', workspaceId: 'ws_daz' })

    const sync = (created as { notionSync?: { ok: boolean; reason?: string } }).notionSync
    expect(sync?.ok).toBe(false)
    expect(created.source).toBe('manual')
    expect(created.notionPageId).toBeNull()
  })

  it("carries the task's assignee and priority through to the Notion page", async () => {
    await linkDazWorkspace()
    const db = getDb()
    await db.insert(people).values({
      id: 'p_assignee_test',
      name: 'Dana Levi',
      email: 'dana@example.com',
      color: '#e8c547',
      status: 'confirmed',
      source: 'manual',
      createdAt: new Date().toISOString(),
    })

    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        if (init?.method === 'POST') {
          return { ok: true, status: 200, json: async () => ({ id: 'daz-assigned' }), text: async () => '' }
        }
        if (url.includes('/v1/users')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              results: [
                { id: 'notion-dana', name: 'Dana Levi', type: 'person', person: { email: 'dana@example.com' } },
              ],
              has_more: false,
              next_cursor: null,
            }),
            text: async () => '',
          }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            properties: {
              'Task name': { type: 'title' },
              Status: { type: 'status', status: { options: DAZ_OPTIONS.map((name) => ({ name })) } },
              Priority: { type: 'select', select: { options: [{ name: 'High' }, { name: 'Medium' }] } },
              Assignee: { type: 'people' },
            },
          }),
          text: async () => '',
        }
      }),
    )

    const caller = await createTestCaller()
    await caller.tasks.create({
      title: 'משימה משויכת',
      workspaceId: 'ws_daz',
      assigneeId: 'p_assignee_test',
      priority: 'high',
      status: 'in_progress',
    })

    const body = JSON.parse(calls.find((c) => c.init?.method === 'POST')!.init!.body as string)
    expect(body.properties.Assignee).toEqual({ people: [{ id: 'notion-dana' }] })
    expect(body.properties.Priority).toEqual({ select: { name: 'High' } })
    expect(body.properties.Status).toEqual({ status: { name: 'In Progress' } })
  })
})

const PEOPLE_DIR_DB = 'peopledir0000000000000000000000'

/**
 * A task-database schema shaped like the live `DT - Action items`: a people directory relation
 * alongside decoys that must never be written to.
 */
function schemaWithRelations(
  relations: Record<string, string> = {
    '📇 People directory': PEOPLE_DIR_DB,
    Projects: 'projectsdb00000000000000000000',
    Meeting: 'meetingsdb00000000000000000000',
    'Sub-task': TASKS_DB,
    'Parent task': TASKS_DB,
  },
) {
  const properties: Record<string, unknown> = {
    'Task name': { type: 'title' },
    Status: { type: 'status', status: { options: DAZ_OPTIONS.map((name) => ({ name })) } },
  }
  for (const [name, databaseId] of Object.entries(relations)) {
    properties[name] = { type: 'relation', relation: { database_id: databaseId } }
  }
  return { ok: true, status: 200, json: async () => ({ properties }), text: async () => '' }
}

/** A `POST /databases/:id/query` reply listing directory pages by title. */
function directoryResponse(pages: Record<string, string>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      results: Object.entries(pages).map(([name, id]) => ({
        id,
        properties: { Name: { type: 'title', title: [{ plain_text: name }] } },
      })),
      has_more: false,
      next_cursor: null,
    }),
    text: async () => '',
  }
}

/** Routes the three calls pushTaskPeople makes: schema GET, directory query, page PATCH. */
function stubPeopleFetch(options: {
  schema?: ReturnType<typeof schemaWithRelations>
  directory?: Record<string, string>
  patchOk?: boolean
}) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url.includes('/pages/')) {
        return options.patchOk === false
          ? { ok: false, status: 400, json: async () => ({}), text: async () => 'bad relation' }
          : { ok: true, status: 200, json: async () => ({}), text: async () => '' }
      }
      if (url.includes('/query')) return directoryResponse(options.directory ?? {})
      return options.schema ?? schemaWithRelations()
    }),
  )
  return calls
}

function patchedRelation(calls: Array<{ url: string; init?: RequestInit }>) {
  const patch = calls.find((c) => c.init?.method === 'PATCH')
  if (!patch) return undefined
  return JSON.parse(patch.init!.body as string).properties
}

describe('pushTaskPeople', () => {
  const originalAccounts = process.env.NOTION_ACCOUNTS

  beforeEach(() => {
    clearStatusSchemaCache()
    process.env.NOTION_ACCOUNTS = accountsEnv()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalAccounts === undefined) delete process.env.NOTION_ACCOUNTS
    else process.env.NOTION_ACCOUNTS = originalAccounts
  })

  const base = { notionPageId: 'page-1', notionAccount: 'DAZ', notionDb: 'DAZ Tasks' }

  it('writes the directory pages of the matched people to the relation', async () => {
    const calls = stubPeopleFetch({
      directory: { 'Dana Levi': 'dir-dana', 'Yossi Cohen': 'dir-yossi', Unrelated: 'dir-x' },
    })

    const result = await pushTaskPeople({ ...base, personNames: ['Dana Levi', 'Yossi Cohen'] })

    expect(result).toEqual({
      ok: true,
      propertyName: '📇 People directory',
      matched: ['Dana Levi', 'Yossi Cohen'],
      unmatched: [],
    })
    expect(patchedRelation(calls)).toEqual({
      '📇 People directory': { relation: [{ id: 'dir-dana' }, { id: 'dir-yossi' }] },
    })
  })

  it('matches names case-insensitively and ignoring surrounding spaces', async () => {
    const calls = stubPeopleFetch({ directory: { 'Dana Levi': 'dir-dana' } })

    const result = await pushTaskPeople({ ...base, personNames: ['  dana LEVI '] })

    expect(result.ok).toBe(true)
    expect(patchedRelation(calls)).toEqual({
      '📇 People directory': { relation: [{ id: 'dir-dana' }] },
    })
  })

  it('skips a person missing from the directory while still pushing the others', async () => {
    const calls = stubPeopleFetch({ directory: { 'Dana Levi': 'dir-dana' } })

    const result = await pushTaskPeople({ ...base, personNames: ['Dana Levi', 'Ghost Person'] })

    expect(result).toEqual({
      ok: true,
      propertyName: '📇 People directory',
      matched: ['Dana Levi'],
      unmatched: ['Ghost Person'],
    })
    expect(patchedRelation(calls)).toEqual({
      '📇 People directory': { relation: [{ id: 'dir-dana' }] },
    })
  })

  it('clears the relation when no people are related any more', async () => {
    const calls = stubPeopleFetch({ directory: { 'Dana Levi': 'dir-dana' } })

    const result = await pushTaskPeople({ ...base, personNames: [] })

    expect(result).toEqual({
      ok: true,
      propertyName: '📇 People directory',
      matched: [],
      unmatched: [],
    })
    expect(patchedRelation(calls)).toEqual({ '📇 People directory': { relation: [] } })
    // Clearing needs no directory lookup.
    expect(calls.some((c) => c.url.includes('/query'))).toBe(false)
  })

  it('leaves the existing relation untouched when not one name resolves', async () => {
    const calls = stubPeopleFetch({ directory: { 'Someone Else': 'dir-other' } })

    const result = await pushTaskPeople({ ...base, personNames: ['Ghost One', 'Ghost Two'] })

    // The names travel with the failure so the UI can say who was skipped.
    expect(result).toEqual({
      ok: false,
      reason: 'no-matching-people',
      unmatched: ['Ghost One', 'Ghost Two'],
    })
    expect(patchedRelation(calls)).toBeUndefined()
  })

  it('reports when the database has no people relation at all', async () => {
    const calls = stubPeopleFetch({
      schema: schemaWithRelations({ Projects: 'projectsdb00000000000000000000' }),
      directory: { 'Dana Levi': 'dir-dana' },
    })

    const result = await pushTaskPeople({ ...base, personNames: ['Dana Levi'] })

    expect(result).toEqual({ ok: false, reason: 'no-people-relation' })
    expect(patchedRelation(calls)).toBeUndefined()
  })

  it('never treats a self-referencing relation as the people directory', async () => {
    stubPeopleFetch({
      schema: schemaWithRelations({ 'Blocked by people': TASKS_DB }),
      directory: { 'Dana Levi': 'dir-dana' },
    })

    const result = await pushTaskPeople({ ...base, personNames: ['Dana Levi'] })

    expect(result).toEqual({ ok: false, reason: 'no-people-relation' })
  })

  it('prefers a configured people database over a name match', async () => {
    process.env.NOTION_ACCOUNTS = JSON.stringify([
      {
        label: 'DAZ',
        token: 'secret-daz-token',
        databases: [
          { id: TASKS_DB, name: 'DAZ Tasks', type: 'tasks' },
          { id: 'configuredpeople00000000000000', name: 'DAZ People', type: 'people' },
        ],
      },
    ])
    const calls = stubPeopleFetch({
      schema: schemaWithRelations({
        'Persons mentioned': 'somethingelse00000000000000000',
        Contacts: 'configuredpeople00000000000000',
      }),
      directory: { 'Dana Levi': 'dir-dana' },
    })

    const result = await pushTaskPeople({ ...base, personNames: ['Dana Levi'] })

    expect(result.ok).toBe(true)
    expect((result as { propertyName: string }).propertyName).toBe('Contacts')
    expect(calls.find((c) => c.url.includes('/query'))!.url).toContain('configuredpeople00000000000000')
  })

  it('matches a configured people database whether or not the ids carry dashes', async () => {
    process.env.NOTION_ACCOUNTS = JSON.stringify([
      {
        label: 'DAZ',
        token: 'secret-daz-token',
        databases: [
          { id: TASKS_DB, name: 'DAZ Tasks', type: 'tasks' },
          { id: '3031f239-0943-8074-8bf0-d8efb32e9049', name: 'DAZ People', type: 'people' },
        ],
      },
    ])
    stubPeopleFetch({
      // Same database as the configured one, as the schema endpoint returns it: without dashes.
      schema: schemaWithRelations({ Roster: '3031f239094380748bf0d8efb32e9049' }),
      directory: { 'Dana Levi': 'dir-dana' },
    })

    const result = await pushTaskPeople({ ...base, personNames: ['Dana Levi'] })

    expect((result as { propertyName?: string }).propertyName).toBe('Roster')
  })

  it('reports an unresolvable account without calling Notion', async () => {
    delete process.env.NOTION_ACCOUNTS
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await pushTaskPeople({ ...base, personNames: ['Dana Levi'] })

    expect(result).toEqual({ ok: false, reason: 'account' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a rejected PATCH without throwing', async () => {
    stubPeopleFetch({ directory: { 'Dana Levi': 'dir-dana' }, patchOk: false })

    const result = await pushTaskPeople({ ...base, personNames: ['Dana Levi'] })

    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toBe('api')
  })

  it('reads each directory once and reuses the cache', async () => {
    const calls = stubPeopleFetch({ directory: { 'Dana Levi': 'dir-dana' } })

    await pushTaskPeople({ ...base, personNames: ['Dana Levi'] })
    await pushTaskPeople({ ...base, personNames: ['Dana Levi'] })

    expect(calls.filter((c) => c.url.includes('/query'))).toHaveLength(1)
  })

  it('follows pagination so people beyond the first page still resolve', async () => {
    let queries = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/pages/')) return { ok: true, status: 200, json: async () => ({}), text: async () => '' }
        if (url.includes('/query')) {
          queries += 1
          if (queries === 1) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                results: [
                  { id: 'dir-first', properties: { Name: { type: 'title', title: [{ plain_text: 'First Page' }] } } },
                ],
                has_more: true,
                next_cursor: 'cursor-2',
              }),
              text: async () => '',
            }
          }
          return directoryResponse({ 'Second Page': 'dir-second' })
        }
        return schemaWithRelations()
      }),
    )

    const result = await pushTaskPeople({ ...base, personNames: ['Second Page'] })

    expect(queries).toBe(2)
    expect((result as { matched: string[] }).matched).toEqual(['Second Page'])
  })
})

describe('tasks.setTaskPeople Notion relation push', () => {
  const originalAccounts = process.env.NOTION_ACCOUNTS

  beforeEach(async () => {
    await resetDb()
    clearStatusSchemaCache()
    process.env.NOTION_ACCOUNTS = accountsEnv()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalAccounts === undefined) delete process.env.NOTION_ACCOUNTS
    else process.env.NOTION_ACCOUNTS = originalAccounts
  })

  async function seedNotionTaskWithPeople() {
    const db = getDb()
    const now = new Date().toISOString()
    await db.insert(people).values([
      { id: 'p_rel_dana', name: 'Dana Levi', color: '#e8c547', status: 'confirmed', source: 'manual', createdAt: now },
      { id: 'p_rel_yossi', name: 'Yossi Cohen', color: '#e8c547', status: 'confirmed', source: 'manual', createdAt: now },
    ])
    await db.insert(tasks).values({
      id: 't_rel',
      title: 'משימה עם אנשים',
      done: false,
      status: 'not_started',
      priority: 'medium',
      source: 'notion',
      notionPageId: 'page-rel',
      notionAccount: 'DAZ',
      notionDb: 'DAZ Tasks',
      createdAt: now,
      updatedAt: now,
    })
  }

  it('pushes the related people of a Notion-backed task to the relation', async () => {
    await seedNotionTaskWithPeople()
    const calls = stubPeopleFetch({ directory: { 'Dana Levi': 'dir-dana', 'Yossi Cohen': 'dir-yossi' } })

    const caller = await createTestCaller()
    const result = await caller.tasks.setTaskPeople({
      taskId: 't_rel',
      personIds: ['p_rel_dana', 'p_rel_yossi'],
    })

    expect(result.notionSync).toMatchObject({ ok: true, propertyName: '📇 People directory' })
    const relation = patchedRelation(calls)!['📇 People directory'].relation as Array<{ id: string }>
    expect(relation.map((r) => r.id).sort()).toEqual(['dir-dana', 'dir-yossi'])
  })

  it('clears the relation when the people are removed from the task', async () => {
    await seedNotionTaskWithPeople()
    const calls = stubPeopleFetch({ directory: { 'Dana Levi': 'dir-dana' } })

    const caller = await createTestCaller()
    await caller.tasks.setTaskPeople({ taskId: 't_rel', personIds: [] })

    expect(patchedRelation(calls)).toEqual({ '📇 People directory': { relation: [] } })
  })

  it('never calls Notion for a manual task', async () => {
    const db = getDb()
    const now = new Date().toISOString()
    await db.insert(people).values({
      id: 'p_manual',
      name: 'Dana Levi',
      color: '#e8c547',
      status: 'confirmed',
      source: 'manual',
      createdAt: now,
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const caller = await createTestCaller()
    const created = await caller.tasks.create({ title: 'ידנית עם אנשים' })
    const result = await caller.tasks.setTaskPeople({ taskId: created.id, personIds: ['p_manual'] })

    expect(result.ok).toBe(true)
    expect(result.notionSync).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still stores the people locally when the Notion push fails', async () => {
    await seedNotionTaskWithPeople()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )

    const caller = await createTestCaller()
    const result = await caller.tasks.setTaskPeople({ taskId: 't_rel', personIds: ['p_rel_dana'] })

    expect(result.ok).toBe(true)
    expect(result.notionSync?.ok).toBe(false)
    await expect(caller.tasks.getTaskPeople({ id: 't_rel' })).resolves.toEqual(['p_rel_dana'])
  })
})
