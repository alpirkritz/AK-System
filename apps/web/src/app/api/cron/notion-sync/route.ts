import { type NextRequest, NextResponse } from 'next/server'
import { createServiceCaller } from '@/lib/api-caller'

/**
 * Cron: sync Notion tasks + people + relationship graph into the app database.
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
    const tasksResult = await caller.tasks.syncFromNotion({ windowDays: 60, dryRun: false }).catch(
      (err: unknown) => ({
        error: err instanceof Error ? err.message : 'tasks sync failed',
      }),
    )
    const graphResult = await caller.notionGraph.sync({ windowDays: 90, dryRun: false }).catch(
      (err: unknown) => ({
        error: err instanceof Error ? err.message : 'graph sync failed',
      }),
    )
    return NextResponse.json({ ok: true, tasks: tasksResult, graph: graphResult })
  } catch (err) {
    console.error('[cron/notion-sync]', err)
    const msg = err instanceof Error ? err.message : 'Notion sync failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
