import { type NextRequest, NextResponse } from 'next/server'
import { getNotificationRouting, localTodayIso, resolveNotificationChannels } from '@ak-system/api'
import { createServiceCaller } from '@/lib/api-caller'
import { pushAssistantMessage } from '@/lib/push-notifications'
import { runEventAgentIfRouted } from '@/lib/notification-event-runner'
import {
  buildPreMeetingAgentContext,
  findPriorMeetingNotes,
  formatPreMeetingBrief,
  selectRelatedOpenTasks,
  shouldRunPreMeetingAgent,
} from '@/lib/pre-meeting-brief'

const WINDOW_START_MIN = 14
const WINDOW_END_MIN = 16

/**
 * Cron: Pre-meeting briefing (run every 5 min). Finds meetings starting in ~15 min,
 * sends a short briefing per meeting to Telegram/WhatsApp.
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

  try {
    const channels = await resolveNotificationChannels('pre_meeting_briefing')
    if (!channels.enabled) {
      return NextResponse.json({ ok: true, skipped: 'disabled' })
    }

    const now = new Date()
    const windowStart = new Date(now.getTime() + WINDOW_START_MIN * 60 * 1000)
    const windowEnd = new Date(now.getTime() + WINDOW_END_MIN * 60 * 1000)

    const caller = await createServiceCaller()
    const [upcomingResult, allMeetings, allPeople, allTasks] = await Promise.all([
      caller.calendar.upcoming({ limit: 10 }),
      caller.meetings.list(),
      caller.people.list(),
      caller.tasks.list(),
    ])
    const upcoming = upcomingResult.events
    const today = localTodayIso()
    const routing = await getNotificationRouting('pre_meeting_briefing')

    const toBrief: typeof upcoming = []
    for (const e of upcoming) {
      const start = new Date(e.start).getTime()
      if (start >= windowStart.getTime() && start <= windowEnd.getTime()) toBrief.push(e)
    }

    if (toBrief.length === 0) {
      return NextResponse.json({ ok: true, briefed: 0, message: 'No meetings in 15 min window' })
    }

    let sent = 0
    let skippedGate = 0
    for (const calEvent of toBrief) {
      const eventShape = {
        title: calEvent.title,
        start: calEvent.start,
        location: calEvent.location,
        description: 'description' in calEvent ? (calEvent.description as string | null) : null,
        attendees: 'attendees' in calEvent ? calEvent.attendees : undefined,
      }

      const linkedMeeting = allMeetings.find(
        (m) =>
          m.calendarEventId === calEvent.id ||
          (m.title === calEvent.title && m.date === calEvent.start.split('T')[0]),
      )

      let projectName: string | null = null
      if (linkedMeeting?.projectId) {
        const proj = await caller.projects.getById({ id: linkedMeeting.projectId })
        projectName = proj?.name ?? null
      }

      const crmPeople = linkedMeeting
        ? allPeople.filter((p) => linkedMeeting.peopleIds.includes(p.id))
        : []
      const relatedTasks = selectRelatedOpenTasks(
        allTasks,
        linkedMeeting
          ? { id: linkedMeeting.id, projectId: linkedMeeting.projectId }
          : null,
        calEvent.title,
      )
      const priorNotes = findPriorMeetingNotes(allMeetings, calEvent.title, today)

      const briefInput = {
        event: eventShape,
        linkedMeeting: linkedMeeting
          ? {
              id: linkedMeeting.id,
              notes: linkedMeeting.notes,
              projectId: linkedMeeting.projectId,
              projectName,
            }
          : null,
        crmPeople,
        relatedTasks,
        priorNotes,
      }

      // Agent path (Notion-parity Meeting Prep) — skip gated noise silently
      if (routing.agentId) {
        if (!shouldRunPreMeetingAgent(eventShape)) {
          skippedGate++
          continue
        }
        const context = buildPreMeetingAgentContext(briefInput)
        // No dedupeSlot: prep runs once per meeting, so several runs in one slot
        // are expected when meetings are back to back.
        const routed = await runEventAgentIfRouted('pre_meeting_briefing', { context })
        if (routed.status !== 'not_routed') {
          sent++
          continue
        }
      }

      // Template fallback when not routed to an agent
      const text = formatPreMeetingBrief(briefInput)
      const pushed = await pushAssistantMessage(text, 'cron', { typeId: 'pre_meeting_briefing' })
      if (pushed.telegram || pushed.whatsapp) sent++
    }
    return NextResponse.json({
      ok: true,
      briefed: sent,
      skippedGate,
      total: toBrief.length,
      mode: routing.agentId ? 'agent' : 'template',
    })
  } catch (err) {
    console.error('[cron/pre-meeting-briefing]', err)
    const msg = err instanceof Error ? err.message : 'Pre-meeting briefing failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
