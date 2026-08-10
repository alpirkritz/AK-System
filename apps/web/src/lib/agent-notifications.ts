import { agentNotifiesNotion, HUGO_AGENT_ID } from './abc-agents'
import { notifyNotionInbox } from './notion'
import { sendBrowserPush } from './web-push'
import { sendMobilePush } from './mobile-push'
import { createNotification } from './notification-store'
import { resolveAgentDisplayName, resolveNotificationChannels } from '@ak-system/api'

export type AgentNotifyChannel = 'web' | 'whatsapp' | 'telegram' | 'cron'

/** Short, single-line form for the OS push payload only — never for the stored body. */
function excerpt(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return flat.slice(0, max - 1) + '…'
}

/**
 * Notify the user when an agent run completes.
 * - Notion Inbox: for workflow agents (calendar, morning brief, email)
 * - Web Push: sent for every channel so the phone gets an OS notification even when
 *   the run was triggered from WhatsApp/Telegram/cron.
 * - WhatsApp: the full reply is sent by the channel handler; this is the extra push.
 */
export async function notifyAgentRunComplete(options: {
  agentId: string
  summary: string
  channel: AgentNotifyChannel
  /**
   * Set false when the caller delivers its own push for this run, otherwise the
   * user gets the same output twice. The Notion archive is written either way.
   */
  push?: boolean
}): Promise<{ notion: boolean; webPush: number; fcmPush: number }> {
  const agentName = await resolveAgentDisplayName(options.agentId)
  const pushBody = excerpt(options.summary)
  const title = `${agentName} — סיים`

  let notion = false
  let webPushCount = 0
  let fcmPushCount = 0

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

  const isHugo = options.agentId === HUGO_AGENT_ID
  const url = isHugo ? '/chat' : `/agents?agent=${encodeURIComponent(options.agentId)}`

  if (options.push === false) {
    return { notion, webPush: 0, fcmPush: 0 }
  }

  const channels = await resolveNotificationChannels(isHugo ? 'hugo_reply' : 'agent_run')
  if (!channels.push) {
    return { notion, webPush: 0, fcmPush: 0 }
  }

  try {
    await createNotification({ title, body: options.summary, url, type: 'agent' })
  } catch (err) {
    console.warn('[agent-notifications] createNotification failed:', err)
  }

  try {
    webPushCount = await sendBrowserPush(title, pushBody, url)
  } catch (err) {
    console.warn('[agent-notifications] Web push failed:', err)
  }

  try {
    fcmPushCount = await sendMobilePush(title, pushBody, url)
  } catch (err) {
    console.warn('[agent-notifications] FCM push failed:', err)
  }

  return { notion, webPush: webPushCount, fcmPush: fcmPushCount }
}
