import { type NextRequest, NextResponse } from 'next/server'
import {
  formatSystemMeetingSummary,
  formatLocalRange,
  getSchedulablePreference,
  localTodayIso,
  markNotificationSent,
  wasNotificationSentInSlot,
} from '@ak-system/api'
import { createServiceCaller } from '@/lib/api-caller'
import { pushAssistantMessage } from '@/lib/push-notifications'
import { runEventAgentIfRouted } from '@/lib/notification-event-runner'
import type { MeetingCategory } from '@ak-system/database'

const TIMEZONE = process.env.TIMEZONE || 'Asia/Jerusalem'
/** Cap each note body in evening context / template (full body stays in DB for tools). */
const NOTE_BODY_CONTEXT_CAP = 3000

function currentSlot(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
}

const CATEGORY_LABELS: Record<MeetingCategory, string> = {
  work: 'עבודה',
  family: 'משפחה',
  general: 'כללי',
}

function formatTodayNotesContext(
  notes: Array<{
    title: string
    date: string | null
    bodyText: string | null
    snippet: string | null
    meetingTitle: string | null
  }>,
): string {
  const header = [
    '## Notion AI Meeting Notes (fallback: only meetings the system has no summary of)',
    'Locally synced Notion AI Meeting Notes for meetings missing from the list above. If a note has no body, write לא נמצא בנתונים for that meeting — do not invent.',
    '',
  ]
  if (notes.length === 0) {
    return [...header, '_No AI meeting notes for today in the local DB._'].join('\n')
  }
  const blocks = notes.map((n) => {
    const label = n.meetingTitle ? `${n.title} (פגישה: ${n.meetingTitle})` : n.title
    const body = (n.bodyText?.trim() || n.snippet?.trim() || '').slice(0, NOTE_BODY_CONTEXT_CAP)
    return `### ${label}\n${body || 'לא נמצא בנתונים'}`
  })
  return [...header, ...blocks].join('\n\n')
}

