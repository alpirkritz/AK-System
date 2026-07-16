import { type NextRequest, NextResponse } from 'next/server'
import { createServiceCaller } from '@/lib/api-caller'

/**
 * Cron: sync Notion tasks + people directory into the app database.
 * Run every 30 minutes (see deploy/crontab.example).
 * Optional: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return runNotionSync(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return runNotionSync(request)
}

async function runNotionSync(request: NextRequest): Promise<NextResponse> {
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
    const result = await caller.tasks.syncFromNotion({ windowDays: 60, dryRun: false })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[cron/notion-sync]', err)
    const msg = err instanceof Error ? err.message : 'Notion sync failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
