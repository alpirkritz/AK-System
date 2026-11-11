import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendMessage = vi.fn()
const executeTool = vi.fn()

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({ startChat: () => ({ sendMessage }) }),
  })),
  FunctionCallingMode: { AUTO: 'AUTO' },
  SchemaType: { OBJECT: 'OBJECT', STRING: 'STRING' },
}))

vi.mock('./conversation-engine', () => ({
  createApiCaller: vi.fn().mockResolvedValue({}),
  executeTool: (...args: unknown[]) => executeTool(...args),
  getToolDeclarations: () => [],
}))

vi.mock('./abc-agents', () => ({
  getAgentInstructions: () => 'agent card',
  getAgentWorkflowContent: () => null,
  agentNeedsCalendarContext: () => false,
  agentNeedsNotionContext: () => false,
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
  localTodayIso: () => '2026-07-16',
  getAgentCalendarContext: vi.fn().mockResolvedValue({}),
  formatAgentCalendarContextForPrompt: () => '',
  ownerIdentityPrompt: () => 'The user is Alpir Kritzler (אלפיר קריצלר).',
}))

import { runGeminiAgentChat, singleMeetingFocusTitle } from './gemini-agent-engine'

const GROUNDING_RETRY = 'STOP — do not invent meeting-prep content'

function textResp(text: string) {
  return { response: { functionCalls: () => undefined, text: () => text } }
}
function toolCallResp(name: string) {
  return { response: { functionCalls: () => [{ name, args: {} }], text: () => '' } }
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key'
  sendMessage.mockReset()
  executeTool.mockReset()
  executeTool.mockResolvedValue({})
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('singleMeetingFocusTitle', () => {
  it('reads one Meeting line and ignores zero or many', () => {
    expect(singleMeetingFocusTitle('Meeting: Follow up DD release discussion\nTime: 13:30')).toBe(
      'Follow up DD release discussion',
    )
    expect(singleMeetingFocusTitle('Meeting: Algo 4\nMeeting: DD release')).toBeNull()
    expect(singleMeetingFocusTitle('תכין אותי למחר')).toBeNull()
  })
})

describe('runGeminiAgentChat — meeting prep grounding', () => {
  it('forces a grounding retry when 04 answers without calling any data tool', async () => {
    sendMessage
      // initial answer with no tool calls (ungrounded)
      .mockResolvedValueOnce(textResp('הפגישה עם דני על הפרויקט...'))
      // after the grounding retry prompt: model calls a data tool
      .mockResolvedValueOnce(toolCallResp('get_notion_tasks'))
      // final grounded answer
      .mockResolvedValueOnce(textResp('לפי המשימות: אין הערות קודמות — לא נמצא בנתונים.'))

    const result = await runGeminiAgentChat({
      agentId: '04_meeting_prep_herald',
      message: 'תכין אותי לפגישה',
    })

    const prompts = sendMessage.mock.calls.map((c) => String(c[0]))
    expect(prompts.some((p) => p.startsWith(GROUNDING_RETRY))).toBe(true)
    expect(prompts.some((p) => p.includes('לא נמצאו משימות קשורות לפגישה זו'))).toBe(true)
    expect(executeTool).toHaveBeenCalledWith(
      'get_notion_tasks',
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ agentId: '04_meeting_prep_herald' }),
    )
    expect(result.text).toContain('לא נמצא בנתונים')
  })

  it('does NOT retry when 04 already called a grounding tool', async () => {
    sendMessage
      // initial answer already calls a data tool
      .mockResolvedValueOnce(toolCallResp('get_notion_meeting_notes'))
      // grounded answer after tool result
      .mockResolvedValueOnce(textResp('סיכום מבוסס נתונים.'))

    const result = await runGeminiAgentChat({
      agentId: '04_meeting_prep_herald',
      message: 'תכין אותי לפגישה',
    })

    const prompts = sendMessage.mock.calls.map((c) => String(c[0]))
    expect(prompts.some((p) => p.startsWith(GROUNDING_RETRY))).toBe(false)
    expect(result.text).toBe('סיכום מבוסס נתונים.')
  })

  it('injects focusTitle from the single Meeting line', async () => {
    sendMessage.mockResolvedValueOnce({
      response: {
        functionCalls: () => [
          { name: 'get_notion_meeting_notes', args: {} },
          { name: 'get_notion_tasks', args: {} },
        ],
        text: () => '',
      },
    })
    sendMessage.mockResolvedValueOnce(textResp('כרטיס DD.'))

    await runGeminiAgentChat({
      agentId: '04_meeting_prep_herald',
      message: 'prep\n\nMeeting: Follow up DD release discussion\nTime: 13:30',
    })

    expect(executeTool).toHaveBeenCalledWith(
      'get_notion_meeting_notes',
      expect.objectContaining({ focusTitle: 'Follow up DD release discussion' }),
      expect.anything(),
      expect.anything(),
    )
    expect(executeTool).toHaveBeenCalledWith(
      'get_notion_tasks',
      expect.objectContaining({ focusTitle: 'Follow up DD release discussion' }),
      expect.anything(),
      expect.anything(),
    )
  })

  it('does not inject focusTitle when the prompt names two meetings', async () => {
    sendMessage.mockResolvedValueOnce(toolCallResp('get_notion_meeting_notes'))
    sendMessage.mockResolvedValueOnce(textResp('שני כרטיסים.'))

    await runGeminiAgentChat({
      agentId: '04_meeting_prep_herald',
      message: 'Meeting: Follow up DD release discussion\nMeeting: Algo 4.0 Sync',
    })

    expect(executeTool).toHaveBeenCalledWith(
      'get_notion_meeting_notes',
      {},
      expect.anything(),
      expect.anything(),
    )
  })

  it('keeps a focusTitle the model already sent', async () => {
    sendMessage.mockResolvedValueOnce({
      response: {
        functionCalls: () => [{ name: 'get_notion_tasks', args: { focusTitle: 'DD sync' } }],
        text: () => '',
      },
    })
    sendMessage.mockResolvedValueOnce(textResp('כרטיס.'))

    await runGeminiAgentChat({
      agentId: '04_meeting_prep_herald',
      message: 'Meeting: Follow up DD release discussion',
    })

    expect(executeTool).toHaveBeenCalledWith(
      'get_notion_tasks',
      { focusTitle: 'DD sync' },
      expect.anything(),
      expect.anything(),
    )
  })

  it('does NOT apply the grounding retry to other agents', async () => {
    sendMessage.mockResolvedValueOnce(textResp('תשובה כללית.'))

    await runGeminiAgentChat({ agentId: '07_email_assistant', message: 'שלום' })

    const prompts = sendMessage.mock.calls.map((c) => String(c[0]))
    expect(prompts.some((p) => p.startsWith(GROUNDING_RETRY))).toBe(false)
  })
})
