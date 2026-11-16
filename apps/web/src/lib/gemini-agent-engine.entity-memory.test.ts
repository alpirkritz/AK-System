import { describe, expect, it, vi } from 'vitest'

const getMemoryPromptBlock = vi.fn().mockResolvedValue('## memory block')

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(),
  FunctionCallingMode: { AUTO: 'AUTO' },
  SchemaType: { OBJECT: 'OBJECT', STRING: 'STRING' },
}))
vi.mock('./conversation-engine', () => ({
  createApiCaller: vi.fn().mockResolvedValue({}),
  executeTool: vi.fn(),
  getToolDeclarations: () => [],
}))
vi.mock('./abc-agents', () => ({
  getAgentInstructions: () => 'agent card',
  getAgentWorkflowContent: () => null,
  agentNeedsCalendarContext: (id: string) => id === '04_meeting_prep_herald',
  agentNeedsNotionContext: () => false,
  getAbcRootPath: () => '/tmp/abc',
  HUGO_AGENT_ID: '01_Hugo_orchestrator',
}))
vi.mock('./agent-memory', () => ({ getMemoryPromptBlock: (...a: unknown[]) => getMemoryPromptBlock(...a) }))
vi.mock('./notion', () => ({
  formatNotionContextForPrompt: () => '',
  getNotionContext: vi.fn().mockResolvedValue({}),
}))
vi.mock('@ak-system/api', () => ({
  getAgentCalendarScopePromptBlock: vi.fn().mockResolvedValue(''),
  getDefaultTimezone: () => 'Asia/Jerusalem',
  localTodayIso: () => '2026-11-16',
  getAgentCalendarContext: vi.fn().mockResolvedValue({}),
  formatAgentCalendarContextForPrompt: () => '10:00 DD release — attendees: דן כהן',
  ownerIdentityPrompt: () => 'The user is Alpir.',
}))

import { buildAgentSystemInstruction } from './gemini-agent-engine'

describe('entity-scoped memory anchors in the system instruction', () => {
  it('passes the message, the last 6 turns and the calendar text to the memory block', async () => {
    getMemoryPromptBlock.mockClear()
    const history = Array.from({ length: 9 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `turn ${i}`,
    }))
    const prompt = await buildAgentSystemInstruction('04_meeting_prep_herald', 'cron', undefined, {
      message: 'Meeting: DD release',
      history,
    })
    const texts = (getMemoryPromptBlock.mock.calls[0][0] as { texts: string[] }).texts
    expect(texts[0]).toBe('Meeting: DD release')
    expect(texts).toContain('turn 8')
    expect(texts).toContain('turn 3')
    expect(texts).not.toContain('turn 2')
    expect(texts.at(-1)).toContain('דן כהן')
    expect(prompt).toContain('## memory block')
  })

  it('scans no calendar text for agents without calendar context', async () => {
    getMemoryPromptBlock.mockClear()
    await buildAgentSystemInstruction('07_email_assistant', 'web', undefined, { message: 'מה עם דן?' })
    const texts = (getMemoryPromptBlock.mock.calls[0][0] as { texts: string[] }).texts
    expect(texts).toEqual(['מה עם דן?'])
  })
})
