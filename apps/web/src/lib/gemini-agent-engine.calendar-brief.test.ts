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
  getMeetingPrepNotionParityOverride,
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

  it('tells CoS to keep אופטי facts but require judgment (no verbatim-only pass-through)', async () => {
    const prompt = await buildAgentSystemInstruction('01_Hugo_orchestrator', 'whatsapp')
    expect(prompt).toContain('Keep specialist facts; CoS judgment is mandatory')
    expect(prompt).toContain('Pass-through without judgment is forbidden')
    expect(prompt).not.toContain('almost verbatim')
    expect(prompt).not.toContain('Calendar Optimizer — Notion-parity brief (MANDATORY')
  })
})

describe('Chief of Staff primary interface', () => {
  it('injects judgment-first CoS operating contract for agent 01', async () => {
    const prompt = await buildAgentSystemInstruction('01_Hugo_orchestrator', 'whatsapp')
    expect(prompt).toContain('## Chief of Staff — primary interface')
    expect(prompt).toContain('### Judgment contract (mandatory)')
    expect(prompt).toContain('### Date grounding (CRITICAL — מחר / tomorrow)')
    expect(prompt).toContain('get_day_schedule')
    expect(prompt).toContain('range "tomorrow"')
    expect(prompt).toContain('Notion depth pass')
    expect(prompt).toContain('get_notion_meeting_notes')
    expect(prompt).toContain('prepDate')
    expect(prompt).toContain('Con Meetings')
    expect(prompt).toContain('Con Action items')
    expect(prompt).toContain('DAZ Tasks')
    expect(prompt).toContain('get_notion_people')
    expect(prompt).toContain('מה חשוב עכשיו')
    expect(prompt).toContain('Do NOT default-delegate to 06_calendar_optimizer')
    expect(prompt).toContain('get_cashflow_insights')
    expect(prompt).not.toContain('almost verbatim')
    expect(prompt).not.toContain('## Hugo orchestrator — primary interface')
  })
})

describe('meeting prep related tasks only', () => {
  it('override forbids full backlog dump', () => {
    const override = getMeetingPrepRelatedTasksOverride()
    expect(override).toContain('NEVER dump')
    expect(override).toContain('ONLY open tasks that clearly relate')
    expect(override).toContain('Con Action items')
    expect(override).toContain('DAZ Tasks')
  })

  it('injects related-tasks override into 04 system instruction', async () => {
    const prompt = await buildAgentSystemInstruction('04_meeting_prep_herald', 'whatsapp')
    expect(prompt).toContain('Meeting Prep — related tasks only')
  })
})

describe('meeting prep Notion-parity (WhatsApp/cron)', () => {
  it('override bans invite paste and requires talk-about sections', () => {
    const override = getMeetingPrepNotionParityOverride()
    expect(override).toContain('NEVER paste')
    expect(override).toContain('What you should talk about')
    expect(override).toContain('recommended stance')
    expect(override).toContain('get_notion_tasks')
    expect(override).toContain('על מה לדבר')
    expect(override).toContain('עמדה מומלצת')
  })

  it('injects Notion-parity override on whatsapp/cron/telegram only', async () => {
    for (const channel of ['whatsapp', 'cron', 'telegram'] as const) {
      const prompt = await buildAgentSystemInstruction('04_meeting_prep_herald', channel)
      expect(prompt).toContain('Meeting Prep — Notion-parity brief')
      expect(prompt).toContain('NEVER paste')
    }
    const web = await buildAgentSystemInstruction('04_meeting_prep_herald', 'web')
    expect(web).not.toContain('Meeting Prep — Notion-parity brief')
  })
})
