/**
 * Slack read-only integration service.
 *
 * Covers:
 *  - OAuth helpers (install URL, token exchange)
 *  - Signed-request verification for Events API
 *  - Message ingest (create / edit / delete) for enabled channels
 *  - Commitment scan (mirrors scanGroupCommitments from whatsapp-dm.ts)
 *  - FOMO detection per channel
 *  - User → person identity sync
 */
import * as crypto from 'crypto'
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import {
  commitments,
  people,
  personExternalIds,
  slackChannels,
  slackConnections,
  slackMembers,
  slackMessages,
  userSettings,
  type CommitmentSource,
  type getDb,
} from '@ak-system/database'
import { defaultClassify, inferDueDate, proposeCommitments, type ProposedCommitmentLabel } from './whatsapp-dm'
import { learnAlias, resolveOrQueue } from './person-resolution'

type Db = ReturnType<typeof getDb>

// ─── Constants ───────────────────────────────────────────────────────────────

const SLACK_API = 'https://slack.com/api'
const SETTINGS_ID = 'default'
const SOURCE: CommitmentSource = 'slack_channel'
/** How many older messages to include as context for the Gemini classifier. */
const CONTEXT_LINES = 20
/** Max new messages per channel per scan run. */
const MAX_NEW_PER_CHANNEL = 100

// ─── Signing verification ────────────────────────────────────────────────────

/**
 * Verify a Slack Events API request using the signing secret.
 * Rejects payloads older than 5 minutes.
 */
export function verifySlackSignature(
  signingSecret: string,
  rawBody: string,
  timestamp: string,
  slackSignature: string,
): boolean {
  const nowSec = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSec - Number(timestamp)) > 300) return false
  const sigBase = `v0:${timestamp}:${rawBody}`
  const mac = crypto.createHmac('sha256', signingSecret).update(sigBase).digest('hex')
  const expected = `v0=${mac}`
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(slackSignature))
  } catch {
    return false
  }
}

// ─── OAuth ───────────────────────────────────────────────────────────────────

export function buildSlackInstallUrl(redirectUri: string, state: string): string {
  const scopes = [
    'channels:read',
    'channels:history',
    'groups:read',
    'groups:history',
    'users:read',
    'users:read.email',
  ].join(',')
  const params = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID ?? '',
    scope: scopes,
    redirect_uri: redirectUri,
    state,
  })
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`
}

export async function exchangeSlackCode(
  code: string,
  redirectUri: string,
): Promise<{
  teamId: string
  teamName: string
  botToken: string
  botUserId: string
  scopes: string
}> {
  const res = await fetch(`${SLACK_API}/oauth.v2.access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID ?? '',
      client_secret: process.env.SLACK_CLIENT_SECRET ?? '',
      code,
      redirect_uri: redirectUri,
    }).toString(),
  })
  const data = (await res.json()) as {
    ok: boolean
    error?: string
    access_token?: string
    bot_user_id?: string
    scope?: string
    team?: { id: string; name: string }
  }
  if (!data.ok || !data.access_token || !data.team) {
    throw new Error(`Slack OAuth failed: ${data.error ?? 'unknown'}`)
  }
  return {
    teamId: data.team.id,
    teamName: data.team.name,
    botToken: data.access_token,
    botUserId: data.bot_user_id ?? '',
    scopes: data.scope ?? '',
  }
}

// ─── Connection helpers ───────────────────────────────────────────────────────

export async function getActiveConnection(db: Db) {
  const rows = await db
    .select()
    .from(slackConnections)
    .limit(10)
  const conn = rows.find((r) => !r.revokedAt)
  return conn ?? null
}

export async function upsertConnection(
  db: Db,
  params: { teamId: string; teamName: string; botToken: string; botUserId: string; scopes: string },
): Promise<void> {
  const now = new Date().toISOString()
  const id = `slack_${params.teamId}`
  await db
    .insert(slackConnections)
    .values({ id, ...params, installedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: slackConnections.teamId,
      set: {
        teamName: params.teamName,
        botToken: params.botToken,
        botUserId: params.botUserId,
        scopes: params.scopes,
        revokedAt: null,
        updatedAt: now,
      },
    })
}

