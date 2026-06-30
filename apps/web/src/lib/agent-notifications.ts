import { agentNotifiesNotion, getAgentDisplayName, HUGO_AGENT_ID } from './abc-agents'
import { notifyNotionInbox } from './notion'
import { sendBrowserPush } from './web-push'
import { sendExpoPush } from './expo-push'
import { createNotification } from './notification-store'

export type AgentNotifyChannel = 'web' | 'whatsapp' | 'telegram' | 'cron'

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
}): Promise<{ notion: boolean; webPush: number; expoPush: number }> {
  const agentName = getAgentDisplayName(options.agentId)
  const short = excerpt(options.summary)
  const title = `${agentName} — סיים`

  let notion = false
  let webPushCount = 0
  let expoPushCount = 0

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

  const url =
    options.agentId === HUGO_AGENT_ID
      ? '/chat'
      : `/agents?agent=${encodeURIComponent(options.agentId)}`

  try {
    await createNotification({ title, body: short, url, type: 'agent' })
  } catch (err) {
    console.warn('[agent-notifications] createNotification failed:', err)
  }

  try {
    webPushCount = await sendBrowserPush(title, short, url)
  } catch (err) {
    console.warn('[agent-notifications] Web push failed:', err)
  }

  try {
    expoPushCount = await sendExpoPush(title, short, url)
  } catch (err) {
    console.warn('[agent-notifications] Expo push failed:', err)
  }

  return { notion, webPush: webPushCount, expoPush: expoPushCount }
}
