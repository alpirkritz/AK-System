import { type NextRequest, NextResponse } from 'next/server'
import { verifySlackSignature, ingestSlackMessage, markSlackMessageEdited, markSlackMessageDeleted, getActiveConnection, detectFomoChannels, stampFomoAlert } from '@ak-system/api/services/slack'
import { sendBrowserPush } from '@/lib/web-push'
import { sendMobilePush } from '@/lib/mobile-push'
import { createNotification } from '@/lib/notification-store'
import { resolveNotificationChannels } from '@ak-system/api'
import { getDb } from '@ak-system/database'

/**
 * POST /api/slack/events
 * Handles Slack Events API payloads:
 *  - url_verification (Slack challenge handshake)
 *  - message events (new, edited, deleted) for enabled channels
 * Auth: Slack signing secret (SLACK_SIGNING_SECRET env var).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const signingSecret = process.env.SLACK_SIGNING_SECRET
  if (!signingSecret) {
    return NextResponse.json({ error: 'SLACK_SIGNING_SECRET not configured' }, { status: 500 })
  }

  const rawBody = await request.text()
  const timestamp = request.headers.get('x-slack-request-timestamp') ?? ''
  const slackSignature = request.headers.get('x-slack-signature') ?? ''

  if (!verifySlackSignature(signingSecret, rawBody, timestamp, slackSignature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Slack challenge handshake
  if (payload.type === 'url_verification') {
    return NextResponse.json({ challenge: payload.challenge })
  }

  const db = getDb()
  const conn = await getActiveConnection(db)
  if (!conn) {
    return NextResponse.json({ ok: false, skipped: 'no active connection' })
  }

  const event = payload.event as Record<string, unknown> | undefined
  if (!event) return NextResponse.json({ ok: true })

  const eventType = event.type as string
  const subtype = event.subtype as string | undefined

  try {
    if (eventType === 'message') {
      if (!subtype) {
        // New message
        await ingestSlackMessage(
          db,
          event as Parameters<typeof ingestSlackMessage>[1],
          conn.teamId,
        )
        // Check FOMO after ingest
        await runFomoCheck(db)
      } else if (subtype === 'message_changed') {
        const msg = event.message as Record<string, unknown> | undefined
        if (msg) {
          const edited = msg.edited as { ts?: string } | undefined
          await markSlackMessageEdited(
            db,
            event.channel as string,
            msg.ts as string,
            (msg.text as string) ?? '',
            edited?.ts ?? new Date().toISOString(),
          )
        }
      } else if (subtype === 'message_deleted') {
        await markSlackMessageDeleted(db, event.channel as string, event.deleted_ts as string)
      }
    }
  } catch (err) {
    console.error('[Slack events]', err)
  }

  return NextResponse.json({ ok: true })
}

async function runFomoCheck(db: ReturnType<typeof getDb>): Promise<void> {
  try {
    const fomoChannels = await detectFomoChannels(db)
    for (const ch of fomoChannels) {
      const name = ch.name || ch.channelId
      const pushTitle = `🔔 FOMO Slack — ${name}`
      const pushBody = `${ch.count} הודעות ב-${ch.name} בזמן קצר.`

      const channels = await resolveNotificationChannels('slack_fomo')
      if (channels.push) {
        const notificationId = await createNotification({ title: pushTitle, body: pushBody, url: '/settings/slack', type: 'fomo' })
        await sendBrowserPush(pushTitle, pushBody, '/settings/slack', { notificationId })
        await sendMobilePush(pushTitle, pushBody, '/settings/slack', { notificationId })
      }
      await stampFomoAlert(db, ch.channelId)
    }
  } catch (err) {
    console.warn('[Slack FOMO check]', err)
  }
}