export async function revokeConnection(db: Db): Promise<void> {
  const conn = await getActiveConnection(db)
  if (!conn) return
  const now = new Date().toISOString()
  // Best-effort revoke at Slack; ignore errors
  try {
    await fetch(`${SLACK_API}/auth.revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${conn.botToken}`, 'Content-Type': 'application/json' },
    })
  } catch { /* network error */ }
  await db
    .update(slackConnections)
    .set({ revokedAt: now, updatedAt: now })
    .where(eq(slackConnections.id, conn.id))
}

// ─── Channel management ───────────────────────────────────────────────────────

/** Calls conversations.list and upserts rows into slack_channels. */
export async function syncChannels(db: Db): Promise<void> {
  const conn = await getActiveConnection(db)
  if (!conn) return
  let cursor: string | undefined
  const now = new Date().toISOString()
  do {
    const params = new URLSearchParams({ types: 'public_channel,private_channel', limit: '200', exclude_archived: 'true' })
    if (cursor) params.set('cursor', cursor)
    const res = await fetch(`${SLACK_API}/conversations.list?${params.toString()}`, {
      headers: { Authorization: `Bearer ${conn.botToken}` },
    })
    const data = (await res.json()) as {
      ok: boolean
      channels?: { id: string; name: string; is_private: boolean }[]
      response_metadata?: { next_cursor?: string }
    }
    if (!data.ok) break
    for (const ch of data.channels ?? []) {
      const id = `sc_${conn.teamId}_${ch.id}`
      await db
        .insert(slackChannels)
        .values({
          id,
          teamId: conn.teamId,
          channelId: ch.id,
          name: ch.name,
          isPrivate: ch.is_private ? 1 : 0,
          enabled: 0,
          fomoEnabled: 0,
          fomoThreshold: 10,
          fomoWindowMinutes: 5,
          keywords: '[]',
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: slackChannels.channelId,
          set: { name: ch.name, updatedAt: now },
        })
    }
    cursor = data.response_metadata?.next_cursor || undefined
  } while (cursor)
}

// ─── Message ingest ───────────────────────────────────────────────────────────

/** Converts Slack's "1234567890.123456" ts to epoch ms. */
export function slackTsToMs(slackTs: string): number {
  return Math.round(parseFloat(slackTs) * 1000)
}

function genMsgId(channelId: string, slackTs: string): string {
  return `sm_${channelId}_${slackTs.replace('.', '_')}`
}

export async function ingestSlackMessage(
  db: Db,
  event: {
    type: string
    channel: string
    user?: string
    username?: string
    text?: string
    ts: string
    thread_ts?: string
    edited?: { ts: string }
    subtype?: string
  },
  teamId: string,
): Promise<{ stored: boolean; skipped?: string }> {
  const [channelRow] = await db
    .select({ enabled: slackChannels.enabled, name: slackChannels.name })
    .from(slackChannels)
    .where(eq(slackChannels.channelId, event.channel))
    .limit(1)
  if (!channelRow?.enabled) return { stored: false, skipped: 'channel not enabled' }

  // Bots / apps: skip
  if (event.subtype === 'bot_message' || !event.user) return { stored: false, skipped: 'bot or no user' }

  const text = (event.text ?? '').trim()
  if (!text) return { stored: false, skipped: 'empty text' }

  const id = genMsgId(event.channel, event.ts)
  const ts = slackTsToMs(event.ts)
  const now = new Date().toISOString()

  await db
    .insert(slackMessages)
    .values({
      id,
      teamId,
      channelId: event.channel,
      slackTs: event.ts,
      userId: event.user,
      userName: event.username ?? event.user,
      text,
      threadTs: event.thread_ts ?? null,
      ts,
      editedTs: null,
      deleted: false,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [slackMessages.channelId, slackMessages.slackTs],
      set: { text, editedTs: event.edited?.ts ?? null, deleted: false },
    })

  return { stored: true }
}

export async function markSlackMessageEdited(
  db: Db,
  channelId: string,
  slackTs: string,
  newText: string,
  editedTs: string,
): Promise<void> {
  await db
    .update(slackMessages)
    .set({ text: newText.trim(), editedTs })
    .where(and(eq(slackMessages.channelId, channelId), eq(slackMessages.slackTs, slackTs)))
}

