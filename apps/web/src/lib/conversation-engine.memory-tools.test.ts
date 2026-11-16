import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./abc-agents', () => ({
  getRunnableAgentIds: () => ['01_Hugo_orchestrator', '07_email_assistant'],
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
  localTodayIso: () => '2026-11-16',
  filterEventsByCalendarScope: (events: unknown[]) => events,
  getAgentCalendarIds: vi.fn().mockResolvedValue([]),
}))
vi.mock('@ak-system/database', () => ({ chatMessages: {}, getDb: vi.fn() }))
vi.mock('./agent-feedback-log', () => ({ appendAgentFeedback: vi.fn() }))

import { executeTool, getToolDeclarations } from './conversation-engine'

type AnyCaller = Parameters<typeof executeTool>[2]

const create = vi.fn()
const suggestLinks = vi.fn()
const resolveNames = vi.fn()
const recall = vi.fn()
const caller = {
  memory: { memories: { create, suggestLinks }, resolveNames, recall },
} as unknown as AnyCaller

beforeEach(() => {
  for (const f of [create, suggestLinks, resolveNames, recall]) f.mockReset()
  create.mockResolvedValue({ id: 'mem_1' })
})

describe('remember — entity links', () => {
  it('resolves named people and reports who it was linked to', async () => {
    resolveNames.mockResolvedValue({
      links: [{ kind: 'person', entityId: 'p_dan', label: 'דן כהן' }],
      unresolved: ['יוסי'],
    })
    const res = (await executeTool(
      'remember',
      { content: 'דן מעדיף עדכונים בכתב', aboutPeople: ['דן', 'יוסי'] },
      caller,
    )) as { linkedTo: string[]; unresolved: string[]; note: string }
    expect(resolveNames).toHaveBeenCalledWith(expect.objectContaining({ people: ['דן', 'יוסי'] }))
    expect(suggestLinks).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'chat', links: [{ kind: 'person', entityId: 'p_dan' }] }),
    )
    expect(res.linkedTo).toEqual(['דן כהן'])
    expect(res.note).toContain('יוסי')
  })

  it('links by content when no names are passed, and stays global when nothing matches', async () => {
    suggestLinks.mockResolvedValue({ links: [] })
    const res = (await executeTool('remember', { content: 'אני מעדיף פגישות בבוקר' }, caller)) as { linkedTo: string[] }
    expect(suggestLinks).toHaveBeenCalledWith({ content: 'אני מעדיף פגישות בבוקר' })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ links: [] }))
    expect(res.linkedTo).toEqual([])
  })
})

describe('recall_memories', () => {
  it('returns memories grouped by entity', async () => {
    recall.mockResolvedValue({
      scoped: [{ anchor: { kind: 'person', entityId: 'p_dan', label: 'דן כהן' }, memories: [{ content: 'א' }, { content: 'ב' }] }],
      matchingGlobal: [],
      unresolved: [],
    })
    const res = (await executeTool('recall_memories', { person: 'דן' }, caller)) as {
      byEntity: Array<{ about: string; memories: string[] }>
    }
    expect(recall).toHaveBeenCalledWith(expect.objectContaining({ person: 'דן' }))
    expect(res.byEntity[0]).toEqual({ about: 'דן כהן', kind: 'person', memories: ['א', 'ב'] })
  })

  it('is offered to Hugo and hidden from other specialists', () => {
    const names = (id?: string) => getToolDeclarations(id).map((d) => d.name)
    expect(names('01_Hugo_orchestrator')).toContain('recall_memories')
    expect(names(undefined)).toContain('recall_memories')
    expect(names('07_email_assistant')).not.toContain('recall_memories')
  })

  it('save_fact no longer claims "remember" requests', () => {
    const saveFact = getToolDeclarations().find((d) => d.name === 'save_fact')!
    expect(saveFact.description).not.toMatch(/Use for: 'שמור ש/)
    expect(saveFact.description).toContain('use `remember` instead')
  })
})
