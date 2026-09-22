import { type NextRequest, NextResponse } from 'next/server'
import {
  generateClusterSummary,
  formatClusterSummaryMessage,
  normalizeWhatsappTs,
  resolveNotificationChannels,
} from '@ak-system/api'
import {
  verifyWhatsAppBridgeAuth,
  type BufferedGroupMessage,
} from '@/lib/whatsapp-bot'
import { saveChatMessage } from '@/lib/conversation-engine'
import { sendBrowserPush } from '@/lib/web-push'
import { sendMobilePush } from '@/lib/mobile-push'
import { createNotification } from '@/lib/notification-store'

interface ClusterGroupBody {
  groupJid?: string
  groupName?: string
  messages?: BufferedGroupMessage[]
}

/**
 * POST /api/whatsapp/group-cluster-summary — one Gemini briefing for an opt-in label cluster.
 * Called by whatsapp-bridge POST /groups/summarize-cluster.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyWhatsAppBridgeAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { clusterName?: string; groups?: ClusterGroupBody[] }
  try {
    body = (await request.json()) as { clusterName?: string; groups?: ClusterGroupBody[] }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const clusterName = body.clusterName?.trim()
  const groups = (body.groups ?? [])
    .filter((g) => g.groupJid && Array.isArray(g.messages) && g.messages.length > 0)
    .map((g) => ({
      name: (g.groupName?.trim() || g.groupJid!.split('@')[0] || 'קבוצה') as string,
      messages: (g.messages ?? []).map((m) => ({
        senderName: m.senderName,
        text: m.text,
        ts: normalizeWhatsappTs(m.timestamp),
      })),
    }))

  if (!clusterName || groups.length === 0) {
    return NextResponse.json({ error: 'clusterName and groups with messages are required' }, { status: 400 })
  }

  try {
    const bodyText = await generateClusterSummary(clusterName, groups)
    const summary = formatClusterSummaryMessage(clusterName, bodyText)
    await saveChatMessage('assistant', summary, 'whatsapp').catch(() => {})
    try {
      const channels = await resolveNotificationChannels('whatsapp_group_summary')
      if (channels.push) {
        const pushTitle = `📋 סיכום — ${clusterName}`
        const pushBody = summary.slice(0, 240)
        const notificationId = await createNotification({
          title: pushTitle,
          body: summary,
          url: '/settings/whatsapp',
          type: 'fomo',
        })
        await sendBrowserPush(pushTitle, pushBody, '/settings/whatsapp', { notificationId })
        await sendMobilePush(pushTitle, pushBody, '/settings/whatsapp', { notificationId })
      }
    } catch (pushErr) {
      console.warn('[WhatsApp group-cluster-summary] Web push failed:', pushErr)
    }
    return NextResponse.json({ summary, reply: summary })
  } catch (err) {
    console.error('[WhatsApp group-cluster-summary]', err)
    const msg = err instanceof Error ? err.message : 'Cluster summary failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
