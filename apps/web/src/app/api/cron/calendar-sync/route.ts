import { type NextRequest, NextResponse } from 'next/server'
import { createServiceCaller } from '@/lib/api-caller'

/**
 * Cron: sync Google/Apple calendar events into meetings table.
 * Run every 15 minutes (see scripts/install-server-cron.sh).
 * Optional: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return runCalendarSync(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return runCalendarSync(request)
}

async function runCalendarSync(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    const token = auth?.replace(/^Bearer\s+/i, '')
    if (token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const start = new Date().toISOString().split('T')[0]
    const end = new Date(Date.now() + 60 * 86400000).toISOString().split('T')[0]
    const caller = await createServiceCaller()
    const result = await caller.meetings.syncFromCalendar({
      startDate: start,
      endDate: end,
      calendarIds: null,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[cron/calendar-sync]', err)
    const msg = err instanceof Error ? err.message : 'Calendar sync failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
