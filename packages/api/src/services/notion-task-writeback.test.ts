import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getDb, tasks } from '@ak-system/database'
import { createTestCaller, resetDb } from '../test-utils'
import {
  clearStatusSchemaCache,
  pickNotionLabel,
  pushTaskStatus,
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