export async function markSlackMessageDeleted(db: Db, channelId: string, slackTs: string): Promise<void> {
  await db
    .update(slackMessages)
    .set({ deleted: true })
    .where(and(eq(slackMessages.channelId, channelId), eq(slackMessages.slackTs, slackTs)))
}

// ─── FOMO detection ───────────────────────────────────────────────────────────

/** Returns channels that have crossed their FOMO threshold in the last window. */
export async function detectFomoChannels(db: Db): Promise<
  { channelId: string; name: string; count: number; threshold: number }[]
> {
  const channels = await db
    .select()
    .from(slackChannels)
    .where(and(sql`${slackChannels.enabled} = 1`, sql`${slackChannels.fomoEnabled} = 1`))

  const result: { channelId: string; name: string; count: number; threshold: number }[] = []
  const now = Date.now()

  for (const ch of channels) {
    const windowMs = ch.fomoWindowMinutes * 60 * 1000
    const windowStart = now - windowMs
    const cooldownMs = 15 * 60 * 1000 // 15 min cooldown between FOMO alerts
    if (ch.lastFomoAlertAt && Date.now() - new Date(ch.lastFomoAlertAt).getTime() < cooldownMs) continue

    const msgs = await db
      .select({ id: slackMessages.id })
      .from(slackMessages)
      .where(
        and(
          eq(slackMessages.channelId, ch.channelId),
          gt(slackMessages.ts, windowStart),
          sql`${slackMessages.deleted} = 0`,
        ),
      )
    if (msgs.length >= ch.fomoThreshold) {
      result.push({ channelId: ch.channelId, name: ch.name, count: msgs.length, threshold: ch.fomoThreshold })
    }
  }
  return result
}

export async function stampFomoAlert(db: Db, channelId: string): Promise<void> {
  await db
    .update(slackChannels)
    .set({ lastFomoAlertAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .where(eq(slackChannels.channelId, channelId))
}

// ─── Commitment scan ──────────────────────────────────────────────────────────

async function getSlackCommitmentCursor(db: Db): Promise<number> {
  const [row] = await db
    .select({ cursor: userSettings.slackCommitmentScanCursor })
    .from(userSettings)
    .where(eq(userSettings.id, SETTINGS_ID))
    .limit(1)
  const parsed = row?.cursor ? Number(row.cursor) : 0
  return Number.isFinite(parsed) ? parsed : 0
}

async function setSlackCommitmentCursor(db: Db, ts: number): Promise<void> {
  const now = new Date().toISOString()
  const [existing] = await db
    .select({ id: userSettings.id })
    .from(userSettings)
    .where(eq(userSettings.id, SETTINGS_ID))
    .limit(1)
  if (existing) {
    await db
      .update(userSettings)
      .set({ slackCommitmentScanCursor: String(ts), updatedAt: now })
      .where(eq(userSettings.id, SETTINGS_ID))
  } else {
    await db.insert(userSettings).values({ id: SETTINGS_ID, slackCommitmentScanCursor: String(ts), updatedAt: now })
  }
}

/** Resolves a Slack userId to a CRM person via person_external_ids or email. */
async function findPersonBySlackUserId(db: Db, teamId: string, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ personId: personExternalIds.personId })
    .from(personExternalIds)
    .where(
      and(
        eq(personExternalIds.provider, 'slack'),
        eq(personExternalIds.accountKey, teamId),
        eq(personExternalIds.externalId, userId),
      ),
    )
    .limit(1)
  return row?.personId ?? null
}

export interface SlackCommitmentScanResult {
  channels: number
  commitments: number
  proposed: ProposedCommitmentLabel[]
}

/** First scan only looks this far back, so a fresh cache doesn't resurface 2024 promises. */
const FIRST_SCAN_LOOKBACK_MS = 14 * 86_400_000

