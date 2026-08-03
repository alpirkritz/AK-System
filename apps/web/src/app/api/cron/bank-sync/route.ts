import { type NextRequest, NextResponse } from 'next/server'
import { createServiceCaller } from '@/lib/api-caller'

/**
 * Cron: sync all enabled bank/credit-card connections (israeli-bank-scrapers).
 * Schedule: once daily, early morning — before morning-briefing.
 * Scrapers run sequentially (one Chromium at a time) — do NOT increase frequency.
 * Optional: Authorization: Bearer <CRON_SECRET>
 */
export const maxDuration = 300

export async function GET(request: NextRequest): Promise<NextResponse> {
  return runBankSync(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return runBankSync(request)
}

async function runBankSync(request: NextRequest): Promise<NextResponse> {
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
    const { results } = await caller.finance.bankConnections.syncAll()
    const inserted = results.reduce((s, r) => s + r.transactionsInserted, 0)
    const failed = results.filter((r) => !r.success).length
    return NextResponse.json({
      ok: true,
      connections: results.length,
      transactionsInserted: inserted,
      failed,
      results,
    })
  } catch (err) {
    console.error('[cron/bank-sync]', err)
    const msg = err instanceof Error ? err.message : 'Bank sync failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
