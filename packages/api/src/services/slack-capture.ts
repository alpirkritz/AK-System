/**
 * Slack capture status: how many Slack messages with one person were stored, and the bridge's
 * heartbeat. Counts only. docs/specs/slack-capture-indicator.md
 */
import { and, eq, gte, inArray, max, or, sql } from 'drizzle-orm'
import { personExternalIds, slackChannels, slackMembers, slackMessages, type getDb } from '@ak-system/database'

type Db = ReturnType<typeof getDb>

export const SLACK_CAPTURE_WINDOW_DAYS = 30
/** The bridge runs every 15 min; four missed runs and the card says it is stale. */
export const SLACK_STALE_AFTER_MS = 60 * 60 * 1000

export interface SlackPersonCapture {
  /** Any Slack member has ever been synced, i.e. the bridge is in use */
  active: boolean
  linked: boolean
  count: number
  dmCount: number
  otherCount: number
  lastMessageAt: number | null
  windowDays: number
}

/**
 * DMs with the person count in both directions; group DMs and channels count only the person's
 * own messages (the rest is other people talking).
 */
export async function slackCaptureForPerson(db: Db, personId: string, now = Date.now()): Promise<SlackPersonCapture> {
  const [{ members }] = await db.select({ members: sql<number>`count(*)` }).from(slackMembers)
  const empty = { count: 0, dmCount: 0, otherCount: 0, lastMessageAt: null, windowDays: SLACK_CAPTURE_WINDOW_DAYS }
  if (Number(members) === 0) return { active: false, linked: false, ...empty }

  const links = await db
    .select({ userId: personExternalIds.externalId })
    .from(personExternalIds)
    .where(and(eq(personExternalIds.personId, personId), eq(personExternalIds.provider, 'slack')))
  const userIds = links.map((l) => l.userId)
  if (userIds.length === 0) return { active: true, linked: false, ...empty }

  const since = now - SLACK_CAPTURE_WINDOW_DAYS * 86_400_000
  const dmChannels = (await db
    .select({ channelId: slackChannels.channelId, memberIds: slackChannels.memberIds })
    .from(slackChannels)
    .where(eq(slackChannels.kind, 'dm')))
    .filter((c) => {
      try {
        const ids = JSON.parse(c.memberIds || '[]') as unknown
        return Array.isArray(ids) && ids.some((id) => userIds.includes(String(id)))
      } catch {
        return false
      }
    })
    .map((c) => c.channelId)
  const dmSet = new Set(dmChannels)

  const rows = await db
    .select({ channelId: slackMessages.channelId, ts: slackMessages.ts })
    .from(slackMessages)
    .where(
      and(
        eq(slackMessages.deleted, false),
        gte(slackMessages.ts, since),
        dmChannels.length > 0
          ? or(inArray(slackMessages.channelId, dmChannels), inArray(slackMessages.userId, userIds))
          : inArray(slackMessages.userId, userIds),
      ),
    )
  let dmCount = 0
  let otherCount = 0
  let lastMessageAt: number | null = null
  for (const r of rows) {
    if (dmSet.has(r.channelId)) dmCount++
    else otherCount++
    if (lastMessageAt == null || r.ts > lastMessageAt) lastMessageAt = r.ts
  }
  return { active: true, linked: true, count: dmCount + otherCount, dmCount, otherCount, lastMessageAt, windowDays: SLACK_CAPTURE_WINDOW_DAYS }
}

export interface SlackBridgeStatus {
  active: boolean
  /** Last time the bridge delivered anything, even with zero new messages: it re-posts the member list every run */
  lastHeartbeatAt: string | null
  lastMessageTs: number | null
  messagesLast24h: number
  stale: boolean
}

export async function slackBridgeStatus(db: Db, now = Date.now()): Promise<SlackBridgeStatus> {
  const [beat] = await db.select({ at: max(slackMembers.updatedAt) }).from(slackMembers)
  const [last] = await db.select({ ts: max(slackMessages.ts) }).from(slackMessages)
  const [day] = await db
    .select({ n: sql<number>`count(*)` })
    .from(slackMessages)
    .where(and(eq(slackMessages.deleted, false), gte(slackMessages.ts, now - 86_400_000)))
  const lastHeartbeatAt = beat?.at ?? null
  return {
    active: lastHeartbeatAt != null,
    lastHeartbeatAt,
    lastMessageTs: last?.ts ?? null,
    messagesLast24h: Number(day?.n ?? 0),
    stale: lastHeartbeatAt != null && now - new Date(lastHeartbeatAt).getTime() > SLACK_STALE_AFTER_MS,
  }
}
