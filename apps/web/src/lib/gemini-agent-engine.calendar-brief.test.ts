import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  getAgentInstructions: () => 'agent card with old table instructions',
  getAgentWorkflowContent: () => 'workflow table step',
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
  localTodayIso: () => '2026-07-22',
  getAgentCalendarContext: vi.fn().mockResolvedValue({}),
  formatAgentCalendarContextForPrompt: () => '',
}))

import {
  buildAgentSystemInstruction,
  getCalendarOptimizerBriefOverride,
  getMeetingPrepRelatedTasksOverride,
} from './gemini-agent-engine'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key'
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('calendar optimizer Notion-parity brief', () => {
  it('override forbids Markdown tables and requires rich sections', () => {
    const override = getCalendarOptimizerBriefOverride()
    expect(override).toContain('NEVER use Markdown tables')
    expect(override).toContain('PRIMARY DATA SOURCE: ARO-connected calendars')
    expect(override).toContain('Notion is OPTIONAL')
    expect(override).toContain('Quick Summary')
    expect(override).toContain("Today's Meetings")
    expect(override).toContain('Conflicts & Overlaps')
    expect(override).toContain('Load Analysis')
    expect(override).toContain('Focus Time Opportunities')
    expect(override).toContain('סיכום מהיר')
    expect(override).toContain('הפגישות להיום')
    expect(override).toContain('מעתה אתעלם')
  })

  it('injects override into 06 system instruction on every channel', async () => {
    for (const channel of ['whatsapp', 'telegram', 'web'] as const) {
      const prompt = await buildAgentSystemInstruction('06_calendar_optimizer', channel)
      expect(prompt).toContain('Calendar Optimizer — Notion-parity brief')
      expect(prompt).toContain('NEVER use Markdown tables')
      expect(prompt).toContain('Quick Summary')
      expect(prompt).toContain('PRIMARY DATA SOURCE: ARO-connected calendars')
    }
  })

  it('tells Hugo to pass calendar brief through without re-wrapping', async () => {
    const prompt = await buildAgentSystemInstruction('01_Hugo_orchestrator', 'whatsapp')
    expect(prompt).toContain('pass the Notion-parity brief through almost verbatim')
    expect(prompt).not.toContain('Calendar Optimizer — Notion-parity brief (MANDATORY')
  })
})

describe('meeting prep related tasks only', () => {
  it('override forbids full backlog dump', () => {
    const override = getMeetingPrepRelatedTasksOverride()
    expect(override).toContain('לא נמצאו משימות קשורות לפגישה זו')
    expect(override).toContain('NEVER dump')
    expect(override).toContain('ONLY open tasks that clearly relate')
  })

  it('injects override into 04 system instruction', async () => {
    const prompt = await buildAgentSystemInstruction('04_meeting_prep_herald', 'whatsapp')
    expect(prompt).toContain('Meeting Prep — related tasks only')
    expect(prompt).toContain('לא נמצאו משימות קשורות לפגישה זו')
  })
})
