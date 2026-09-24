import { type NextRequest, NextResponse } from 'next/server'
import { getDb, whatsappMessages, lt, and, eq } from '@ak-system/database'
import { runDmRetention } from '@ak-system/api'

const DEFAULT_RETENTION_DAYS = 30
const DEFAULT_DM_RETENTION_DAYS = 90

function resolveDays(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/**
 * Cron: daily WhatsApp retention. Group messages are deleted after 30 days
 * (WHATSAPP_MESSAGE_RETENTION_DAYS); 1:1 messages keep their row but the text becomes
 * `[expired]` after 90 days (WHATSAPP_DM_RETENTION_DAYS). Pinned messages are kept in both.
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

  const retentionDays = resolveDays('WHATSAPP_MESSAGE_RETENTION_DAYS', DEFAULT_RETENTION_DAYS)
  const dmRetentionDays = resolveDays('WHATSAPP_DM_RETENTION_DAYS', DEFAULT_DM_RETENTION_DAYS)
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000

  try {
    const db = getDb()
    await db.delete(whatsappMessages).where(and(lt(whatsappMessages.ts, cutoffMs), eq(whatsappMessages.pinned, false)))
    const dmExpired = await runDmRetention(db, dmRetentionDays)
    return NextResponse.json({ ok: true, retentionDays, cutoffMs, dmRetentionDays, dmExpired })
  } catch (err) {
    console.error('[cron/whatsapp-message-retention]', err)
    const msg = err instanceof Error ? err.message : 'Retention failed'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
