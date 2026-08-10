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
  digest?: ReturnType<typeof vi.fn>
  forGroup?: ReturnType<typeof vi.fn>
  trigger?: ReturnType<typeof vi.fn>
}) {
  return {
    whatsapp: {
      insights: {
        digest: overrides.digest ?? vi.fn(),
        forGroup: overrides.forGroup ?? vi.fn(),
      },
      summaries: {
        trigger: overrides.trigger ?? vi.fn(),
      },
    },
  } as unknown as AnyCaller
}

describe('executeTool — summarize_whatsapp_groups', () => {
  beforeEach(() => vi.clearAllMocks())

  it('summarizes all groups via the DB-backed digest (inline), not the bridge', async () => {
    const digest = vi.fn().mockResolvedValue({
      text: '📡 מה קורה עכשיו בקבוצות\n\nהכול רגוע.',
      items: [],
      window: '24h',
    })
    const trigger = vi.fn()
    const caller = buildCaller({ digest, trigger })

    const result = (await executeTool('summarize_whatsapp_groups', {}, caller)) as {
      text: string
      window: string
    }

    expect(digest).toHaveBeenCalledWith({ window: '24h' })
    expect(trigger).not.toHaveBeenCalled()
    expect(result.text).toContain('מה קורה עכשיו בקבוצות')
  })

  it('returns an honest empty-state message inline (never "המערכת עמוסה")', async () => {
    const digest = vi.fn().mockResolvedValue({
      text: 'אין פעילות חדשה בקבוצות שאתה עוקב אחריהן בטווח הזה.',
      items: [],
      window: '24h',
    })
    const caller = buildCaller({ digest })

    const result = (await executeTool('summarize_whatsapp_groups', {}, caller)) as { text: string }

    expect(result.text).toContain('אין פעילות חדשה')
    expect(result.text).not.toContain('המערכת עמוסה')
  })

  it('summarizes a single group via insights.forGroup when groupJid is given', async () => {
    const forGroup = vi.fn().mockResolvedValue({
      text: '📋 סיכום קבוצה — צוות',
      messageCount: 5,
      mode: 'summary',
      window: '7d',
    })
    const digest = vi.fn()
    const caller = buildCaller({ forGroup, digest })

    const result = (await executeTool(
      'summarize_whatsapp_groups',
      { groupJid: '120363@g.us' },
      caller,
    )) as { text: string; messageCount: number }

    expect(forGroup).toHaveBeenCalledWith({ groupJid: '120363@g.us', window: '7d', mode: 'summary' })
    expect(digest).not.toHaveBeenCalled()
    expect(result.messageCount).toBe(5)
  })

  it('honors an explicit window for the all-groups digest', async () => {
    const digest = vi.fn().mockResolvedValue({ text: 'x', items: [], window: '6h' })
    const caller = buildCaller({ digest })

    await executeTool('summarize_whatsapp_groups', { window: '6h' }, caller)

    expect(digest).toHaveBeenCalledWith({ window: '6h' })
  })
})

describe('executeTool — WhatsApp time-anchored windows', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes window=today through to the digest', async () => {
    const digest = vi.fn().mockResolvedValue({ text: 'x', items: [], window: 'today', rangeLabel: 'היום' })
    const caller = buildCaller({ digest })

    const result = (await executeTool('whatsapp_now', { window: 'today' }, caller)) as {
      rangeLabel: string
    }

    expect(digest).toHaveBeenCalledWith({ window: 'today' })
    expect(result.rangeLabel).toBe('היום')
  })

  it('passes window=yesterday through to the digest', async () => {
    const digest = vi.fn().mockResolvedValue({ text: 'x', items: [], window: 'yesterday', rangeLabel: 'אתמול' })
    const caller = buildCaller({ digest })

    await executeTool('summarize_whatsapp_groups', { window: 'yesterday' }, caller)

    expect(digest).toHaveBeenCalledWith({ window: 'yesterday' })
  })

  it('forwards an hour range and anchors it to today when no window is given', async () => {
    const digest = vi.fn().mockResolvedValue({ text: 'x', items: [], window: 'today', rangeLabel: 'היום 14:00–16:00' })
    const caller = buildCaller({ digest })

    await executeTool('whatsapp_now', { sinceHour: 14, untilHour: 16 }, caller)

    expect(digest).toHaveBeenCalledWith({ window: 'today', sinceHour: 14, untilHour: 16 })
  })

  it('keeps an hour range anchored to yesterday when asked', async () => {
    const forGroup = vi.fn().mockResolvedValue({
      text: 'y',
      messageCount: 2,
      mode: 'summary',
      window: 'yesterday',
      rangeLabel: 'אתמול מ-22:00',
    })
    const caller = buildCaller({ forGroup })

    await executeTool(
      'summarize_whatsapp_groups',
      { groupJid: '120363@g.us', window: 'yesterday', sinceHour: 22 },
      caller,
    )

    expect(forGroup).toHaveBeenCalledWith({
      groupJid: '120363@g.us',
      window: 'yesterday',
      sinceHour: 22,
      mode: 'summary',
    })
  })

  it('accepts numeric hours sent as strings and drops out-of-range values', async () => {
    const digest = vi.fn().mockResolvedValue({ text: 'x', items: [], window: 'today', rangeLabel: 'היום מ-08:00' })
    const caller = buildCaller({ digest })

    await executeTool('whatsapp_now', { sinceHour: '8', untilHour: 99 }, caller)

    expect(digest).toHaveBeenCalledWith({ window: 'today', sinceHour: 8 })
  })

  it('falls back to the default window when the model invents one', async () => {
    const digest = vi.fn().mockResolvedValue({ text: 'x', items: [], window: '24h', rangeLabel: '24 השעות האחרונות' })
    const caller = buildCaller({ digest })

    await executeTool('whatsapp_now', { window: 'this-week' }, caller)

    expect(digest).toHaveBeenCalledWith({ window: '24h' })
  })
})
