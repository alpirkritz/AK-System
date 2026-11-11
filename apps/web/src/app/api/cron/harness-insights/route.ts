import { type NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { harnessInsights } from '@ak-system/database'
import { formatInsightLines, listOpenInsights, selectInsightsToPush } from '@ak-system/api'
import { getDb } from '@ak-system/database'
import { createServiceCaller } from '@/lib/api-caller'
import { pushAssistantMessage } from '@/lib/push-notifications'
import { runEventAgentIfRouted } from '@/lib/notification-event-runner'

const NOTIFICATION_TYPE = 'harness_insight'

/**
 * Cron: rebuild the cross-domain world model, then run the reasoner over it.
 *
 * Indexing and reasoning always run — the dashboard widget and `harness.worldState`
 * read the result regardless of whether anything was worth a notification. Only
 * `urgent` insights (up to 5) and unpushed situation-level `attention` insights (up to 3)
 * are pushed once each. Person-scoped attention stays on the dashboard.
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
    const db = getDb()
    const caller = await createServiceCaller()

    const indexed = await caller.harness.syncToGraph({})
    const reasoned = await caller.harness.runReasoner()

    const allOpen = await listOpenInsights(db, { limit: 50 })
    const toSend = selectInsightsToPush(allOpen)

    if (toSend.length === 0) {
      return NextResponse.json({
        ok: true,
        indexed: { nodes: indexed.nodes, edges: indexed.edges },
        insights: reasoned.count,
        pushed: false,
        reason: 'no-new-insights',
      })
    }

    const text = ['🔗 תובנות חוצות-תחומים', '', ...formatInsightLines(toSend)].join('\n')

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

    // Stamp notified_at so these insights are not pushed again.
    const nowIso = new Date().toISOString()
    for (const insight of toSend) {
      await db.update(harnessInsights).set({ notifiedAt: nowIso }).where(eq(harnessInsights.id, insight.id))
    }

    return NextResponse.json({
      ok: true,
      indexed: { nodes: indexed.nodes, edges: indexed.edges },
      insights: reasoned.count,
      sent: toSend.length,
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
