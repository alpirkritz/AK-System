import { type NextRequest, NextResponse } from 'next/server'
import { createServiceCaller } from '@/lib/api-caller'
import { cronAuthorized, pushHarnessInsights } from '@/lib/harness-push'

/**
 * Cron (hourly): run the detectors over the incrementally-indexed world model and push.
 * Only drafts whose facts changed are re-phrased by Gemini (spec: harness-world-state-header).
 *
 * Optional: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return run(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return run(request)
}

async function run(request: NextRequest): Promise<NextResponse> {
  if (!cronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const caller = await createServiceCaller()
    const reasoned = await caller.harness.runReasoner({ phraseChangedOnly: true })
    const pushed = await pushHarnessInsights()
    return NextResponse.json({ ok: true, insights: reasoned.count, created: reasoned.created, sent: pushed.sent, mode: pushed.mode })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'harness reason failed'
    console.error('[cron/harness-reason]', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
