import { type NextRequest, NextResponse } from 'next/server'
import { formatInsightLines, markNotificationSent, wasNotificationSentToday } from '@ak-system/api'
import { createServiceCaller } from '@/lib/api-caller'
import { pushAssistantMessage } from '@/lib/push-notifications'
import { runEventAgentIfRouted } from '@/lib/notification-event-runner'

const NOTIFICATION_TYPE = 'harness_insight'

/**
 * Cron: rebuild the cross-domain world model, then run the reasoner over it.
 *
 * Indexing and reasoning always run — the dashboard widget and `harness.worldState`
 * read the result regardless of whether anything was worth a notification. Only
 * `urgent` insights are pushed, at most once a day, so this never becomes noise.
 *
 * Optional: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return runHarnessInsights(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return runHarnessInsights(request)
}

async function runHarnessInsights(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    const token = auth?.replace(/^Bearer\s+/i, '')
    if (token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const caller = await createServiceCaller()

    const indexed = await caller.harness.syncToGraph({})
    const reasoned = await caller.harness.runReasoner()

    const urgent = await caller.harness.insights({ limit: 5, severity: 'urgent' })
    if (urgent.length === 0) {
      return NextResponse.json({
        ok: true,
        indexed: { nodes: indexed.nodes, edges: indexed.edges },
        insights: reasoned.count,
        pushed: false,
        reason: 'no-urgent',
      })
    }

    // The urgent set changes slowly; a 6-hourly cron would otherwise repeat itself.
    if (await wasNotificationSentToday(NOTIFICATION_TYPE)) {
      return NextResponse.json({
        ok: true,
        indexed: { nodes: indexed.nodes, edges: indexed.edges },
        insights: reasoned.count,
        pushed: false,
        reason: 'already-sent-today',
      })
    }

    const text = ['🔗 תובנות חוצות-תחומים', '', ...formatInsightLines(urgent)].join('\n')

    // This type declares `defaultAgentId: 01_Hugo_orchestrator`, so an unrouted event still
    // runs through him — detector output on its own is facts without a recommendation. The
    // template below covers an agent failure.
    let mode: 'agent' | 'template' = 'agent'
    try {
      const routed = await runEventAgentIfRouted(NOTIFICATION_TYPE, { context: text, url: '/' })
      if (routed.status === 'not_routed') mode = 'template'
    } catch (err) {
      console.error('[cron/harness-insights] agent run failed, falling back to template', err)
      mode = 'template'
    }
    if (mode === 'template') {
      await pushAssistantMessage(text, 'cron', { typeId: NOTIFICATION_TYPE, url: '/' })
    }
    await markNotificationSent(NOTIFICATION_TYPE)

    return NextResponse.json({
      ok: true,
      indexed: { nodes: indexed.nodes, edges: indexed.edges },
      insights: reasoned.count,
      urgent: urgent.length,
      model: reasoned.model,
      pushed: true,
      mode,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'harness insights failed'
    console.error('[cron/harness-insights]', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
