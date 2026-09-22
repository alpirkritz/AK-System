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
  getMorningBriefOverride,
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

describe('morning brief day map', () => {
  it('override defines day-map sections with line caps', () => {
    const override = getMorningBriefOverride()
    expect(override).toContain('day map')
    expect(override).toContain('NEVER use Markdown tables')
    expect(override).toContain('שורה תחתונה')
    expect(override).toContain('הפגישות')
    expect(override).toContain('לעשות לפני')
    expect(override).toContain('אתמול')
    expect(override).toContain('at most 3 actions')
    expect(override).toContain('at most 2 lines')
    expect(override).toContain('the meeting that needs you sharpest')
  })

  it('injects day-map override into 03 system instruction on all channels', async () => {
    for (const channel of ['whatsapp', 'telegram', 'web', 'cron'] as const) {
      const prompt = await buildAgentSystemInstruction('03_morning_briefing', channel)
      expect(prompt).toContain('Morning Brief — day map')
      expect(prompt).toContain('שורה תחתונה')
      expect(prompt).toContain('הפגישות')
      expect(prompt).toContain('at most 3 actions')
    }
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

describe('meeting prep walk-in card (all channels)', () => {
  it('override bans invite paste and requires talk points with substance', () => {
    const override = getMeetingPrepNotionParityOverride()
    expect(override).toContain('NEVER paste')
    expect(override).toContain('walk-in card')
    expect(override).toContain('at most 3')
    expect(override).toContain('get_notion_tasks')
    expect(override).toContain('על מה לדבר')
    expect(override).toContain('שורה תחתונה')
    expect(override).toContain('the outcome of this meeting')
    expect(override).toContain('פתוח')
    expect(override).toContain('מאז הפעם הקודמת')
    // No longer has separate stance section
    expect(override).not.toContain('recommended stance')
    expect(override).not.toContain('עמדה מומלצת')
  })

  it('injects walk-in card override on ALL channels including web', async () => {
    for (const channel of ['whatsapp', 'cron', 'telegram', 'web'] as const) {
      const prompt = await buildAgentSystemInstruction('04_meeting_prep_herald', channel)
      expect(prompt).toContain('Meeting Prep — walk-in card')
      expect(prompt).toContain('NEVER paste')
      expect(prompt).toContain('at most 3')
      expect(prompt).toContain('שורה תחתונה')
    }
  })
})
