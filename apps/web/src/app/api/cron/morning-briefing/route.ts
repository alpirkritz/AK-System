import { type NextRequest, NextResponse } from 'next/server'
import {
  filterEventsByCalendarScope,
  formatInsightLines,
  getAgentCalendarIds,
  getNotificationRouting,
  getSchedulablePreference,
  localTodayIso,
  markNotificationSent,
  wasNotificationSentInSlot,
} from '@ak-system/api'
import { agentCardRequestsDueTasks, getAgentInstructions } from '@/lib/abc-agents'
import { createServiceCaller } from '@/lib/api-caller'
import { formatMorningBriefingContext } from '@/lib/morning-briefing-context'
import {
  formatFinanceBriefLines,
  maybePushFinanceAlert,
  type FinanceAlertInsight,
} from '@/lib/finance-alerts'
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
    const caller = await createServiceCaller()
    const today = localTodayIso()
    const scopeIds = await getAgentCalendarIds()
    const [calResult, allTasks] = await Promise.all([
      caller.calendar.events({ startDate: today, endDate: today }),
      caller.tasks.list(),
    ])
    const scopedEvents = filterEventsByCalendarScope(calResult.events, scopeIds)
    const dueTasks = allTasks.filter((t) => !t.done && t.dueDate === today)
    const routedAgentId = (await getNotificationRouting('morning_briefing')).agentId
    let includeDueTasks = routedAgentId !== '06_calendar_optimizer'
    if (routedAgentId === '06_calendar_optimizer') {
      try {
        includeDueTasks = agentCardRequestsDueTasks(getAgentInstructions(routedAgentId))
      } catch {
        includeDueTasks = false
      }
    }

    // Finance is a nice-to-have on this brief: an analytics failure must not cost the user
    // their schedule, so it degrades to no finance section rather than a 500.
    let financeInsights: FinanceAlertInsight[] = []
    try {
      const result = await caller.finance.analytics.insights({ month: today.slice(0, 7) })
      financeInsights = result.insights
    } catch (err) {
      console.warn('[cron/morning-briefing] finance insights unavailable:', err)
    }

    const coolingFlags = await caller.insights.coolingForDate({ date: today }).catch((err) => {
      console.warn('[cron/morning-briefing] cooling flags unavailable:', err)
      return []
    })

    const commitments = await caller.insights.commitmentsForDate({ date: today }).catch((err) => {
      console.warn('[cron/morning-briefing] commitments unavailable:', err)
      return undefined
    })

    const waiting = await caller.waiting.list().catch((err) => {
      console.warn('[cron/morning-briefing] waiting unavailable:', err)
      return undefined
    })

    // Same contract as finance above: the harness enriches the brief, it never blocks it.
    const harnessInsights = await caller.harness
      .insights({ limit: 3, severity: 'attention' })
      .catch((err) => {
        console.warn('[cron/morning-briefing] harness insights unavailable:', err)
        return []
      })

    const text = formatMorningBriefingContext(
      today,
      scopedEvents,
      dueTasks,
      formatFinanceBriefLines(financeInsights),
      { includeDueTasks, coolingFlags, commitments, waiting, harnessLines: formatInsightLines(harnessInsights) },
    )

    const routed = await runEventAgentIfRouted('morning_briefing', {
      context: text,
      dedupeSlot: currentSlot(),
      timezone: TIMEZONE,
    })
    if (routed.status !== 'not_routed') {
      await markNotificationSent('morning_briefing')
      const finance = await maybePushFinanceAlert(financeInsights)
      return NextResponse.json({
        ok: true,
        mode: routed.status === 'ran' ? 'agent' : 'agent-deduped',
        events: scopedEvents.length,
        dueTasks: dueTasks.length,
        finance: finance.reason,
      })
    }

    // Unrouted = raw template with no LLM. Label it so it's obvious this is not
    // the agent brief (route an agent in Settings ▸ Notifications to get one).
    const labeled = `${text}\n\n(תבנית אוטומטית ללא סוכן — לניתוב סוכן: הגדרות ▸ נוטיפיקציות)`
    const pushed = await pushAssistantMessage(labeled, 'cron', { typeId: 'morning_briefing' })
    await markNotificationSent('morning_briefing')
    const finance = await maybePushFinanceAlert(financeInsights)
    return NextResponse.json({
      ok: true,
      events: scopedEvents.length,
      dueTasks: dueTasks.length,
      sent: pushed.telegram || pushed.whatsapp,
      telegram: pushed.telegram,
      whatsapp: pushed.whatsapp,
      finance: finance.reason,
    })
  } catch (err) {
    console.error('[cron/morning-briefing]', err)
    const msg = err instanceof Error ? err.message : 'Morning briefing failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
