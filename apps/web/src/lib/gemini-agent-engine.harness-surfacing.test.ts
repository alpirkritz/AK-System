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
  localTodayIso: () => '2026-10-06',
  getAgentCalendarContext: vi.fn().mockResolvedValue({}),
  formatAgentCalendarContextForPrompt: () => '',
  ownerIdentityPrompt: () =>
    'The user is Alpir Kritzler (אלפיר קריצלר / Alpir Kritzler). Every recorded conversation was recorded by him and he is in it.',
}))

import { buildAgentSystemInstruction, runGeminiAgentChat } from './gemini-agent-engine'

const HEADER = 'קישורים בין תחומים'
const RETRY_MARKER = 'get_harness_insights returned open cross-domain insights'

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
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

/** Hugo calls the harness tool, it returns `insights`, then he replies with `reply`. */
function wireRun(insights: unknown[], reply: string, retryReply?: string) {
  executeTool.mockResolvedValue({ insights })
  sendMessage
    .mockResolvedValueOnce(toolCallResp('get_harness_insights'))
    .mockResolvedValueOnce(textResp(reply))
    .mockResolvedValueOnce(textResp(retryReply ?? ''))
}

const ONE_INSIGHT = [{ title: 'אור זלניקר שקט שבועיים', basedOn: ['person: Or Zelniker'] }]

describe('clock in the system instruction', () => {
  it('states the current local time and forbids a contradicting greeting', async () => {
    const prompt = await buildAgentSystemInstruction('01_Hugo_orchestrator', 'web')
    expect(prompt).toMatch(/Now: .+, \d{2}:\d{2} \(2026-10-06, Asia\/Jerusalem\)/)
    expect(prompt).toContain('NEVER use a time-of-day greeting that contradicts that clock')
    expect(prompt).toContain('אלפיר קריצלר')
    expect(prompt).toContain('Every recorded conversation was recorded by him')
  })
})

describe('harness surfacing guard', () => {
  it('forces one retry when the reply drops the insights, and keeps the retried text', async () => {
    wireRun(ONE_INSIGHT, 'מה חשוב עכשיו: פגישות ומשימות בפיגור', `יש גם ${HEADER}: אור זלניקר שקט`)

    const res = await runGeminiAgentChat({
      agentId: '01_Hugo_orchestrator',
      message: 'מה חשוב עכשיו?',
      channel: 'web',
    })

    expect(res.text).toContain(HEADER)
    const prompts = sendMessage.mock.calls.map((c) => String(c[0]))
    expect(prompts.some((p) => p.includes(RETRY_MARKER))).toBe(true)
    expect(sendMessage).toHaveBeenCalledTimes(3)
  })

  it('does not retry when the reply already carries the section', async () => {
    wireRun(ONE_INSIGHT, `מה חשוב עכשיו: ...\n${HEADER}: אור זלניקר שקט שבועיים`)

    await runGeminiAgentChat({ agentId: '01_Hugo_orchestrator', message: 'מה חשוב עכשיו?', channel: 'web' })

    const prompts = sendMessage.mock.calls.map((c) => String(c[0]))
    expect(prompts.some((p) => p.includes(RETRY_MARKER))).toBe(false)
  })

  it('does not retry when the harness returned nothing — absence is not a finding', async () => {
    wireRun([], 'מה חשוב עכשיו: פגישות ומשימות בפיגור')

    await runGeminiAgentChat({ agentId: '01_Hugo_orchestrator', message: 'מה חשוב עכשיו?', channel: 'web' })

    const prompts = sendMessage.mock.calls.map((c) => String(c[0]))
    expect(prompts.some((p) => p.includes(RETRY_MARKER))).toBe(false)
  })

  it('keeps the original answer when the retry comes back empty', async () => {
    wireRun(ONE_INSIGHT, 'התשובה המקורית', '')

    const res = await runGeminiAgentChat({
      agentId: '01_Hugo_orchestrator',
      message: 'מה חשוב עכשיו?',
      channel: 'web',
    })

    expect(res.text).toBe('התשובה המקורית')
  })

  it('leaves other agents alone', async () => {
    wireRun(ONE_INSIGHT, 'תדריך בוקר ללא קישורים')

    await runGeminiAgentChat({ agentId: '03_morning_briefing', message: 'תדריך', channel: 'cron' })

    const prompts = sendMessage.mock.calls.map((c) => String(c[0]))
    expect(prompts.some((p) => p.includes(RETRY_MARKER))).toBe(false)
  })
})
