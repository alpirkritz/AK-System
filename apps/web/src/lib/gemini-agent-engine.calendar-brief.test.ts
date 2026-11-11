import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { harness } = vi.hoisted(() => ({
  harness: {
    notion: false,
    card: 'agent card with old table instructions',
  },
}))

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
  getAgentInstructions: () => harness.card,
  getAgentWorkflowContent: () => 'workflow table step',
  agentNeedsCalendarContext: () => false,
  agentNeedsNotionContext: () => harness.notion,
  agentCardRequestsDueTasks: (card: string) =>
    /(?:^|\n)\s*(?:משימות להיום|include due tasks)\s*(?=$|\n)/i.test(card),
  getAbcRootPath: () => '/tmp/abc',
  HUGO_AGENT_ID: '01_Hugo_orchestrator',
}))

vi.mock('./agent-memory', () => ({ getMemoryPromptBlock: vi.fn().mockResolvedValue('') }))
vi.mock('./notion', () => ({
  formatNotionContextForPrompt: (_ctx: unknown, options?: { omitTasks?: boolean }) =>
    options?.omitTasks
      ? '### Meetings — Today\n- Standup'
      : '### Tasks — Due Today\n- [high] לסגור מע״מ\n### Calendar Review\nold brief לסגור מע״מ',
  getNotionContext: vi.fn().mockResolvedValue({ tasks: { today: [{ title: 'לסגור מע״מ' }] } }),
}))
vi.mock('@ak-system/api', () => ({
  getAgentCalendarScopePromptBlock: vi.fn().mockResolvedValue(''),
  getDefaultTimezone: () => 'Asia/Jerusalem',
  localTodayIso: () => '2026-07-22',
  getAgentCalendarContext: vi.fn().mockResolvedValue({}),
  formatAgentCalendarContextForPrompt: () => '',
  ownerIdentityPrompt: () => 'The user is Alpir Kritzler (אלפיר קריצלר).',
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
  harness.notion = false
  harness.card = 'agent card with old table instructions'
})

describe('calendar optimizer Notion-parity brief', () => {
  it('override follows the agent card and bans unsolicited task lists', () => {
    const override = getCalendarOptimizerBriefOverride()
    expect(override).toContain('NEVER use Markdown tables')
    expect(override).toContain('PRIMARY DATA SOURCE: ARO-connected calendars')
    expect(override).toContain('source of truth')
    expect(override).toContain('משימות להיום')
    expect(override).toContain('include due tasks')
    expect(override).toContain('Do not list open tasks')
    expect(override).toContain('מעתה אתעלם')
    expect(override).not.toContain('overrides conflicting card')
    expect(override).not.toContain('Reminders / תזכורות')
  })

  it('injects the card and the constraints into 06 on every channel', async () => {
    for (const channel of ['whatsapp', 'telegram', 'web'] as const) {
      const prompt = await buildAgentSystemInstruction('06_calendar_optimizer', channel)
      expect(prompt).toContain('Calendar Optimizer — delivery constraints')
      expect(prompt).toContain('NEVER use Markdown tables')
      expect(prompt).toContain('PRIMARY DATA SOURCE: ARO-connected calendars')
      expect(prompt).toContain('agent card with old table instructions')
      expect(prompt).toContain('source of truth')
    }
  })

  it('omits due-today Notion tasks unless the card opts in', async () => {
    harness.notion = true
    const hidden = await buildAgentSystemInstruction('06_calendar_optimizer', 'web')
    expect(hidden).not.toContain('Tasks — Due Today')
    expect(hidden).not.toContain('לסגור מע״מ')
    expect(hidden).toContain('### Meetings — Today')

    harness.card = 'include due tasks'
    const shown = await buildAgentSystemInstruction('06_calendar_optimizer', 'web')
    expect(shown).toContain('Tasks — Due Today')
    expect(shown).toContain('לסגור מע״מ')
    expect(shown).toContain('include due tasks')
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

  it('makes the harness a mandatory part of the multi-source scan, cited not restated', async () => {
    const prompt = await buildAgentSystemInstruction('01_Hugo_orchestrator', 'whatsapp')
    expect(prompt).toContain('One of those MUST be get_harness_insights')
    expect(prompt).toContain('`basedOn`')
    expect(prompt).toContain('absence is not a finding')
  })

  it('does not give the harness to a single-domain specialist', async () => {
    const prompt = await buildAgentSystemInstruction('06_calendar_optimizer', 'web')
    expect(prompt).not.toContain('get_harness_insights')
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
    expect(override).toContain('Shared attendees are not enough')
    expect(override).toContain('אין סיכום מהפגישה הקודמת')
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
