import { beforeEach, describe, expect, it, vi } from 'vitest'

// Same mock surface as conversation-engine.agent-feedback.test.ts — lets us import
// executeTool without pulling real server dependencies.
vi.mock('./abc-agents', () => ({
  getRunnableAgentIds: () => ['01_Hugo_orchestrator', '04_meeting_prep_herald'],
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
  localTodayIso: () => '2026-10-06',
  filterEventsByCalendarScope: (events: unknown[]) => events,
  getAgentCalendarIds: vi.fn().mockResolvedValue([]),
}))
vi.mock('@ak-system/database', () => ({
  chatMessages: {},
  getDb: vi.fn(),
}))
vi.mock('./agent-feedback-log', () => ({ appendAgentFeedback: vi.fn() }))

import { executeTool, getToolDeclarations } from './conversation-engine'

type AnyCaller = Parameters<typeof executeTool>[2]

const worldState = vi.fn()
const personSignals = vi.fn()
const caller = { harness: { worldState, personSignals } } as unknown as AnyCaller

const insight = {
  id: 'hi_1',
  kind: 'cooling_with_open_loop',
  severity: 'urgent',
  title: 'אור זלניקר שקט שבועיים',
  body: 'התחייבות פתוחה מולו מ-12.9',
  score: 0.82,
  personId: 'p_or',
  generatedAt: '2026-10-06T09:00:00.000Z',
  sources: [
    { nodeId: 'person:p_or', kind: 'person', label: 'אור זלניקר' },
    { nodeId: 'commitment:c_1', kind: 'commitment', label: 'לשלוח הצעה' },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  worldState.mockResolvedValue({
    nodesByKind: { person: 40, meeting: 120 },
    edgesByKind: { ATTENDED: 359 },
    lastIndexedAt: '2026-10-06T09:00:00.000Z',
    insights: [insight],
  })
  personSignals.mockResolvedValue({
    person: { id: 'p_or', name: 'אור זלניקר' },
    lastSignalAt: '2026-09-22T10:00:00.000Z',
    meetings: [{ id: 'meeting:m1', label: 'DAZ אסטרטגיה', occurredAt: '2026-09-20' }],
    commitments: [],
    whatsapp: [],
    insights: [insight, { ...insight, id: 'hi_2', personId: 'p_other' }],
  })
})

describe('get_harness_insights — declaration gating', () => {
  it('is exposed to the three cross-domain agents and the general chat', () => {
    for (const agentId of [undefined, '01_Hugo_orchestrator', '03_morning_briefing', '04_meeting_prep_herald']) {
      expect(getToolDeclarations(agentId).map((d) => d.name)).toContain('get_harness_insights')
    }
  })

  it('is hidden from single-domain specialists', () => {
    for (const agentId of ['02_agent_trainer', '05_ibkr_daily_import', '06_calendar_optimizer', '07_email_assistant', '08_startup_coo']) {
      expect(getToolDeclarations(agentId).map((d) => d.name)).not.toContain('get_harness_insights')
    }
  })

  it('takes optional personId and severity, and requires neither', () => {
    const decl = getToolDeclarations().find((d) => d.name === 'get_harness_insights')
    expect(Object.keys(decl?.parameters?.properties ?? {})).toEqual(['personId', 'severity'])
    expect(decl?.parameters?.required).toBeUndefined()
  })
})

describe('executeTool — get_harness_insights', () => {
  it('returns the world state with each insight carrying what it was derived from', async () => {
    const res = (await executeTool('get_harness_insights', {}, caller)) as {
      indexedAt: string
      domains: Record<string, number>
      insights: { title: string; basedOn: string[] }[]
    }

    expect(worldState).toHaveBeenCalledWith({ insightLimit: 12 })
    expect(res.indexedAt).toBe('2026-10-06T09:00:00.000Z')
    expect(res.domains.meeting).toBe(120)
    expect(res.insights[0].basedOn).toEqual(['person: אור זלניקר', 'commitment: לשלוח הצעה'])
  })

  it('never leaks the raw node ids or summaries the insight was built from', async () => {
    const res = (await executeTool('get_harness_insights', {}, caller)) as {
      insights: Record<string, unknown>[]
    }
    expect(res.insights[0]).not.toHaveProperty('sources')
    expect(JSON.stringify(res)).not.toContain('nodeId')
  })

  it('filters by severity when asked', async () => {
    const res = (await executeTool('get_harness_insights', { severity: 'info' }, caller)) as {
      insights: unknown[]
    }
    expect(res.insights).toEqual([])
  })

  it('ignores a severity it does not recognise rather than returning nothing', async () => {
    const res = (await executeTool('get_harness_insights', { severity: 'critical' }, caller)) as {
      insights: unknown[]
    }
    expect(res.insights).toHaveLength(1)
  })

  it('switches to one person when personId is given', async () => {
    const res = (await executeTool('get_harness_insights', { personId: ' p_or ' }, caller)) as {
      person: { name: string }
      lastSignalAt: string
      meetings: unknown[]
      insights: { personId: string | null }[]
    }

    expect(personSignals).toHaveBeenCalledWith({ personId: 'p_or' })
    expect(worldState).not.toHaveBeenCalled()
    expect(res.person.name).toBe('אור זלניקר')
    expect(res.lastSignalAt).toBe('2026-09-22T10:00:00.000Z')
    expect(res.meetings).toHaveLength(1)
    // personSignals already scopes its insights to that person; the shaper must not drop them.
    expect(res.insights.map((i) => i.personId)).toEqual(['p_or', 'p_other'])
  })
})

describe('tool parity for Hugo', () => {
  // The web chat and Telegram now run through Hugo instead of a general assistant with
  // no agentId. The per-agent gating filters by id, so Hugo must not end up with less
  // than the ungated set — that would silently remove capability from the main chat.
  it('gives Hugo at least every tool the ungated set has', () => {
    const ungated = getToolDeclarations().map((d) => d.name)
    const hugo = new Set(getToolDeclarations('01_Hugo_orchestrator').map((d) => d.name))
    const missing = ungated.filter((name) => !hugo.has(name))
    expect(missing).toEqual([])
  })

  it('keeps the cross-domain tool for Hugo specifically', () => {
    expect(getToolDeclarations('01_Hugo_orchestrator').map((d) => d.name)).toContain(
      'get_harness_insights',
    )
  })
})
