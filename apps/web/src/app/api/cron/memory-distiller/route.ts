import { type NextRequest, NextResponse } from 'next/server'
import { getDb } from '@ak-system/database'
import { runMemoryDistiller } from '@ak-system/api'
import { cronAuthorized } from '@/lib/harness-push'

/**
 * Cron (nightly 02:40): propose durable memories from the day's meeting analyses, WhatsApp DM
 * summaries and the owner's own words to Hugo. Proposals wait for review on /memory.
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
    const result = await runMemoryDistiller(getDb())
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'memory distiller failed'
    console.error('[cron/memory-distiller]', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
