import { isExcludedFromCalendarOptimizer } from '../lib/calendar-filters'
import { localDateRangeToUtc, localTodayIso } from '../lib/calendar-dates'
import {
  filterEventsByCalendarScope,
  getAgentCalendarIds,
} from './agent-calendar-scope'
import { fetchGoogleCalendarEvents, type GoogleCalendarEvent } from './google-calendar'

export type AgentCalendarContext = {
  today: string
  events: GoogleCalendarEvent[]
  errors: Array<{ email: string; message: string }>
}

export type AgentCalendarContextOptions = {
  /** When true (06_calendar_optimizer), drop all-day and timed events ≥ 8 hours. */
  forCalendarOptimizer?: boolean
}

export async function getAgentCalendarContext(
  options?: AgentCalendarContextOptions,
): Promise<AgentCalendarContext> {
  const today = localTodayIso()
  const { timeMin, timeMax } = localDateRangeToUtc(today, today)
  const scopeIds = await getAgentCalendarIds()
  const { events, errors } = await fetchGoogleCalendarEvents(timeMin, timeMax)
  let scoped = filterEventsByCalendarScope(events, scopeIds)
  if (options?.forCalendarOptimizer) {
    scoped = scoped.filter((e) => !isExcludedFromCalendarOptimizer(e))
  }
  scoped.sort((a, b) => a.start.localeCompare(b.start))
  return { today, events: scoped, errors }
}

function formatEventTime(ev: GoogleCalendarEvent): string {
  if (ev.isAllDay || !ev.start.includes('T')) return 'כל היום'
  try {
    return new Date(ev.start).toLocaleTimeString('he-IL', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: process.env.TIMEZONE || 'Asia/Jerusalem',
    })
  } catch {
    return ev.start.slice(11, 16)
  }
}

function eventLine(ev: GoogleCalendarEvent): string {
  const cal = ev.calendarName ? ` [${ev.calendarName}]` : ''
  return `- ${formatEventTime(ev)} ${ev.title}${cal}`
}

/** Hebrew prompt block with today's Google Calendar events (agent scope applied). */
export function formatAgentCalendarContextForPrompt(ctx: AgentCalendarContext): string {
  const hasErrors = ctx.errors.length > 0
  const lines: string[] = [
    `## Live Google Calendar (${ctx.today}) — Israel time`,
    '',
    '**Use this block as source of truth for today\'s schedule load, conflicts, and meeting hours.**',
    'Do NOT report 0 hours or an empty day when events are listed below.',
    'List EVERY event below in your day schedule — never omit any event. Personal time blocks (e.g. "אבא וצף" on the personal calendar) are real commitments: include them in the schedule and in the load. NOTE: attendee lists are often empty in this data even for real meetings, so judge conflicts by event title/type/calendar (1:1s, syncs, trainings) — do NOT assume "no attendees" means it is not a real meeting.',
  ]

  if (hasErrors) {
    lines.push(
      '',
      '> ⚠️ **אזהרה: נתונים חלקיים.** חלק מהיומנים לא נטענו (ראה "Calendar API errors" למטה).',
      '> ייתכן שחסרות פגישות בעלות שעה. **אל תצהיר שהיום פנוי או קליל**, ואל תסיק שאין קונפליקטים —',
      '> דווח למשתמש שחלק מהיומנים לא נטענו וכי הניתוח עלול להיות חלקי.',
    )
  }

  lines.push(
    '',
    '### Events today',
    ...ctx.events.map(eventLine),
    ...(ctx.events.length === 0
      ? [hasErrors
          ? '- אף אירוע לא הוחזר — אך היו שגיאות טעינה, כך שהיום כנראה אינו באמת ריק.'
          : '- None returned from Google Calendar API']
      : []),
  )

  const meetingHours = ctx.events
    .filter((e) => !e.isAllDay && e.start.includes('T'))
    .reduce((sum, e) => {
      const ms = new Date(e.end).getTime() - new Date(e.start).getTime()
      return sum + Math.max(0, ms) / 3_600_000
    }, 0)

  lines.push(
    '',
    `### Summary`,
    `- Event count: ${ctx.events.length}`,
    `- Timed meeting hours (approx): ${meetingHours.toFixed(1)}h`,
  )

  if (ctx.errors.length > 0) {
    lines.push(
      '',
      '### Calendar API errors',
      ...ctx.errors.map((e) => `- ⚠️ ${e.email}: ${e.message}`),
      '',
      'If errors are present and events are empty, tell the user to reconnect Google in Settings — do not invent a schedule.',
    )
  }

  return lines.join('\n')
}
