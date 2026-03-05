import { type NextRequest, NextResponse } from 'next/server'
import { appRouter, createContext } from '@ak-system/api'
import { getDb } from '@ak-system/database'
import { sendTelegramMessage } from '@/lib/telegram-bot'

const WINDOW_START_MIN = 14
const WINDOW_END_MIN = 16

/**
 * Cron: Pre-meeting briefing (run every 5 min). Finds meetings starting in ~15 min,
 * sends a short briefing per meeting to Telegram.
 * Optional: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return runPreMeetingBriefing(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return runPreMeetingBriefing(request)
}

async function runPreMeetingBriefing(request: NextRequest): Promise<NextResponse> {
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
    const now = new Date()
    const in15Min = new Date(now.getTime() + 15 * 60 * 1000)
    const windowStart = new Date(now.getTime() + WINDOW_START_MIN * 60 * 1000)
    const windowEnd = new Date(now.getTime() + WINDOW_END_MIN * 60 * 1000)

    const db = getDb()
    const ctx = await createContext({ db })
    const caller = appRouter.createCaller(ctx)
    const [upcoming, allMeetings, allPeople, allTasks] = await Promise.all([
      caller.calendar.upcoming({ limit: 10 }),
      caller.meetings.list(),
      caller.people.list(),
      caller.tasks.list(),
    ])

    const toBrief: typeof upcoming = []
    for (const e of upcoming) {
      const start = new Date(e.start).getTime()
      if (start >= windowStart.getTime() && start <= windowEnd.getTime()) toBrief.push(e)
    }

    if (toBrief.length === 0) {
      return NextResponse.json({ ok: true, briefed: 0, message: 'No meetings in 15 min window' })
    }

    let sent = 0
    for (const calEvent of toBrief) {
      const linkedMeeting = allMeetings.find(
        (m) =>
          m.calendarEventId === calEvent.id ||
          (m.title === calEvent.title && m.date === calEvent.start.split('T')[0])
      )
      let attendees: typeof allPeople = []
      let openTasks: typeof allTasks = []
      let projectName: string | null = null
      if (linkedMeeting) {
        attendees = allPeople.filter((p) => linkedMeeting.peopleIds.includes(p.id))
        openTasks = allTasks.filter((t) => t.meetingId === linkedMeeting.id && !t.done)
        if (linkedMeeting.projectId) {
          const proj = await caller.projects.getById({ id: linkedMeeting.projectId })
          projectName = proj?.name ?? null
        }
      }
      const time = calEvent.start.includes('T') ? calEvent.start.slice(11, 16) : 'כל היום'
      const lines: string[] = [
        '⏰ הכנה לפגישה – ' + calEvent.title,
        `שעה: ${time}`,
        calEvent.location ? `מיקום: ${calEvent.location}` : '',
        projectName ? `פרויקט: ${projectName}` : '',
        attendees.length > 0 ? `משתתפים: ${attendees.map((p) => p.name).join(', ')}` : '',
        linkedMeeting?.notes ? `הערות: ${linkedMeeting.notes}` : '',
        openTasks.length > 0 ? `משימות פתוחות: ${openTasks.map((t) => t.title).join(', ')}` : '',
      ].filter(Boolean)
      const text = lines.join('\n').slice(0, 4000)
      if (hasTelegram) {
        await sendTelegramMessage(Number(chatId!), text)
        sent++
      }
    }
    return NextResponse.json({ ok: true, briefed: sent, total: toBrief.length })
  } catch (err) {
    console.error('[cron/pre-meeting-briefing]', err)
    const msg = err instanceof Error ? err.message : 'Pre-meeting briefing failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
