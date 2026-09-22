import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock modules that conversation-engine touches at import time / in unrelated tool paths,
// so we can import executeTool without pulling real server dependencies.
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
  localTodayIso: () => '2026-07-16',
  filterEventsByCalendarScope: (events: unknown[]) => events,
  getAgentCalendarIds: vi.fn().mockResolvedValue([]),
}))
vi.mock('@ak-system/database', () => ({
  chatMessages: {},
  getDb: vi.fn(),
}))

import { executeTool } from './conversation-engine'

type AnyCaller = Parameters<typeof executeTool>[2]

function buildCaller(overrides: {
  forTool?: ReturnType<typeof vi.fn>
  trigger?: ReturnType<typeof vi.fn>
}) {
  return {
    whatsapp: {
      messages: {
        forTool: overrides.forTool ?? vi.fn(),
      },
      summaries: {
        trigger: overrides.trigger ?? vi.fn(),
      },
    },
  } as unknown as AnyCaller
}

describe('executeTool — summarize_whatsapp_groups', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns all-groups raw DB data (inline), not the bridge', async () => {
    const forTool = vi.fn().mockResolvedValue({
      groups: [{ groupName: 'צוות', groupJid: '123@g.us', messageCount: 5, priority: 0 }],
      totalGroups: 1,
      window: '24h',
      rangeLabel: '24 השעות האחרונות',
      empty: false,
    })
    const trigger = vi.fn()
    const caller = buildCaller({ forTool, trigger })

    const result = (await executeTool('summarize_whatsapp_groups', {}, caller)) as {
      groups: unknown[]
      window: string
    }

    expect(forTool).toHaveBeenCalledWith({ window: '24h' })
    expect(trigger).not.toHaveBeenCalled()
    expect(result.groups).toHaveLength(1)
  })

  it('returns an honest empty-state inline (never "המערכת עמוסה")', async () => {
    const forTool = vi.fn().mockResolvedValue({
      groups: [],
      totalGroups: 0,
      window: '24h',
      rangeLabel: '24 השעות האחרונות',
      empty: true,
    })
    const caller = buildCaller({ forTool })

    const result = (await executeTool('summarize_whatsapp_groups', {}, caller)) as { empty: boolean }

    expect(result.empty).toBe(true)
  })

  it('returns raw DB data for a single group when groupJid is given', async () => {
    const forTool = vi.fn().mockResolvedValue({
      groupName: 'צוות',
      groupJid: '120363@g.us',
      window: '7d',
      messageCount: 5,
      topSenders: [{ name: 'דוד', count: 3 }],
      recentMessages: ['[10:00] דוד: היי', '[10:05] שרה: מה נשמע'],
      empty: false,
    })
    const caller = buildCaller({ forTool })

    const result = (await executeTool(
      'summarize_whatsapp_groups',
      { groupJid: '120363@g.us' },
      caller,
    )) as { messageCount: number }

    expect(forTool).toHaveBeenCalledWith({ groupJid: '120363@g.us', window: '7d' })
    expect(result.messageCount).toBe(5)
  })

  it('honors an explicit window for the all-groups data', async () => {
    const forTool = vi.fn().mockResolvedValue({ groups: [], window: '6h', empty: true })
    const caller = buildCaller({ forTool })

    await executeTool('summarize_whatsapp_groups', { window: '6h' }, caller)

    expect(forTool).toHaveBeenCalledWith({ window: '6h' })
  })
})

describe('executeTool — WhatsApp time-anchored windows', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes window=today through to forTool', async () => {
    const forTool = vi.fn().mockResolvedValue({ groups: [], window: 'today', rangeLabel: 'היום', empty: true })
    const caller = buildCaller({ forTool })

    const result = (await executeTool('whatsapp_now', { window: 'today' }, caller)) as {
      rangeLabel: string
    }

    expect(forTool).toHaveBeenCalledWith({ window: 'today' })
    expect(result.rangeLabel).toBe('היום')
  })

  it('passes window=yesterday through to forTool', async () => {
    const forTool = vi.fn().mockResolvedValue({ groups: [], window: 'yesterday', rangeLabel: 'אתמול', empty: true })
    const caller = buildCaller({ forTool })

    await executeTool('summarize_whatsapp_groups', { window: 'yesterday' }, caller)

    expect(forTool).toHaveBeenCalledWith({ window: 'yesterday' })
  })

  it('forwards an hour range and anchors it to today when no window is given', async () => {
    const forTool = vi.fn().mockResolvedValue({ groups: [], window: 'today', rangeLabel: 'היום 14:00–16:00', empty: true })
    const caller = buildCaller({ forTool })

    await executeTool('whatsapp_now', { sinceHour: 14, untilHour: 16 }, caller)

    expect(forTool).toHaveBeenCalledWith({ window: 'today', sinceHour: 14, untilHour: 16 })
  })

  it('keeps an hour range anchored to yesterday when asked', async () => {
    const forTool = vi.fn().mockResolvedValue({
      groupName: 'test',
      groupJid: '120363@g.us',
      messageCount: 2,
      window: 'yesterday',
      rangeLabel: 'אתמול מ-22:00',
      topSenders: [],
      recentMessages: [],
      empty: false,
    })
    const caller = buildCaller({ forTool })

    await executeTool(
      'summarize_whatsapp_groups',
      { groupJid: '120363@g.us', window: 'yesterday', sinceHour: 22 },
      caller,
    )

    expect(forTool).toHaveBeenCalledWith({
      groupJid: '120363@g.us',
      window: 'yesterday',
      sinceHour: 22,
    })
  })

  it('accepts numeric hours sent as strings and drops out-of-range values', async () => {
    const forTool = vi.fn().mockResolvedValue({ groups: [], window: 'today', rangeLabel: 'היום מ-08:00', empty: true })
    const caller = buildCaller({ forTool })

    await executeTool('whatsapp_now', { sinceHour: '8', untilHour: 99 }, caller)

    expect(forTool).toHaveBeenCalledWith({ window: 'today', sinceHour: 8 })
  })

  it('falls back to the default window when the model invents one', async () => {
    const forTool = vi.fn().mockResolvedValue({ groups: [], window: '24h', rangeLabel: '24 השעות האחרונות', empty: true })
    const caller = buildCaller({ forTool })

    await executeTool('whatsapp_now', { window: 'this-week' }, caller)

    expect(forTool).toHaveBeenCalledWith({ window: '24h' })
  })
})
