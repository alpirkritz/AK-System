/**
 * Microsoft Teams read-only service for the local work-comms bridge.
 *
 * Storage + commitment scan for Teams 1:1 and group chats. Mirrors the Slack service,
 * but Teams gives us a sender display name + email per message (no workspace user ids),
 * so people are resolved by email first, then by name. Messages arrive from the local
 * bridge (scripts/teams-chat-source.ts), which drives the signed-in Teams web session —
 * the application Graph path is blocked by Conditional Access. Read-only: never posts.
 */
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import { teamsChats, teamsMessages, userSettings, type CommitmentSource, type getDb } from '@ak-system/database'
import { defaultClassify, inferDueDate, proposeCommitments, type ProposedCommitmentLabel } from './whatsapp-dm'
import { ensureSelfPerson } from './self-person'
import { learnAlias, resolveOrQueue } from './person-resolution'

type Db = ReturnType<typeof getDb>

const SETTINGS_ID = 'default'
const SOURCE: CommitmentSource = 'teams_chat'
const CONTEXT_LINES = 20
const MAX_NEW_PER_CHAT = 100

export async function upsertTeamsChat(
  db: Db,
  params: { chatId: string; topic: string | null; chatType: string; memberNames: string[] },
): Promise<void> {
  const now = new Date().toISOString()
  await db
    .insert(teamsChats)
    .values({
      id: `tc_${params.chatId}`,
      chatId: params.chatId,
      topic: params.topic,
      chatType: params.chatType,
      memberNames: JSON.stringify(params.memberNames),
      enabled: 1,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: teamsChats.chatId,
      set: { topic: params.topic, chatType: params.chatType, memberNames: JSON.stringify(params.memberNames), updatedAt: now },
    })
}

/** Store one chat message if its chat is enabled. Idempotent on the Graph message id. */
export async function ingestTeamsMessage(
  db: Db,
  msg: { chatId: string; messageId: string; fromName: string; fromEmail: string | null; text: string; ts: number },
): Promise<{ stored: boolean; skipped?: string }> {
  const [chat] = await db
    .select({ enabled: teamsChats.enabled })
    .from(teamsChats)
    .where(eq(teamsChats.chatId, msg.chatId))
    .limit(1)
  if (!chat?.enabled) return { stored: false, skipped: 'chat not enabled' }

  const text = msg.text.trim()
  if (!text) return { stored: false, skipped: 'empty text' }

  const now = new Date().toISOString()
  await db
    .insert(teamsMessages)
    .values({
      id: `tm_${msg.messageId}`,
      chatId: msg.chatId,
      fromName: msg.fromName || 'Unknown',
      fromEmail: msg.fromEmail,
      text,
      ts: msg.ts,
      deleted: false,
      createdAt: now,
    })
    .onConflictDoUpdate({ target: teamsMessages.id, set: { text, deleted: false } })
  await db.update(teamsChats).set({ lastMessageAt: msg.ts, updatedAt: now }).where(eq(teamsChats.chatId, msg.chatId))
  return { stored: true }
}

async function getTeamsCursor(db: Db): Promise<number> {
  const [row] = await db
    .select({ cursor: userSettings.teamsCommitmentScanCursor })
    .from(userSettings)
    .where(eq(userSettings.id, SETTINGS_ID))
  return Number(row?.cursor ?? 0) || 0
}

async function setTeamsCursor(db: Db, ts: number): Promise<void> {
  await db
    .insert(userSettings)
    .values({ id: SETTINGS_ID, teamsCommitmentScanCursor: String(ts) })
    .onConflictDoUpdate({ target: userSettings.id, set: { teamsCommitmentScanCursor: String(ts) } })
}

export interface TeamsCommitmentScanResult {
  chats: number
  commitments: number
  proposed: ProposedCommitmentLabel[]
}

