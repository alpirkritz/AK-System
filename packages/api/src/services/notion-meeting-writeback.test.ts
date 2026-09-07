import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  pushMeetingProperties,
  clearMeetingWritebackCache,
  type MeetingWriteBackResult,
} from './notion-meeting-writeback'

describe('pushMeetingProperties', () => {
  const originalAccounts = process.env.NOTION_ACCOUNTS

  beforeEach(() => {
    clearMeetingWritebackCache()
    process.env.NOTION_ACCOUNTS = JSON.stringify([
      {
        label: 'Personal',
        token: 'secret-personal-token',
        databases: [{ id: 'meetings-db', name: 'Meetings', type: 'meetings' }],
      },
    ])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalAccounts) {
      process.env.NOTION_ACCOUNTS = originalAccounts
    } else {
      delete process.env.NOTION_ACCOUNTS
    }
  })

  function meetingSchemaResponse() {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        properties: {
          Subject: { type: 'title' },
          Date: { type: 'date' },
        },
      }),
      text: async () => '',
    }
  }

  it('PATCHes title to Subject property when present', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        if (url.includes('/pages/page-1')) {
          if (init?.method === 'PATCH') {
            return { ok: true, status: 200, json: async () => ({}), text: async () => '' }
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({ parent: { database_id: 'meetings-db' } }),
            text: async () => '',
          }
        }
        return meetingSchemaResponse()
      }),
    )

    const result = await pushMeetingProperties({
      notionPageId: 'page-1',
      title: 'New meeting title',
    })

    expect(result).toEqual({ ok: true, wrote: ['title'] })
    const patch = calls.find((c) => c.init?.method === 'PATCH')
    expect(patch).toBeDefined()
    const body = JSON.parse(patch!.init!.body as string)
    expect(body.properties.Subject).toEqual({ title: [{ text: { content: 'New meeting title' } }] })
  })

  it('PATCHes date and time to Date property', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        if (url.includes('/pages/page-2')) {
          if (init?.method === 'PATCH') {
            return { ok: true, status: 200, json: async () => ({}), text: async () => '' }
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({ parent: { database_id: 'meetings-db' } }),
            text: async () => '',
          }
        }
        return meetingSchemaResponse()
      }),
    )

    const result = await pushMeetingProperties({
      notionPageId: 'page-2',
      date: '2026-09-07',
      time: '14:30',
    })

    expect(result).toEqual({ ok: true, wrote: ['date'] })
    const patch = calls.find((c) => c.init?.method === 'PATCH')
    expect(patch).toBeDefined()
    const body = JSON.parse(patch!.init!.body as string)
    expect(body.properties.Date).toBeDefined()
    expect(body.properties.Date.date.start).toMatch(/2026-09-07T14:30:00[+-]\d{2}:\d{2}/)
  })

  it('PATCHes title and date in one call when both change', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        if (url.includes('/pages/page-3')) {
          if (init?.method === 'PATCH') {
            return { ok: true, status: 200, json: async () => ({}), text: async () => '' }
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({ parent: { database_id: 'meetings-db' } }),
            text: async () => '',
          }
        }
        return meetingSchemaResponse()
      }),
    )

    const result = await pushMeetingProperties({
      notionPageId: 'page-3',
      title: 'Updated meeting',
      date: '2026-09-08',
      time: '10:00',
    })

    expect(result).toEqual({ ok: true, wrote: ['title', 'date'] })
    const patches = calls.filter((c) => c.init?.method === 'PATCH')
    expect(patches).toHaveLength(1)
    const body = JSON.parse(patches[0].init!.body as string)
    expect(body.properties.Subject).toBeDefined()
    expect(body.properties.Date).toBeDefined()
  })

  it('skips sentinel date 9999-12-31', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        if (url.includes('/pages/page-sentinel')) {
          if (init?.method === 'PATCH') {
            return { ok: true, status: 200, json: async () => ({}), text: async () => '' }
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({ parent: { database_id: 'meetings-db' } }),
            text: async () => '',
          }
        }
        return meetingSchemaResponse()
      }),
    )

    const result = await pushMeetingProperties({
      notionPageId: 'page-sentinel',
      title: 'Meeting without date',
      date: '9999-12-31',
      time: '09:00',
    })

    expect(result).toEqual({ ok: true, wrote: ['title'] })
    const patch = calls.find((c) => c.init?.method === 'PATCH')
    expect(patch).toBeDefined()
    const body = JSON.parse(patch!.init!.body as string)
    expect(body.properties.Date).toBeUndefined()
  })

  it('returns empty wrote array when no notionPageId resolves', async () => {
    process.env.NOTION_ACCOUNTS = JSON.stringify([])

    const result = await pushMeetingProperties({
      notionPageId: 'page-no-token',
      title: 'Test',
    })

    expect(result).toEqual({ ok: false, reason: 'account' })
  })

  it('returns api error when PATCH fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/pages/page-fail')) {
          if (init?.method === 'PATCH') {
            return { ok: false, status: 500, json: async () => ({}), text: async () => 'server error' }
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({ parent: { database_id: 'meetings-db' } }),
            text: async () => '',
          }
        }
        return meetingSchemaResponse()
      }),
    )

    const result = await pushMeetingProperties({
      notionPageId: 'page-fail',
      title: 'Fail test',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('api')
      expect(result.message).toContain('500')
    }
  })
})
