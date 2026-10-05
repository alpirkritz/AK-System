import { type NextRequest, NextResponse } from 'next/server'
import { createServiceCaller } from '@/lib/api-caller'

/**
 * Cron: warm the current month's cash-flow narrative once a day.
 * Skips Gemini when the stored reading still matches today's facts.
 * Optional: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return runFinanceNarrative(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return runFinanceNarrative(request)
}

async function runFinanceNarrative(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    const token = auth?.replace(/^Bearer\s+/i, '')
    if (token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ ok: true, skipped: 'unconfigured' })
  }

  try {
    const caller = await createServiceCaller()
    const current = await caller.finance.analytics.narrative({ scope: 'cashflow' })
    if (current.available && !current.stale) {
      return NextResponse.json({ ok: true, skipped: 'fresh' })
    }
    await caller.finance.analytics.narrative({ scope: 'cashflow', force: true })
    return NextResponse.json({ ok: true, generated: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'narrative refresh failed'
    console.error('[cron/finance-narrative]', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
