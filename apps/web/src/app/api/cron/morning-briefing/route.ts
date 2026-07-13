import { type NextRequest, NextResponse } from 'next/server'
import {
  filterEventsByCalendarScope,
  getAgentCalendarIds,
  getSchedulablePreference,
  localTodayIso,
  markNotificationSent,
  wasNotificationSentInSlot,
} from '@ak-system/api'
import { createServiceCaller } from '@/lib/api-caller'
import { pushAssistantMessage } from '@/lib/push-notifications'
import { runEventAgentIfRouted } from '@/lib/notification-event-runner'

const TIMEZONE = process.env.TIMEZONE || 'Asia/Jerusalem'

function currentSlot(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
}

/**
 * Cron: Morning calendar briefing (run at 07:00 Israel time).
 * Sends today's schedule (events + due tasks) to Telegram/WhatsApp when configured.
 * Optional: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return runMorningBriefing(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return runMorningBriefing(request)
}

async function runMorningBriefing(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    const token = auth?.replace(/^Bearer\s+/i, '')
    if (token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const pref = await getSchedulablePreference('morning_briefing')
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
    const routed = await runEventAgentIfRouted('morning_briefing')
    if (routed !== null) {
      await markNotificationSent('morning_briefing')
      return NextResponse.json({ ok: true, mode: 'agent' })
    }

    const caller = await createServiceCaller()
    const today = localTodayIso()
    const scopeIds = await getAgentCalendarIds()
    const [calResult, allTasks] = await Promise.all([
      caller.calendar.events({ startDate: today, endDate: today }),
      caller.tasks.list(),
    ])
    const scopedEvents = filterEventsByCalendarScope(calResult.events, scopeIds)
    const dueTasks = allTasks.filter((t) => !t.done && t.dueDate === today)

    const lines: string[] = ['📅 סיכום הבוקר – ' + today]
    if (scopedEvents.length === 0 && dueTasks.length === 0) {
      lines.push('אין אירועים או משימות מועדות להיום.')
    } else {
      if (scopedEvents.length > 0) {
        lines.push('', 'אירועים:')
        for (const e of scopedEvents) {
          const time = e.start.includes('T') ? e.start.slice(11, 16) : 'כל היום'
          lines.push(`• ${time} – ${e.title}`)
        }
      }
      if (dueTasks.length > 0) {
        lines.push('', 'משימות להיום:')
        for (const t of dueTasks) {
          lines.push(`• [${t.priority}] ${t.title}`)
        }
      }
    }
    const text = lines.join('\n').slice(0, 4000)

    const pushed = await pushAssistantMessage(text, 'cron', { typeId: 'morning_briefing' })
    await markNotificationSent('morning_briefing')
    return NextResponse.json({
      ok: true,
      events: scopedEvents.length,
      dueTasks: dueTasks.length,
      sent: pushed.telegram || pushed.whatsapp,
      telegram: pushed.telegram,
      whatsapp: pushed.whatsapp,
    })
  } catch (err) {
    console.error('[cron/morning-briefing]', err)
    const msg = err instanceof Error ? err.message : 'Morning briefing failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
