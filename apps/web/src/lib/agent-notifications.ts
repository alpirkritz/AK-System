import { getDb, pushSubscriptions, eq } from '@ak-system/database'
import webPush from 'web-push'
import { agentNotifiesNotion, getAgentDisplayName } from './abc-agents'
import { notifyNotionInbox } from './notion'

export type AgentNotifyChannel = 'web' | 'whatsapp' | 'telegram' | 'cron'

function excerpt(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return flat.slice(0, max - 1) + '…'
}

async function sendBrowserPush(title: string, body: string, url = '/agents'): Promise<number> {
  const vapidPublic = process.env.VAPID_PUBLIC_KEY
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY
  if (!vapidPublic || !vapidPrivate) return 0

  webPush.setVapidDetails(
    process.env.VAPID_EMAIL ?? 'mailto:admin@example.com',
    vapidPublic,
    vapidPrivate,
  )

  const db = getDb()
  const subs = await db.select().from(pushSubscriptions).all()
  if (subs.length === 0) return 0

  const payload = JSON.stringify({
    title,
    body,
    url,
    icon: '/icons/icon-192.png',
  })

  const results = await Promise.allSettled(
    subs.map((sub) =>
      webPush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      ),
    ),
  )

  const failed = results
    .map((r, i) => (r.status === 'rejected' ? i : null))
    .filter((i): i is number => i !== null)

  for (const i of failed) {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, subs[i]!.endpoint)).run()
  }

  return subs.length - failed.length
}

/**
 * Notify the user when an agent run completes.
 * - Notion Inbox: for workflow agents (calendar, morning brief, email)
 * - Web: browser push notification
 * - WhatsApp: full reply is sent by the handler; Notion is the extra channel here
 */
export async function notifyAgentRunComplete(options: {
  agentId: string
  summary: string
  channel: AgentNotifyChannel
}): Promise<{ notion: boolean; webPush: number }> {
  const agentName = getAgentDisplayName(options.agentId)
  const short = excerpt(options.summary)
  const title = `${agentName} — סיים`

  let notion = false
  let webPushCount = 0

  if (agentNotifiesNotion(options.agentId) && process.env.NOTION_API_KEY) {
    try {
      await notifyNotionInbox({
        title: `📬 ${agentName} — ${new Date().toISOString().split('T')[0]}`,
        body: options.summary,
        agentId: options.agentId,
      })
      notion = true
    } catch (err) {
      console.warn('[agent-notifications] Notion notify failed:', err)
    }
  }

  if (options.channel === 'web') {
    webPushCount = await sendBrowserPush(title, short, `/agents?agent=${encodeURIComponent(options.agentId)}`)
  }

  return { notion, webPush: webPushCount }
}
