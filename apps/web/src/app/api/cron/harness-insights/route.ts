import { type NextRequest, NextResponse } from 'next/server'
import { createServiceCaller } from '@/lib/api-caller'
import { cronAuthorized, pushHarnessInsights } from '@/lib/harness-push'
import { refreshStaleProjectStandingsSafe } from '@/lib/harness-standing'

/**
 * Cron (every 6 h): full re-index of the world model, full re-phrase, stale project briefs,
 * then push. The hourly `/api/cron/harness-reason` keeps insights fresh in between.
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
  if (!cronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const caller = await createServiceCaller()
    const indexed = await caller.harness.syncToGraph({})
    const standings = await refreshStaleProjectStandingsSafe()
    const reasoned = await caller.harness.runReasoner()
    const pushed = await pushHarnessInsights()
    return NextResponse.json({
      ok: true,
      indexed: { nodes: indexed.nodes, edges: indexed.edges },
      standings,
      insights: reasoned.count,
      model: reasoned.model,
      sent: pushed.sent,
      pushed: pushed.sent > 0,
      mode: pushed.mode,
      ...(pushed.sent === 0 ? { reason: 'no-new-insights' } : {}),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'harness insights failed'
    console.error('[cron/harness-insights]', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
