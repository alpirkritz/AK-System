import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./abc-agents', () => ({
  getRunnableAgentIds: () => ['01_Hugo_orchestrator'],
}))
vi.mock('./api-caller', () => ({ createServiceCaller: vi.fn() }))
vi.mock('./notion', () => ({
  getNotionEntries: vi.fn(),
  getNotionMeetings: vi.fn(),
  getNotionStatus: vi.fn(),
  getNotionTasks: vi.fn(),
  searchNotion: vi.fn(),
}))
vi.mock('@ak-system/api', () => ({
  localTodayIso: () => '2026-08-13',
  filterEventsByCalendarScope: (events: unknown[]) => events,
  getAgentCalendarIds: vi.fn().mockResolvedValue([]),
}))
vi.mock('@ak-system/database', () => ({
  chatMessages: {},
  getDb: vi.fn(),
}))

import { executeTool } from './conversation-engine'

type AnyCaller = Parameters<typeof executeTool>[2]

describe('executeTool — get_notion_meeting_notes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns bodyText from insights.meetingNotes (local DB)', async () => {
    const meetingNotes = vi.fn().mockResolvedValue({
      notes: [
        {
          id: 'mn1',
          title: '1:1 notes',
          date: '2026-08-13',
          bodyText: 'We decided to ship next week',
          snippet: 'We decided',
          meetingId: 'm1',
          meetingTitle: '1:1 with Dana',
          notionUrl: null,
        },
      ],
      count: 1,
    })
    const caller = {
      insights: { meetingNotes },
    } as unknown as AnyCaller

    const result = (await executeTool(
      'get_notion_meeting_notes',
      { date: 'today' },
      caller,
    )) as {
      meetingNotes: Array<{ bodyText: string | null; title: string }>
      count: number
      source: string
    }

    expect(meetingNotes).toHaveBeenCalledWith({ date: 'today' })
    expect(result.source).toBe('local_db')
    expect(result.count).toBe(1)
    expect(result.meetingNotes[0]!.bodyText).toBe('We decided to ship next week')
  })

  it('passes meetingId filter', async () => {
    const meetingNotes = vi.fn().mockResolvedValue({ notes: [], count: 0 })
    const caller = { insights: { meetingNotes } } as unknown as AnyCaller
    await executeTool('get_notion_meeting_notes', { meetingId: 'm99' }, caller)
    expect(meetingNotes).toHaveBeenCalledWith({ meetingId: 'm99' })
  })

  it('passes notionUrl to insights.meetingNotes', async () => {
    const meetingNotes = vi.fn().mockResolvedValue({ notes: [], count: 0 })
    const caller = { insights: { meetingNotes } } as unknown as AnyCaller
    const url =
      'https://app.notion.com/p/alpir/3cce7d50cb8e809c8f7cda639bce5478#fb2e7d50cb8e82a193b601601b869cae'
    await executeTool('get_notion_meeting_notes', { notionUrl: url }, caller)
    expect(meetingNotes).toHaveBeenCalledWith({ notionUrl: url })
  })

  it('passes query + date to insights.meetingNotes', async () => {
    const meetingNotes = vi.fn().mockResolvedValue({ notes: [], count: 0 })
    const caller = { insights: { meetingNotes } } as unknown as AnyCaller
    await executeTool('get_notion_meeting_notes', { date: 'today', query: 'שני' }, caller)
    expect(meetingNotes).toHaveBeenCalledWith({ date: 'today', query: 'שני' })
  })

  it('passes prepDate without leftover query', async () => {
    const meetingNotes = vi.fn().mockResolvedValue({
      notes: [],
      count: 0,
      prepFor: { date: '2026-08-31', meetingTitles: ['Shani & Alpir 1:1'] },
    })
    const caller = { insights: { meetingNotes } } as unknown as AnyCaller
    const result = (await executeTool(
      'get_notion_meeting_notes',
      { prepDate: 'tomorrow' },
      caller,
    )) as { prepFor?: { date: string } }
    expect(meetingNotes).toHaveBeenCalledWith({ prepDate: 'tomorrow' })
    expect(result.prepFor?.date).toBe('2026-08-31')
  })
})
