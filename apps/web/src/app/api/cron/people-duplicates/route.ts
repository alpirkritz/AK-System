import { type NextRequest, NextResponse } from 'next/server'
import { createServiceCaller } from '@/lib/api-caller'

/**
 * Cron: nightly duplicate-people scan. Adds one in-app notification when new suspected
 * pairs appear; pairs already announced or marked "לא כפילות" stay quiet.
 * Optional: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return run(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return run(request)
}

async function run(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  try {
    const caller = await createServiceCaller()
    const result = await caller.people.notifyNewDuplicates()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[cron/people-duplicates]', err)
    const msg = err instanceof Error ? err.message : 'Duplicate scan failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
