import { type NextRequest, NextResponse } from 'next/server'
import { getDb } from '@ak-system/database'
import {
  BACKUP_KINDS,
  BACKUP_STALE_ALERT_TITLE,
  checkBackupFreshness,
  recordBackupRun,
  shouldRaiseBackupAlert,
  type BackupReport,
} from '@ak-system/api'
import { sendTelegramMessage } from '@/lib/telegram-bot'
import { createNotification } from '@/lib/notification-store'
import { sendBrowserPush } from '@/lib/web-push'
import { sendMobilePush } from '@/lib/mobile-push'

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  return token === secret
}

/** In-app notification + web/mobile push; Telegram only if it happens to be configured. */
async function alert(title: string, body: string): Promise<void> {
  const url = '/settings'
  let notificationId: string | undefined
  try {
    notificationId = await createNotification({ title, body, url, type: 'system' })
  } catch (err) {
    console.warn('[backup-report] createNotification failed:', err)
  }
  try {
    await sendBrowserPush(title, body, url, { notificationId })
  } catch (err) {
    console.warn('[backup-report] web push failed:', err)
  }
  try {
    await sendMobilePush(title, body, url, { notificationId })
  } catch (err) {
    console.warn('[backup-report] mobile push failed:', err)
  }
  const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID
  if (process.env.TELEGRAM_BOT_TOKEN && chatId) {
    try {
      await sendTelegramMessage(Number(chatId), `⚠️ ${title}: ${body}`)
    } catch (err) {
      console.warn('[backup-report] telegram failed:', err)
    }
  }
}

/** Host backup scripts POST each run here; failures raise an in-app alert. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as Partial<BackupReport> | null
  if (
    !body ||
    !BACKUP_KINDS.includes(body.kind as (typeof BACKUP_KINDS)[number]) ||
    (body.status !== 'ok' && body.status !== 'failed') ||
    typeof body.startedAt !== 'string'
  ) {
    return NextResponse.json({ error: 'Invalid report' }, { status: 400 })
  }

  const id = await recordBackupRun(getDb(), body as BackupReport)
  if (body.status === 'failed') {
    await alert(`גיבוי נכשל (${body.kind})`, body.error ?? 'סיבה לא ידועה')
  }
  return NextResponse.json({ ok: true, id })
}

/** Dead-man's switch (hourly cron): alerts when no successful DB backup in the last 26h. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const problem = await checkBackupFreshness(getDb())
  if (problem && (await shouldRaiseBackupAlert(getDb(), BACKUP_STALE_ALERT_TITLE))) {
    await alert(BACKUP_STALE_ALERT_TITLE, problem)
  }
  return NextResponse.json({ ok: !problem, problem })
}
