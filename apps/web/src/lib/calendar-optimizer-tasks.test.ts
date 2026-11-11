import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { agentCardRequestsDueTasks } from './abc-agents'

const { harness } = vi.hoisted(() => ({
  harness: { card: 'Do not list open tasks or tasks due today.' },
}))

vi.mock('./abc-agents', async () => {
  const actual = await vi.importActual<typeof import('./abc-agents')>('./abc-agents')
  return {
    ...actual,
    getAgentInstructions: () => harness.card,
    getRunnableAgentIds: () => ['01_Hugo_orchestrator', '06_calendar_optimizer'],
  }
})
vi.mock('./api-caller', () => ({ createServiceCaller: vi.fn() }))
vi.mock('./notion', () => ({
  getNotionEntries: vi.fn(),
  getNotionMeetings: vi.fn(),
  getNotionStatus: vi.fn(),
  getNotionTasks: vi.fn(),
  searchNotion: vi.fn(),
}))
vi.mock('@ak-system/api', async () => ({
  // The time-status helpers come from the real module — the schedule buckets are the
  // behaviour under test here, so stubbing them would test the stub.
  ...(await vi.importActual<object>('../../../../packages/api/src/lib/event-time-status')),
  getDefaultTimezone: () => 'Asia/Jerusalem',
  localTodayIso: () => '2026-09-23',
  localTomorrowIso: () => '2026-09-24',
  resolveLocalDayArg: (d: string) => (d === 'today' ? '2026-09-23' : d),
  filterEventsByCalendarScope: (events: unknown[]) => events,
  getAgentCalendarIds: vi.fn().mockResolvedValue(null),
}))
vi.mock('@ak-system/database', () => ({
  chatMessages: {},
  getDb: vi.fn(),
}))
vi.mock('./agent-feedback-log', () => ({ appendAgentFeedback: vi.fn() }))

import { executeTool, getToolDeclarations } from './conversation-engine'

type AnyCaller = Parameters<typeof executeTool>[2]

const caller = {
  calendar: {
    events: vi.fn().mockResolvedValue({
      events: [{ id: 'e1', title: 'Standup', start: '2026-09-23T09:00:00' }],
      googleErrors: [],
    }),
    upcoming: vi.fn().mockResolvedValue({
      events: [{ id: 'e1', title: 'Standup', start: '2026-09-23T09:00:00' }],
      googleErrors: [],
    }),
  },
  tasks: {
    list: vi.fn().mockResolvedValue([
      { title: 'לסגור מע״מ', done: false, dueDate: '2026-09-23', meetingId: 'm1', priority: 'high' },
    ]),
  },
  meetings: { list: vi.fn().mockResolvedValue([]) },
  people: { list: vi.fn().mockResolvedValue([]) },
} as unknown as AnyCaller

describe('agentCardRequestsDueTasks', () => {
  it('accepts only a dedicated opt-in line', () => {
    expect(agentCardRequestsDueTasks('Do not list tasks due today.')).toBe(false)
    expect(agentCardRequestsDueTasks('focus time for tasks')).toBe(false)
    expect(agentCardRequestsDueTasks('משימות להיום')).toBe(true)
    expect(agentCardRequestsDueTasks('- include due tasks')).toBe(true)
  })

  it('the saved יועץ יומן card does not opt in', () => {
    const card = readFileSync(
      path.resolve(__dirname, '../../../../A_Agents/06_calendar_optimizer.md'),
      'utf8',
    )
    expect(agentCardRequestsDueTasks(card)).toBe(false)
    expect(card).not.toContain('Reminders / תזכורות')
  })
})

describe('calendar optimizer task tools', () => {
  beforeEach(() => {
    harness.card = 'Do not list open tasks or tasks due today.'
  })

  it('hides task tools and dueTasks for יועץ יומן, and keeps them for everyone else', async () => {
    const all = getToolDeclarations().map((d) => d.name)
    expect(all).toContain('get_open_tasks')
    expect(all).toContain('get_notion_tasks')
    expect(getToolDeclarations().find((d) => d.name === 'get_today_schedule')?.description).toContain(
      'tasks due today',
    )

    const optimizer = getToolDeclarations('06_calendar_optimizer').map((d) => d.name)
    expect(optimizer).not.toContain('get_open_tasks')
    expect(optimizer).not.toContain('get_overdue_tasks')
    expect(optimizer).not.toContain('get_notion_tasks')
    expect(
      getToolDeclarations('06_calendar_optimizer').find((d) => d.name === 'get_today_schedule')
        ?.description,
    ).not.toContain('tasks due today')

    const hidden = (await executeTool('get_today_schedule', {}, caller, {
      agentId: '06_calendar_optimizer',
    })) as { summary: { past: number }; past: unknown[]; dueTasks?: unknown }
    expect(hidden.summary.past).toBe(1)
    expect(hidden).not.toHaveProperty('dueTasks')

    const shown = (await executeTool('get_today_schedule', {}, caller, {
      agentId: '01_Hugo_orchestrator',
    })) as { dueTasks: Array<{ title: string }> }
    expect(shown.dueTasks.map((t) => t.title)).toEqual(['לסגור מע״מ'])

    const brief = (await executeTool('get_next_meeting_brief', {}, caller, {
      agentId: '06_calendar_optimizer',
    })) as { openTasks?: unknown }
    expect(brief).not.toHaveProperty('openTasks')
  })

  it('returns task tools again when the card opts in', () => {
    harness.card = 'משימות להיום'
    expect(getToolDeclarations('06_calendar_optimizer').map((d) => d.name)).toContain('get_open_tasks')
  })
})
