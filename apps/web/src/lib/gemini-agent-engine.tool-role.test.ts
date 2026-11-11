import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendMessage = vi.fn()
const generateContent = vi.fn()
const history: Array<{ role?: string; parts: unknown[] }> = []
const getHistory = vi.fn(async () => history)
const executeTool = vi.fn()

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({
      startChat: () => ({ sendMessage, getHistory }),
      generateContent,
    }),
  })),
  FunctionCallingMode: { AUTO: 'AUTO' },
  SchemaType: { OBJECT: 'OBJECT', STRING: 'STRING' },
}))

vi.mock('./conversation-engine', () => ({
  createApiCaller: vi.fn().mockResolvedValue({}),
  executeTool: (...args: unknown[]) => executeTool(...args),
  getToolDeclarations: () => [],
  calendarOptimizerHidesTasks: () => false,
}))

vi.mock('./abc-agents', () => ({
  getAgentInstructions: () => 'agent card',
  getAgentWorkflowContent: () => null,
  agentNeedsCalendarContext: () => false,
  agentNeedsNotionContext: () => false,
  agentCardRequestsDueTasks: () => false,
  getAbcRootPath: () => '/tmp/abc',
  HUGO_AGENT_ID: '01_Hugo_orchestrator',
}))

vi.mock('./agent-memory', () => ({ getMemoryPromptBlock: vi.fn().mockResolvedValue('') }))
vi.mock('./notion', () => ({
  formatNotionContextForPrompt: () => '',
  getNotionContext: vi.fn().mockResolvedValue({}),
}))
vi.mock('@ak-system/api', () => ({
  getAgentCalendarScopePromptBlock: vi.fn().mockResolvedValue(''),
  getDefaultTimezone: () => 'Asia/Jerusalem',
  localTodayIso: () => '2026-10-12',
  getAgentCalendarContext: vi.fn().mockResolvedValue({}),
  formatAgentCalendarContextForPrompt: () => '',
  ownerIdentityPrompt: () => 'The user is Alpir Kritzler (אלפיר קריצלר).',
}))

import { runGeminiAgentChat } from './gemini-agent-engine'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key'
  history.splice(0, history.length)
  sendMessage.mockReset()
  generateContent.mockReset()
  getHistory.mockClear()
  executeTool.mockReset()
  executeTool.mockResolvedValue({ sum: 4 })
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('Gemini 3 tool results', () => {
  it('sends the tool result as role user and keeps the call id', async () => {
    sendMessage.mockImplementation(async (request: unknown) => {
      if (typeof request === 'string') {
        history.push({ role: 'user', parts: [{ text: request }] })
        history.push({
          role: 'model',
          parts: [{ functionCall: { name: 'add', args: {}, id: 'call_1' }, thoughtSignature: 'sig' }],
        })
      }
      return {
        response: {
          functionCalls: () => [{ name: 'add', args: {}, id: 'call_1' }],
          text: () => '',
          candidates: [{ content: { role: 'model', parts: [] } }],
        },
      }
    })
    generateContent.mockResolvedValue({
      response: {
        functionCalls: () => undefined,
        text: () => 'ארבע',
        candidates: [{ content: { role: 'model', parts: [{ text: 'ארבע' }] }, finishReason: 'STOP' }],
      },
    })

    const result = await runGeminiAgentChat({ agentId: '07_email_assistant', message: 'כמה זה' })

    expect(generateContent).toHaveBeenCalledTimes(1)
    const contents = generateContent.mock.calls[0]?.[0].contents as Array<{ role: string; parts: Array<Record<string, unknown>> }>
    const toolTurn = contents[contents.length - 1]
    expect(toolTurn.role).toBe('user')
    expect(toolTurn.parts[0]?.functionResponse).toMatchObject({ name: 'add', id: 'call_1', response: { result: { sum: 4 } } })
    expect(contents.some((turn) => turn.parts.some((part) => part.thoughtSignature === 'sig'))).toBe(true)
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(result.text).toBe('ארבע')
  })
})
