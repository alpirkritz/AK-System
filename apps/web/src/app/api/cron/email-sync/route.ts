import { type NextRequest, NextResponse } from 'next/server'
import { getDb } from '@ak-system/database'
import { syncEmailThreads } from '@ak-system/api'
import { createNotification } from '@/lib/notification-store'
import { hasPositiveCount, reindexHarnessScopes } from '@/lib/harness-incremental'

/**
 * Cron: hourly archive of the last 30 days of Gmail threads with known people (metadata and
 * snippet only). Proposes commitments for review at /commitments.
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
    const result = await syncEmailThreads(getDb())
    for (const e of result.accountErrors) console.warn('[cron/email-sync] account skipped:', e.account, e.error)
    if (result.commitments > 0) {
      await createNotification({
        title: result.commitments === 1 ? 'התחייבות חדשה מאימייל' : `${result.commitments} התחייבויות חדשות מאימייל`,
        body: 'עבור עליהן ואשר מה נכנס למשימות.',
        url: '/commitments',
        type: 'system',
      })
    }
    await reindexHarnessScopes(['email'], hasPositiveCount(result))
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[cron/email-sync]', err)
    const msg = err instanceof Error ? err.message : 'Email sync failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
