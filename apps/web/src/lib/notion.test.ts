import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNotionConfigCache } from './notion-config'
import {
  formatNotionContextForPrompt,
  getNotionContext,
  getNotionMeetings,
  getNotionStatus,
  getNotionTasks,
  searchNotion,
} from './notion'

const ORIGINAL = { ...process.env }

function isoDaysFromNow(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]!
}

function titleProp(text: string) {
  return { type: 'title', title: [{ plain_text: text }] }
}
function dateProp(start: string) {
  return { type: 'date', date: { start } }
}
function statusProp(name: string) {
  return { type: 'status', status: { name } }
}

const TODAY = isoDaysFromNow(0)
const YESTERDAY = isoDaysFromNow(-1)
const IN_TWO = isoDaysFromNow(2)

/** Mocked Notion API keyed by database id in the request URL. */
function installFetchMock() {
  const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url.toString()

    const jsonOk = (body: unknown) =>
      ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response
    const fail = (status: number, body: string) =>
      ({ ok: false, status, json: async () => ({}), text: async () => body }) as unknown as Response

    if (href.includes('/databases/p-tasks/query')) {
      return jsonOk({
        results: [
          { id: '1', properties: { Name: titleProp('Overdue task'), Due: dateProp(YESTERDAY), Status: statusProp('Open') } },
          { id: '2', properties: { Name: titleProp('Today task'), Due: dateProp(TODAY), Status: statusProp('Open') } },
        ],
        has_more: false,
        next_cursor: null,
      })
    }
    if (href.includes('/databases/p-meet/query')) {
      return jsonOk({
        results: [
          { id: 'm1', properties: { Name: titleProp('Standup'), When: dateProp(`${TODAY}T09:00:00`), Status: statusProp('Confirmed') } },
          { id: 'm2', properties: { Name: titleProp('Review'), When: dateProp(IN_TWO), Status: statusProp('Confirmed') } },
        ],
        has_more: false,
        next_cursor: null,
      })
    }
    if (href.includes('/databases/broken/query')) {
      return fail(404, 'object_not_found: share the database with the integration')
    }
    return jsonOk({ results: [], has_more: false, next_cursor: null })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  delete process.env.NOTION_API_KEY
  process.env.NOTION_ACCOUNTS = JSON.stringify([
    {
      label: 'Personal',
      token: 'ntn_a',
      databases: [
        { id: 'p-tasks', name: 'Personal To-do', type: 'tasks' },
        { id: 'p-meet', name: 'Meetings', type: 'meetings' },
      ],
    },
    {
      label: 'DAZ',
      token: 'ntn_b',
      databases: [{ id: 'broken', name: 'Broken DB', type: 'tasks' }],
    },
  ])
  __resetNotionConfigCache()
  installFetchMock()
})

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...ORIGINAL }
  __resetNotionConfigCache()
})

describe('getNotionTasks (multi-account, partial failure)', () => {
  it('returns triaged tasks and records the failing database as an error', async () => {
    const tasks = await getNotionTasks()
    expect(tasks.overdue.map((t) => t.title)).toContain('Overdue task')
    expect(tasks.today.map((t) => t.title)).toContain('Today task')
    expect(tasks.errors).toHaveLength(1)
    expect(tasks.errors[0]).toMatchObject({ account: 'DAZ', db: 'Broken DB' })
  })
})

describe('getNotionMeetings', () => {
  it('splits today vs upcoming across accounts', async () => {
    const meetings = await getNotionMeetings()
    expect(meetings.today.map((m) => m.title)).toEqual(['Standup'])
    expect(meetings.today[0].time).toBe('09:00')
    expect(meetings.upcoming.map((m) => m.title)).toEqual(['Review'])
  })
})

describe('searchNotion', () => {
  it('matches titles case-insensitively and tags account/db', async () => {
    const { hits } = await searchNotion('standup')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ account: 'Personal', db: 'Meetings', type: 'meetings', title: 'Standup' })
  })

  it('returns nothing for an empty query', async () => {
    const { hits } = await searchNotion('   ')
    expect(hits).toEqual([])
  })
})

describe('getNotionContext + formatNotionContextForPrompt', () => {
  it('aggregates tasks + meetings and surfaces access warnings without blanking', async () => {
    const ctx = await getNotionContext()
    expect(ctx.meetings.today).toHaveLength(1)
    expect(ctx.tasks.overdue.length + ctx.tasks.today.length).toBeGreaterThanOrEqual(2)
    expect(ctx.errors).toHaveLength(1)

    const prompt = formatNotionContextForPrompt(ctx)
    expect(prompt).toContain('Meetings — Today')
    expect(prompt).toContain('Standup')
    expect(prompt).toContain('Notion access warnings')
    expect(prompt).toContain('Broken DB')
  })

  it('throws a clear error when Notion is not configured', async () => {
    delete process.env.NOTION_ACCOUNTS
    delete process.env.NOTION_API_KEY
    __resetNotionConfigCache()
    await expect(getNotionContext()).rejects.toThrow(/not configured/i)
  })
})

describe('getNotionStatus', () => {
  it('reports ok per reachable database and error for the unshared one', async () => {
    const status = await getNotionStatus()
    expect(status.configured).toBe(true)
    const daz = status.accounts.find((a) => a.label === 'DAZ')!
    expect(daz.databases[0].ok).toBe(false)
    const personal = status.accounts.find((a) => a.label === 'Personal')!
    expect(personal.databases.every((d) => d.ok)).toBe(true)
  })
})
