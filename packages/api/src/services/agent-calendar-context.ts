import { isExcludedFromTimedMeetingAlerts } from '../lib/calendar-filters'
import { formatLocalRange, localDateRangeToUtc, localTodayIso } from '../lib/calendar-dates'
import { groupEventsByTime, nowClockBlock } from '../lib/event-time-status'
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
    scoped = scoped.filter((e) => !isExcludedFromTimedMeetingAlerts(e))
  }
  scoped.sort((a, b) => a.start.localeCompare(b.start))
  return { today, events: scoped, errors }
}

function eventLine(ev: GoogleCalendarEvent): string {
  const cal = ev.calendarName ? ` [${ev.calendarName}]` : ''
  const when = ev.isAllDay ? 'כל היום' : formatLocalRange(ev.start, ev.end)
  const freeTag = ev.transparency === 'transparent' ? ' (מסומן כפנוי)' : ''
  return `- ${when} ${ev.title}${cal}${freeTag}`
}

function allDayLabel(ev: GoogleCalendarEvent): string {
  return ev.calendarName ? `${ev.title} [${ev.calendarName}]` : ev.title
}

/** Hebrew prompt block with today's Google Calendar events (agent scope applied). */
export function formatAgentCalendarContextForPrompt(ctx: AgentCalendarContext): string {
  const hasErrors = ctx.errors.length > 0
  const lines: string[] = [
    `## Live Google Calendar (${ctx.today}) — Israel time`,
    '',
    '**Use this block as source of truth for today\'s schedule load, conflicts, and meeting hours.**',
    'Do NOT report 0 hours or an empty day when events are listed below.',
    'MANDATORY day-schedule format. The timed events below are already split by the clock into "מתרחש כרגע", "עוד לפניך היום" and "כבר הסתיים היום". Reuse EXACTLY those groupings and names — do not invent your own two-way "עבר / לפניך" split, and never move an event between them. Answer "what is left today" from "מתרחש כרגע" + "עוד לפניך היום" first; "כבר הסתיים היום" goes last and only as context.',
    'The "רקע ליום" line is NOT part of the schedule: those are all-day markers (birthdays, WFH, trips) that hold for the whole day. They have NOT passed. Never list them as events, never put them under any heading meaning "passed"/"הסתיים"/"עבר", and never let them push the real meetings down. Mention them in at most one short line, or omit them when the user only asked what is left.',
    'List EVERY event below within its own section — never omit an event, and never relabel its section. Personal time blocks (e.g. "אבא וצף" on the personal calendar) are real commitments: include them in the schedule and in the load. NOTE: attendee lists are often empty in this data even for real meetings, so judge conflicts by event title/type/calendar (1:1s, syncs, trainings) — do NOT assume "no attendees" means it is not a real meeting.',
    'Events tagged "(מסומן כפנוי)" are marked Free in Google Calendar: mention them in the schedule for awareness, but do NOT count them toward meeting-load hours, do NOT flag them as double-bookings/conflicts, and do NOT use them to justify an overloaded day — treat them like a DNS/focus block.',
  ]

  if (hasErrors) {
    lines.push(
      '',
      '> ⚠️ **אזהרה: נתונים חלקיים.** חלק מהיומנים לא נטענו (ראה "Calendar API errors" למטה).',
      '> ייתכן שחסרות פגישות בעלות שעה. **אל תצהיר שהיום פנוי או קליל**, ואל תסיק שאין קונפליקטים —',
      '> דווח למשתמש שחלק מהיומנים לא נטענו וכי הניתוח עלול להיות חלקי.',
    )
  }

  if (ctx.events.length === 0) {
    lines.push(
      '',
      '### Events today',
      hasErrors
        ? '- אף אירוע לא הוחזר — אך היו שגיאות טעינה, כך שהיום כנראה אינו באמת ריק.'
        : '- None returned from Google Calendar API',
    )
  } else {
    // Split by the clock rather than handing over one flat list. Agents read the flat
    // version top-to-bottom and reported finished meetings as still ahead.
    const clock = nowClockBlock()
    const { inProgress, upcoming, allDay, past } = groupEventsByTime(ctx.events)
    lines.push('', `### Events today (now: ${clock.localTime} ${clock.timeZone})`)
    const section = (heading: string, events: GoogleCalendarEvent[], emptyNote: string) => {
      lines.push('', heading, ...(events.length > 0 ? events.map(eventLine) : [`- ${emptyNote}`]))
    }
    section('**מתרחש כרגע:**', inProgress, 'אין אירוע שמתרחש בדיוק עכשיו')
    section('**עוד לפניך היום:**', upcoming, 'אין עוד אירועים עם שעה להיום')
    section('**כבר הסתיים היום:**', past, 'שום אירוע לא הסתיים עדיין')
    // Deliberately one inline label instead of a bulleted section. As a list of events
    // the agent kept re-filing birthdays under its own "already passed" heading; as a
    // background note there is no event list to re-file.
    if (allDay.length > 0) {
      lines.push(
        '',
        `**רקע ליום (לא לוח זמנים, לא אירועים שעברו):** ${allDay.map(allDayLabel).join(' · ')}`,
      )
    }
  }

  const meetingHours = ctx.events
    .filter((e) => !e.isAllDay && e.start.includes('T') && e.transparency !== 'transparent')
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