/** Scan new messages in enabled Teams chats for commitments. Mirrors scanSlackCommitments. */
export async function scanTeamsCommitments(
  db: Db,
  options: { classify?: typeof defaultClassify } = {},
): Promise<TeamsCommitmentScanResult> {
  const classify = options.classify ?? defaultClassify
  const result: TeamsCommitmentScanResult = { chats: 0, commitments: 0, proposed: [] }

  const chatRows = await db.select().from(teamsChats).where(sql`${teamsChats.enabled} = 1`)
  if (chatRows.length === 0) return result
  const topicByChat = new Map(chatRows.map((c) => [c.chatId, c.topic || c.chatType]))

  const cursor = await getTeamsCursor(db)
  const chatIds = chatRows.map((c) => c.chatId)
  const newRows = await db
    .select({
      id: teamsMessages.id,
      chatId: teamsMessages.chatId,
      fromName: teamsMessages.fromName,
      fromEmail: teamsMessages.fromEmail,
      text: teamsMessages.text,
      ts: teamsMessages.ts,
    })
    .from(teamsMessages)
    .where(and(inArray(teamsMessages.chatId, chatIds), gt(teamsMessages.ts, cursor), sql`${teamsMessages.deleted} = 0`))
    .orderBy(teamsMessages.ts)
    .limit(MAX_NEW_PER_CHAT * chatRows.length)
  if (newRows.length === 0) return result

  const maxTs = Math.max(...newRows.map((r) => r.ts))
  const byChat = new Map<string, typeof newRows>()
  for (const row of newRows) {
    if (!byChat.has(row.chatId)) byChat.set(row.chatId, [])
    byChat.get(row.chatId)!.push(row)
  }

  const selfPerson = await ensureSelfPerson(db)

  for (const [chatId, msgs] of byChat) {
    const chatName = topicByChat.get(chatId) ?? chatId
    result.chats++

    const priorRows = await db
      .select({ id: teamsMessages.id, fromName: teamsMessages.fromName, text: teamsMessages.text, ts: teamsMessages.ts })
      .from(teamsMessages)
      .where(and(eq(teamsMessages.chatId, chatId), sql`${teamsMessages.deleted} = 0`))
      .orderBy(desc(teamsMessages.ts))
      .limit(CONTEXT_LINES + msgs.length)

    const freshIds = new Set(msgs.map((m) => m.id))
    const prior = priorRows
      .filter((r) => !freshIds.has(r.id))
      .reverse()
      .slice(0, CONTEXT_LINES)
      .map((r) => ({ id: r.id, speaker: r.fromName, text: r.text, citable: false as const }))
    const fresh = msgs.map((m) => ({ id: m.id, speaker: m.fromName, text: m.text, citable: true as const }))

    let classified: Awaited<ReturnType<typeof classify>> = []
    try {
      classified = await classify([...prior, ...fresh])
    } catch {
      continue
    }

    for (const item of classified) {
      const sourceMsg = msgs.find((m) => m.id === item.messageId)
      if (!sourceMsg) continue

      let personId: string | null = null
      if (sourceMsg.fromEmail || sourceMsg.fromName) {
        personId = await resolveOrQueue(db, {
          name: sourceMsg.fromName,
          email: sourceMsg.fromEmail,
          source: 'teams',
          context: chatName,
        })
      }
      if (personId && personId !== selfPerson?.id && sourceMsg.fromName) {
        await learnAlias(db, personId, sourceMsg.fromName, 'teams')
      }

      const proposed = await proposeCommitments(db, personId, SOURCE, [
        {
          owner: item.owner,
          content: item.content,
          because: item.because ?? null,
          dueInferred: inferDueDate(item.due ?? '', sourceMsg.ts),
          sourceMessageId: sourceMsg.id,
          sourceSnippet: sourceMsg.text.slice(0, 200),
          sourceTs: sourceMsg.ts,
          sourceChatJid: chatId,
          sourceChatName: chatName,
          senderJid: sourceMsg.fromEmail,
          senderName: sourceMsg.fromName,
        },
      ])
      result.commitments += proposed.length
      for (const p of proposed) {
        result.proposed.push({
          label: sourceMsg.fromName,
          content: p.content,
          because: p.because ?? null,
          sourceTs: sourceMsg.ts,
          unknownSender: !personId,
        })
      }
    }
  }

  await setTeamsCursor(db, maxTs)
  return result
}