function parseIds(json: string | null | undefined): string[] {
  if (!json) return []
  try {
    const v = JSON.parse(json) as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/**
 * Scans new messages in enabled Slack conversations (channels, DMs, group DMs) for commitments.
 * Mirrors scanGroupCommitments from whatsapp-dm.ts. Works for the OAuth connection and for the
 * desktop-cache bridge (local-chat-cache-ingest), which has no connection row.
 *
 * Attribution is per sender, in channels too: a commitment belongs to the person who sent the
 * message. When Alpir himself sent it, it belongs to the person he was talking to — the DM
 * counterpart, or the last other speaker in the thread/channel.
 */
export async function scanSlackCommitments(
  db: Db,
  options: { classify?: typeof defaultClassify; now?: number } = {},
): Promise<SlackCommitmentScanResult> {
  const classify = options.classify ?? defaultClassify
  const result: SlackCommitmentScanResult = { channels: 0, commitments: 0, proposed: [] }

  const conn = await getActiveConnection(db)
  const channelRows = await db
    .select()
    .from(slackChannels)
    .where(conn ? and(eq(slackChannels.teamId, conn.teamId), sql`${slackChannels.enabled} = 1`) : sql`${slackChannels.enabled} = 1`)
  if (channelRows.length === 0) return result

  const storedCursor = await getSlackCommitmentCursor(db)
  const cursor = storedCursor || (options.now ?? Date.now()) - FIRST_SCAN_LOOKBACK_MS
  const channelIds = channelRows.map((c) => c.channelId)
  const channelById = new Map(channelRows.map((c) => [c.channelId, c]))
  const selfIds = new Set(
    (await db.select({ userId: slackMembers.userId }).from(slackMembers).where(sql`${slackMembers.isSelf} = 1`)).map((r) => r.userId),
  )
  if (conn?.botUserId) selfIds.add(conn.botUserId)
  const speaker = (userId: string, userName: string) => (selfIds.has(userId) ? 'אני' : userName)

  const newRows = await db
    .select({
      id: slackMessages.id,
      channelId: slackMessages.channelId,
      teamId: slackMessages.teamId,
      userId: slackMessages.userId,
      userName: slackMessages.userName,
      text: slackMessages.text,
      ts: slackMessages.ts,
      slackTs: slackMessages.slackTs,
      threadTs: slackMessages.threadTs,
    })
    .from(slackMessages)
    .where(
      and(
        inArray(slackMessages.channelId, channelIds),
        gt(slackMessages.ts, cursor),
        sql`${slackMessages.deleted} = 0`,
      ),
    )
    .orderBy(slackMessages.ts)
    .limit(MAX_NEW_PER_CHANNEL * channelRows.length)

  if (newRows.length === 0) return result

  const maxTs = Math.max(...newRows.map((r) => r.ts))

  const byChannel = new Map<string, typeof newRows>()
  for (const row of newRows) {
    if (!byChannel.has(row.channelId)) byChannel.set(row.channelId, [])
    byChannel.get(row.channelId)!.push(row)
  }

  for (const [channelId, msgs] of byChannel) {
    const channel = channelById.get(channelId)
    const kind = channel?.kind ?? 'channel'
    const channelName = kind === 'channel' ? `#${channel?.name ?? channelId}` : (channel?.name ?? channelId)
    const teamId = channel?.teamId ?? msgs[0].teamId
    result.channels++

    const priorRows = await db
      .select({ id: slackMessages.id, userId: slackMessages.userId, userName: slackMessages.userName, text: slackMessages.text, ts: slackMessages.ts, threadTs: slackMessages.threadTs, slackTs: slackMessages.slackTs })
      .from(slackMessages)
      .where(and(eq(slackMessages.channelId, channelId), sql`${slackMessages.deleted} = 0`))
      .orderBy(desc(slackMessages.ts))
      .limit(CONTEXT_LINES + msgs.length)

    const freshIds = new Set(msgs.map((m) => m.id))
    const prior = priorRows
      .filter((r) => !freshIds.has(r.id))
      .reverse()
      .slice(-CONTEXT_LINES)
    const timeline = [...prior, ...msgs].sort((a, b) => a.ts - b.ts)

    let classified: Awaited<ReturnType<typeof classify>> = []
    try {
      classified = await classify([
        ...prior.map((r) => ({ id: r.id, speakerLabel: speaker(r.userId, r.userName), text: r.text, ts: r.ts, citable: false })),
        ...msgs.map((m) => ({ id: m.id, speakerLabel: speaker(m.userId, m.userName), text: m.text, ts: m.ts, citable: true })),
      ])
    } catch {
      continue
    }

    for (const item of classified) {
      if (!freshIds.has(item.messageId)) continue
      const sourceMsg = msgs.find((m) => m.id === item.messageId)
      if (!sourceMsg) continue

      // Who is on the other side of this commitment.
      let otherId = sourceMsg.userId
      let otherName = sourceMsg.userName
      if (selfIds.has(sourceMsg.userId)) {
        const counterpart = kind === 'dm' ? parseIds(channel?.memberIds).find((id) => !selfIds.has(id)) : undefined
        const thread = sourceMsg.threadTs ?? sourceMsg.slackTs
        const before = timeline.filter((r) => r.ts < sourceMsg.ts && !selfIds.has(r.userId))
        const lastOther = counterpart
          ? null
          : [...before].reverse().find((r) => (r.threadTs ?? r.slackTs) === thread) ?? before[before.length - 1]
        if (counterpart) {
          otherId = counterpart
          const [m] = await db.select().from(slackMembers).where(eq(slackMembers.userId, counterpart))
          otherName = m?.realName || m?.displayName || channel?.name || counterpart
        } else if (lastOther) {
          otherId = lastOther.userId
          otherName = lastOther.userName
        } else {
          continue // Alpir talking to nobody in particular — nothing to attach it to.
        }
      }

      let personId = await findPersonBySlackUserId(db, teamId, otherId)
      if (personId && otherName) await learnAlias(db, personId, otherName, 'slack')
      if (!personId && otherName) {
        personId = await resolveOrQueue(db, { name: otherName, source: 'slack', context: channelName })
      }

      const proposed = await proposeCommitments(
        db,
        personId,
        SOURCE,
        [
          {
            owner: item.owner,
            content: item.content,
            because: item.because ?? null,
            dueInferred: inferDueDate(item.due ?? '', sourceMsg.ts),
            sourceMessageId: sourceMsg.id,
            sourceSnippet: sourceMsg.text.slice(0, 200),
            sourceTs: sourceMsg.ts,
            sourceChatJid: channelId,
            sourceChatName: `Slack · ${channelName}`,
            senderJid: otherId,
            senderName: otherName,
          },
        ],
      )
      result.commitments += proposed.length
      for (const p of proposed) {
        result.proposed.push({
          label: kind === 'channel' ? `${otherName} (${channelName})` : otherName,
          content: p.content,
          because: p.because ?? null,
          sourceTs: sourceMsg.ts,
          unknownSender: !personId,
        })
      }
    }
  }

  await setSlackCommitmentCursor(db, maxTs)
  return result
}

// ─── User sync ────────────────────────────────────────────────────────────────

/**
 * Fetches workspace members from users.list and upserts into person_external_ids
 * by matching on email to an existing person row.
 */
export async function syncSlackUsers(db: Db): Promise<number> {
  const conn = await getActiveConnection(db)
  if (!conn) return 0

  let cursor: string | undefined
  let synced = 0
  const now = new Date().toISOString()

  do {
    const params = new URLSearchParams({ limit: '200' })
    if (cursor) params.set('cursor', cursor)
    const res = await fetch(`${SLACK_API}/users.list?${params.toString()}`, {
      headers: { Authorization: `Bearer ${conn.botToken}` },
    })
    const data = (await res.json()) as {
      ok: boolean
      members?: { id: string; name: string; real_name?: string; profile?: { email?: string }; is_bot?: boolean; deleted?: boolean }[]
      response_metadata?: { next_cursor?: string }
    }
    if (!data.ok) break

    for (const member of data.members ?? []) {
      if (member.is_bot || member.deleted) continue
      const email = member.profile?.email
      if (!email) continue

      // Find person by email
      const personRows = await db
        .select({ id: people.id })
        .from(people)
        .where(eq(people.email, email))
        .limit(1)
      if (!personRows[0]) continue

      const personId = personRows[0].id
      const id = `pei_slack_${conn.teamId}_${member.id}`
      await db
        .insert(personExternalIds)
        .values({ id, personId, provider: 'slack', accountKey: conn.teamId, externalId: member.id, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [personExternalIds.provider, personExternalIds.accountKey, personExternalIds.externalId],
          set: { personId, updatedAt: now },
        })
      synced++
    }
    cursor = data.response_metadata?.next_cursor || undefined
  } while (cursor)

  return synced
}