/**
 * Cron: Daily meeting summary (run at 20:00 Israel time).
 * Syncs recent Notion meeting-note bodies, then sends an end-of-day summary.
 * Optional: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return runDailySummary(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return runDailySummary(request)
}

async function runDailySummary(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    const token = auth?.replace(/^Bearer\s+/i, '')
    if (token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const pref = await getSchedulablePreference('daily_meeting_summary')
  if (!pref.enabled) {
    return NextResponse.json({ ok: true, skipped: 'disabled' })
  }
  if (pref.scheduleTimes.length > 0) {
    const slot = currentSlot()
    if (!pref.scheduleTimes.includes(slot)) {
      return NextResponse.json({ ok: true, skipped: 'not-scheduled', slot })
    }
    if (wasNotificationSentInSlot(pref.lastSentAt, slot, TIMEZONE)) {
      return NextResponse.json({ ok: true, skipped: 'already-sent', slot })
    }
  }

  try {
    const today = localTodayIso()
    const caller = await createServiceCaller()

    // Fresh pull so afternoon recordings are available before the evening agent.
    await caller.notionGraph.sync({ windowDays: 7, dryRun: false }).catch((err) => {
      console.warn(
        '[cron/daily-meeting-summary] notionGraph.sync failed:',
        err instanceof Error ? err.message : err,
      )
    })

    // The system's own analyses of today's recordings are the primary record of the day.
    // A Notion note is used only for a meeting that has no analysis here.
    const [todaySummaries, allTodayNotes] = await Promise.all([
      caller.insights.meetingSummaries({ date: today, limit: 60 }),
      caller.insights.meetingNotes({ date: today }),
    ])
    const summarisedMeetingIds = new Set(todaySummaries.summaries.map((s) => s.meetingId))
    const fallbackNotes = allTodayNotes.notes.filter((n) => !n.meetingId || !summarisedMeetingIds.has(n.meetingId))
    const todayNotes = { notes: fallbackNotes, count: fallbackNotes.length }
    const notesContext = [
      "## Today's meeting summaries from the system (PRIMARY source for what happened today)",
      'These are the system\'s own analyses of the meetings recorded and held today. Build the evening wrap-up from them. Do not look for these meetings in Notion.',
      '',
      todaySummaries.summaries.length > 0
        ? todaySummaries.summaries.map(formatSystemMeetingSummary).join('\n\n')
        : '_No analysed meetings in the system for today._',
      '',
      formatTodayNotesContext(fallbackNotes),
    ].join('\n')

    const routed = await runEventAgentIfRouted('daily_meeting_summary', {
      dedupeSlot: currentSlot(),
      timezone: TIMEZONE,
      context: notesContext,
    })
    if (routed.status !== 'not_routed') {
      await markNotificationSent('daily_meeting_summary')
      return NextResponse.json({
        ok: true,
        mode: routed.status === 'ran' ? 'agent' : 'agent-deduped',
        notesCount: todayNotes.count,
      })
    }

    const [calResult, dbMeetings, allTasks] = await Promise.all([
      caller.calendar.events({ startDate: today, endDate: today }),
      caller.meetings.list(),
      caller.tasks.list(),
    ])
    const events = calResult.events

    const todayMeetings = dbMeetings.filter((m) => m.date === today)
    const meetingByCalId = new Map<string, (typeof todayMeetings)[number]>()
    const meetingByTitleDate = new Map<string, (typeof todayMeetings)[number]>()
    for (const m of todayMeetings) {
      if (m.calendarEventId) meetingByCalId.set(m.calendarEventId, m)
      meetingByTitleDate.set(m.title + m.date, m)
    }
    const openTasksByMeeting = new Map<string, typeof allTasks>()
    for (const t of allTasks.filter((x) => !x.done && x.meetingId)) {
      const arr = openTasksByMeeting.get(t.meetingId!) ?? []
      arr.push(t)
      openTasksByMeeting.set(t.meetingId!, arr)
    }

    const summaryByMeetingId = new Map(todaySummaries.summaries.map((s) => [s.meetingId, s]))
    const notesByMeetingId = new Map<string, (typeof todayNotes.notes)[number][]>()
    const orphanNotes: typeof todayNotes.notes = []
    for (const n of todayNotes.notes) {
      if (n.meetingId) {
        const arr = notesByMeetingId.get(n.meetingId) ?? []
        arr.push(n)
        notesByMeetingId.set(n.meetingId, arr)
      } else {
        orphanNotes.push(n)
      }
    }

    type Group = { category: MeetingCategory; items: string[] }
    const groups: Record<MeetingCategory, Group> = {
      work: { category: 'work', items: [] },
      family: { category: 'family', items: [] },
      general: { category: 'general', items: [] },
    }

    for (const e of events) {
      const meeting = meetingByCalId.get(e.id) ?? meetingByTitleDate.get(e.title + today)
      const category: MeetingCategory = (meeting?.category as MeetingCategory) ?? 'general'
      const time = formatLocalRange(e.start, e.end)
      const tasks = meeting ? openTasksByMeeting.get(meeting.id) ?? [] : []
      const startAt = e.start
      const endAt = e.end ?? new Date(new Date(e.start).getTime() + 3600000).toISOString()
      const avgHr = await caller.health.averageHeartRate({ startAt, endAt })
      let line = `• ${time} – ${e.title}`
      if (avgHr != null) line += ` (דופק ממוצע: ${avgHr})`
      if (meeting?.notes) line += `\n  הערות: ${meeting.notes}`
      const summary = meeting ? summaryByMeetingId.get(meeting.id) : undefined
      if (summary) {
        const gist = [summary.topic, summary.keyInsight].filter(Boolean).join(' — ').slice(0, 600)
        if (gist) line += `\n  סיכום: ${gist}`
        const actions = summary.actionItems.slice(0, 5).map((a) => a.content).join('; ')
        if (actions) line += `\n  עלו: ${actions}`
      }
      const linkedNotes = meeting ? notesByMeetingId.get(meeting.id) ?? [] : []
      for (const n of linkedNotes) {
        const body = (n.bodyText?.trim() || n.snippet?.trim() || '').slice(0, 800)
        if (body) line += `\n  סיכום AI (${n.title}): ${body}`
      }
      if (tasks.length > 0) line += `\n  משימות: ${tasks.map((t) => t.title).join(', ')}`
      groups[category].items.push(line)
    }

    const lines: string[] = ['📊 סיכום יומי – ' + today, '']
    for (const cat of ['work', 'family', 'general'] as const) {
      const g = groups[cat]
      if (g.items.length === 0) continue
      lines.push(CATEGORY_LABELS[cat] + ':')
      lines.push(...g.items)
      lines.push('')
    }
    if (orphanNotes.length > 0) {
      lines.push('סיכומי AI מהיום (ללא קישור לפגישה):')
      for (const n of orphanNotes) {
        const body = (n.bodyText?.trim() || n.snippet?.trim() || 'לא נמצא בנתונים').slice(0, 800)
        lines.push(`• ${n.title}: ${body}`)
      }
      lines.push('')
    }
    const text = (lines.length > 2 ? lines.join('\n') : lines[0] + '\nאין אירועים היום.').slice(0, 4000)

    const pushed = await pushAssistantMessage(text, 'cron', { typeId: 'daily_meeting_summary' })
    await markNotificationSent('daily_meeting_summary')
    return NextResponse.json({
      ok: true,
      eventsCount: events.length,
      notesCount: todayNotes.count,
      sent: pushed.telegram || pushed.whatsapp,
      telegram: pushed.telegram,
      whatsapp: pushed.whatsapp,
    })
  } catch (err) {
    console.error('[cron/daily-meeting-summary]', err)
    const msg = err instanceof Error ? err.message : 'Daily summary failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
