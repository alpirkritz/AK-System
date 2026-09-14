import { getDb, whatsappMessages, chatMessages } from '@ak-system/database'
import { and, asc, gte, inArray, lte } from 'drizzle-orm'
import { generateClusterSummary } from './whatsapp-insights'
import { resolveWhatsappTimeWindow } from '../lib/whatsapp-time-window'
import { createNotification } from '../lib/notification-store'
import { sendMobilePush } from '../lib/mobile-push'
import { resolveNotificationChannels } from './notification-preferences'
import {
  isBridgeConfigured,
  sendBridgeText,
  summarizeCluster,
} from './whatsapp-bridge-client'
import {
  formatClusterSummaryMessage,
  formatQuietDayClusterMessage,
  type SummaryCluster,
} from './whatsapp-summary-clusters'

type Db = ReturnType<typeof getDb>

export interface ClusterRunResult {
  labelId: string
  name: string
  ok: boolean
  error?: string
  text?: string
}

function genMsgId(): string {
  return 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
}

async function saveInsightToChat(db: Db, content: string): Promise<void> {
  try {
    await db.insert(chatMessages).values({
      id: genMsgId(),
      role: 'assistant',
      content,
      source: 'whatsapp',
      createdAt: new Date().toISOString(),
    })
  } catch (err) {
    console.warn('[whatsapp.cluster] failed to save to chat_messages:', err)
  }
}

async function deliverClusterBriefing(
  db: Db,
  clusterName: string,
  full: string,
): Promise<{ ok: boolean; error?: string }> {
  await saveInsightToChat(db, full)

  let sendError: string | undefined
  if (isBridgeConfigured()) {
    const sent = await sendBridgeText(full)
    if (!sent.ok) {
      sendError = 'הסיכום נוצר אבל לא נשלח לוואטסאפ'
    }
  }

  try {
    const channels = await resolveNotificationChannels('whatsapp_group_summary')
    if (channels.push) {
      const pushTitle = `📋 סיכום — ${clusterName}`
      await createNotification({
        title: pushTitle,
        body: full,
        url: '/settings/whatsapp',
        type: 'fomo',
      })
      await sendMobilePush(pushTitle, full.slice(0, 240), '/settings/whatsapp')
    }
  } catch (pushErr) {
    console.warn('[whatsapp.cluster] notification failed:', pushErr)
  }

  return { ok: !sendError, error: sendError }
}

async function fallbackClusterFromDb(db: Db, cluster: SummaryCluster): Promise<ClusterRunResult> {
  const range = resolveWhatsappTimeWindow({ window: 'today' })
  const jids = cluster.groups.map((g) => g.jid)
  const msgRows = await db
    .select({
      groupJid: whatsappMessages.groupJid,
      senderName: whatsappMessages.senderName,
      text: whatsappMessages.text,
      ts: whatsappMessages.ts,
    })
    .from(whatsappMessages)
    .where(
      and(
        inArray(whatsappMessages.groupJid, jids),
        gte(whatsappMessages.ts, range.sinceMs),
        lte(whatsappMessages.ts, range.untilMs),
      ),
    )
    .orderBy(asc(whatsappMessages.ts))

  const byGroup = new Map<string, { senderName: string; text: string; ts: number }[]>()
  for (const r of msgRows) {
    const list = byGroup.get(r.groupJid) ?? []
    list.push({ senderName: r.senderName, text: r.text, ts: r.ts })
    byGroup.set(r.groupJid, list)
  }

  const groups = cluster.groups
    .map((g) => ({ name: g.name, messages: byGroup.get(g.jid) ?? [] }))
    .filter((g) => g.messages.length > 0)

  if (groups.length === 0) {
    const full = formatQuietDayClusterMessage(cluster.labelName)
    const delivered = await deliverClusterBriefing(db, cluster.labelName, full)
    return {
      labelId: cluster.labelId,
      name: cluster.labelName,
      ok: delivered.ok,
      error: delivered.error,
      text: full,
    }
  }

  try {
    const body = await generateClusterSummary(cluster.labelName, groups)
    const full = formatClusterSummaryMessage(cluster.labelName, body)
    const delivered = await deliverClusterBriefing(db, cluster.labelName, full)
    return {
      labelId: cluster.labelId,
      name: cluster.labelName,
      ok: delivered.ok,
      error: delivered.error,
      text: full,
    }
  } catch (err) {
    return {
      labelId: cluster.labelId,
      name: cluster.labelName,
      ok: false,
      error: err instanceof Error ? err.message : 'Cluster summarize failed',
    }
  }
}

/**
 * Prefer live bridge buffers; on any failure, generate from persisted messages (local calendar day).
 * Used by on-demand trigger and the evening cron.
 */
export async function runClusterSummary(db: Db, cluster: SummaryCluster): Promise<ClusterRunResult> {
  if (isBridgeConfigured()) {
    try {
      const result = await summarizeCluster({
        clusterName: cluster.labelName,
        groupJids: cluster.groups.map((g) => g.jid),
      })
      if (result.ok) {
        return { labelId: cluster.labelId, name: cluster.labelName, ok: true }
      }
    } catch (err) {
      console.warn('[whatsapp.cluster] bridge summarize failed, falling back to DB:', err)
    }
  }
  return fallbackClusterFromDb(db, cluster)
}
