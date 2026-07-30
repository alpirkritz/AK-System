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
