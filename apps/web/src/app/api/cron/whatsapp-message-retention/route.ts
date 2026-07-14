import { type NextRequest, NextResponse } from 'next/server'
import { getDb, whatsappMessages, lt } from '@ak-system/database'

const DEFAULT_RETENTION_DAYS = 30

function resolveRetentionDays(): number {
  const raw = process.env.WHATSAPP_MESSAGE_RETENTION_DAYS?.trim()
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RETENTION_DAYS
}

/**
 * Cron: purge WhatsApp group messages older than the retention window.
 * Runs daily; enforces the 30-day (configurable) retention policy.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return runRetention(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return runRetention(request)
}

async function runRetention(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    const token = auth?.replace(/^Bearer\s+/i, '')
    if (token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const retentionDays = resolveRetentionDays()
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000

  try {
    const db = getDb()
    await db.delete(whatsappMessages).where(lt(whatsappMessages.ts, cutoffMs))
    return NextResponse.json({ ok: true, retentionDays, cutoffMs })
  } catch (err) {
    console.error('[cron/whatsapp-message-retention]', err)
    const msg = err instanceof Error ? err.message : 'Retention failed'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
