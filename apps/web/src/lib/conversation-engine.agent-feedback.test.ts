import { beforeEach, describe, expect, it, vi } from 'vitest'

// Same mock surface as conversation-engine.whatsapp-summary.test.ts — lets us import
// executeTool without pulling real server dependencies.
vi.mock('./abc-agents', () => ({
  getRunnableAgentIds: () => ['01_Hugo_orchestrator', '06_calendar_optimizer'],
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
  localTodayIso: () => '2026-08-02',
  filterEventsByCalendarScope: (events: unknown[]) => events,
  getAgentCalendarIds: vi.fn().mockResolvedValue([]),
}))
vi.mock('@ak-system/database', () => ({
  chatMessages: {},
  getDb: vi.fn(),
}))

const appendAgentFeedback = vi.fn()
vi.mock('./agent-feedback-log', () => ({
  appendAgentFeedback: (...args: unknown[]) => appendAgentFeedback(...args),
}))

import { executeTool, getToolDeclarations } from './conversation-engine'

type AnyCaller = Parameters<typeof executeTool>[2]

const caller = {} as unknown as AnyCaller

describe('log_agent_feedback tool declaration', () => {
  it('is exposed with the registered agent ids as its enum', () => {
    const decl = getToolDeclarations().find((d) => d.name === 'log_agent_feedback')
    expect(decl).toBeDefined()
    const agentId = decl?.parameters?.properties?.agentId as { enum?: string[] } | undefined
    expect(agentId?.enum).toEqual(['01_Hugo_orchestrator', '06_calendar_optimizer'])
    expect(decl?.parameters?.required).toEqual(['agentId', 'feedback'])
  })
})

describe('executeTool — log_agent_feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appendAgentFeedback.mockReturnValue({
      logged: true,
      agentId: '06_calendar_optimizer',
      path: 'M_Memory/agents_daily_sync.md',
    })
  })

  it('routes the correction to the memory log and reports it as queued', async () => {
    const result = (await executeTool(
      'log_agent_feedback',
      { agentId: '06_calendar_optimizer', feedback: 'קובע פגישות מוקדם מדי' },
      caller,
    )) as { logged: boolean; agentId: string; note: string }

    expect(appendAgentFeedback).toHaveBeenCalledWith({
      agentId: '06_calendar_optimizer',
      feedback: 'קובע פגישות מוקדם מדי',
      channel: undefined,
    })
    expect(result.logged).toBe(true)
    expect(result.agentId).toBe('06_calendar_optimizer')
    expect(result.note).toContain('human review')
  })

  it('passes the channel through when the chat came from another surface', async () => {
    await executeTool(
      'log_agent_feedback',
      { agentId: '06_calendar_optimizer', feedback: 'תיקון' },
      caller,
      { channel: 'whatsapp' },
    )
    expect(appendAgentFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'whatsapp' }),
    )
  })

  it('returns an error without writing when feedback is missing', async () => {
    const result = (await executeTool(
      'log_agent_feedback',
      { agentId: '06_calendar_optimizer' },
      caller,
    )) as { error: string }

    expect(result.error).toMatch(/feedback is required/i)
    expect(appendAgentFeedback).not.toHaveBeenCalled()
  })

  it('returns an error without writing when agentId is missing', async () => {
    const result = (await executeTool(
      'log_agent_feedback',
      { feedback: 'תיקון' },
      caller,
    )) as { error: string }

    expect(result.error).toMatch(/agentId is required/i)
    expect(appendAgentFeedback).not.toHaveBeenCalled()
  })

  it('surfaces a write failure as a tool error instead of throwing', async () => {
    appendAgentFeedback.mockImplementation(() => {
      throw new Error('EACCES: permission denied')
    })

    const result = (await executeTool(
      'log_agent_feedback',
      { agentId: '06_calendar_optimizer', feedback: 'תיקון' },
      caller,
    )) as { error: string }

    expect(result.error).toContain('EACCES')
  })
})
