import { type NextRequest, NextResponse } from 'next/server'
import { appRouter, createContext } from '@ak-system/api'
import { getDb } from '@ak-system/database'
import { sendTelegramMessage } from '@/lib/telegram-bot'
import { saveChatMessage } from '@/lib/conversation-engine'
import type { MeetingCategory } from '@ak-system/database'

const CATEGORY_LABELS: Record<MeetingCategory, string> = {
  work: 'עבודה',
  family: 'משפחה',
  general: 'כללי',
}

/**
 * Cron: Daily meeting summary (run at 20:00 Israel time).
 * Sends a text summary of today's meetings grouped by category, with action items.
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

  const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID
  const hasTelegram = process.env.TELEGRAM_BOT_TOKEN && chatId

  try {
    const today = new Date().toISOString().split('T')[0]
    const db = getDb()
    const ctx = await createContext({ db })
    const caller = appRouter.createCaller(ctx)
    const [events, dbMeetings, allTasks] = await Promise.all([
      caller.calendar.events({ startDate: today, endDate: today }),
      caller.meetings.list(),
      caller.tasks.list(),
    ])

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

    type Group = { category: MeetingCategory; items: string[] }
    const groups: Record<MeetingCategory, Group> = {
      work: { category: 'work', items: [] },
      family: { category: 'family', items: [] },
      general: { category: 'general', items: [] },
    }

    for (const e of events) {
      const meeting = meetingByCalId.get(e.id) ?? meetingByTitleDate.get(e.title + today)
      const category: MeetingCategory = (meeting?.category as MeetingCategory) ?? 'general'
      const time = e.start.includes('T') ? e.start.slice(11, 16) : 'כל היום'
      const tasks = meeting ? openTasksByMeeting.get(meeting.id) ?? [] : []
      const startAt = e.start
      const endAt = e.end ?? new Date(new Date(e.start).getTime() + 3600000).toISOString()
      const avgHr = await caller.health.averageHeartRate({ startAt, endAt })
      let line = `• ${time} – ${e.title}`
      if (avgHr != null) line += ` (דופק ממוצע: ${avgHr})`
      if (meeting?.notes) line += `\n  הערות: ${meeting.notes}`
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
    const text = (lines.length > 2 ? lines.join('\n') : lines[0] + '\nאין אירועים היום.').slice(0, 4000)

    await saveChatMessage('assistant', text, 'cron')
    if (hasTelegram) {
      await sendTelegramMessage(Number(chatId!), text)
    }
    return NextResponse.json({ ok: true, eventsCount: events.length, sent: !!hasTelegram })
  } catch (err) {
    console.error('[cron/daily-meeting-summary]', err)
    const msg = err instanceof Error ? err.message : 'Daily summary failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
