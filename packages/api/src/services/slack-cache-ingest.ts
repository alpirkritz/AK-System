/**
 * Server side of the Slack desktop-cache bridge (docs/specs/local-chat-cache-ingest.md).
 * The Mac decodes the Slack app's local cache and posts a SlackCachePayload; here we keep the
 * members, link them to People, register conversations (channels, DMs, group DMs), store the
 * messages and run the commitment scan.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { commitments, people, personExternalIds, slackChannels, slackMembers, type getDb } from '@ak-system/database'
import { ingestSlackMessage, scanSlackCommitments, type SlackCommitmentScanResult } from './slack'
import { learnAlias, resolvePerson } from './person-resolution'
import type { MessageClassifier } from './whatsapp-dm'

type Db = ReturnType<typeof getDb>

export interface SlackCachePayload {
  teamId: string
  selfUserId: string
  members: { userId: string; realName: string | null; displayName: string | null; email: string | null; title: string | null; isSelf: boolean }[]
  conversations: { channelId: string; kind: 'channel' | 'dm' | 'group_dm'; name: string; isPrivate: boolean; memberIds: string[]; memberNames: string[] }[]
  messages: { channelId: string; slackTs: string; userId: string; text: string; threadTs: string | null }[]
}

export interface SlackCacheIngestResult {
  members: number
  linked: number
  conversations: number
  newConversations: number
  stored: number
  scan: SlackCommitmentScanResult
}

export function slackMemberName(m: { realName: string | null; displayName: string | null; userId: string }): string {
  return m.realName || m.displayName || m.userId
}

/** The person a Slack member is linked to, if any. */
export async function personForSlackUser(db: Db, teamId: string, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ personId: personExternalIds.personId })
    .from(personExternalIds)
    .where(and(eq(personExternalIds.provider, 'slack'), eq(personExternalIds.accountKey, teamId), eq(personExternalIds.externalId, userId)))
    .limit(1)
  return row?.personId ?? null
}

export async function linkSlackMember(db: Db, personId: string, member: { teamId: string; userId: string; name?: string | null; raw?: unknown }): Promise<void> {
  const now = new Date().toISOString()
  await db
    .insert(personExternalIds)
    .values({
      id: `pei_slack_${member.teamId}_${member.userId}`,
      personId,
      provider: 'slack',
      accountKey: member.teamId,
      externalId: member.userId,
      displayName: member.name ?? null,
      raw: member.raw ? JSON.stringify(member.raw) : null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [personExternalIds.provider, personExternalIds.accountKey, personExternalIds.externalId],
      set: { personId, displayName: member.name ?? null, updatedAt: now },
    })
  if (member.name) await learnAlias(db, personId, member.name, 'slack')
}

/** Work email → person through a learned `email` identity (work mail bridge). */
async function personByWorkEmail(db: Db, email: string): Promise<string | null> {
  const [row] = await db
    .select({ personId: personExternalIds.personId })
    .from(personExternalIds)
    .where(and(eq(personExternalIds.provider, 'email'), eq(personExternalIds.externalId, email.toLowerCase())))
    .limit(1)
  return row?.personId ?? null
}

/**
 * Auto-link: existing link → exact email (person email or learned work email) → a unique exact
 * name/alias. Fuzzy or ambiguous names are never linked; they wait in the "אנשים מסלאק" list.
 */
async function autoLinkMember(db: Db, teamId: string, m: SlackCachePayload['members'][number]): Promise<boolean> {
  if (m.isSelf) return false
  if (await personForSlackUser(db, teamId, m.userId)) return false
  let personId: string | null = m.email ? await personByWorkEmail(db, m.email) : null
  if (!personId) {
    const res = await resolvePerson(db, { email: m.email, name: m.realName || m.displayName })
    personId = res.kind === 'match' ? res.personId : null
  }
  if (!personId) return false
  const [person] = await db.select({ id: people.id }).from(people).where(eq(people.id, personId))
  if (!person) return false
  await linkSlackMember(db, personId, { teamId, userId: m.userId, name: slackMemberName(m), raw: { email: m.email, title: m.title } })
  return true
}

export async function ingestSlackCache(
  db: Db,
  payload: SlackCachePayload,
  /** `scan: false` stores only; the caller runs `scanSlackCommitments` itself (the HTTP route
   *  does it after replying, so the bridge's request never outlives the ngrok timeout). */
  options: { classify?: MessageClassifier; scan?: boolean } = {},
): Promise<SlackCacheIngestResult> {
  const now = new Date().toISOString()
  const { teamId } = payload

  // 1. Members.
  let linked = 0
  for (const m of payload.members) {
    const values = {
      teamId,
      realName: m.realName,
      displayName: m.displayName,
      email: m.email,
      title: m.title,
      isSelf: m.isSelf ? 1 : 0,
      updatedAt: now,
    }
    await db
      .insert(slackMembers)
      .values({ userId: m.userId, ignored: 0, ...values })
      .onConflictDoUpdate({ target: slackMembers.userId, set: values })
    if (await autoLinkMember(db, teamId, m)) linked++
  }
  const nameById = new Map(payload.members.map((m) => [m.userId, slackMemberName(m)]))

  // 2. Conversations. A new channel starts enabled only where Alpir posted or was mentioned;
  //    DMs and group DMs always start enabled. Existing rows keep the user's toggle.
  const selfActive = new Set<string>()
  for (const msg of payload.messages) {
    if (msg.userId === payload.selfUserId) selfActive.add(msg.channelId)
  }
  const selfName = nameById.get(payload.selfUserId)
  if (selfName) {
    for (const msg of payload.messages) if (msg.text.includes(`@${selfName}`)) selfActive.add(msg.channelId)
  }
  const ids = payload.conversations.map((c) => c.channelId)
  const existing = new Set(
    ids.length
      ? (await db.select({ channelId: slackChannels.channelId }).from(slackChannels).where(inArray(slackChannels.channelId, ids))).map((r) => r.channelId)
      : [],
  )
  let newConversations = 0
  for (const c of payload.conversations) {
    const common = {
      teamId,
      name: c.name,
      isPrivate: c.isPrivate ? 1 : 0,
      kind: c.kind,
      memberNames: JSON.stringify(c.memberNames),
      memberIds: JSON.stringify(c.memberIds),
      updatedAt: now,
    }
    if (existing.has(c.channelId)) {
      await db.update(slackChannels).set(common).where(eq(slackChannels.channelId, c.channelId))
    } else {
      newConversations++
      await db.insert(slackChannels).values({
        id: `sc_${c.channelId}`,
        channelId: c.channelId,
        enabled: c.kind !== 'channel' || selfActive.has(c.channelId) ? 1 : 0,
        ...common,
      })
    }
  }

  // 3. Messages (enabled conversations only; idempotent on channel + ts).
  let stored = 0
  for (const msg of payload.messages) {
    const r = await ingestSlackMessage(
      db,
      { type: 'message', channel: msg.channelId, user: msg.userId, username: nameById.get(msg.userId) ?? msg.userId, text: msg.text, ts: msg.slackTs, thread_ts: msg.threadTs ?? undefined },
      teamId,
    )
    if (r.stored) stored++
  }

  // 4. Commitments.
  const scan =
    options.scan === false
      ? { channels: 0, commitments: 0, proposed: [] }
      : await scanSlackCommitments(db, options.classify ? { classify: options.classify } : {})
  return { members: payload.members.length, linked, conversations: payload.conversations.length, newConversations, stored, scan }
}

/**
 * Links a Slack member to a person and re-attributes that member's commitments that were
 * stored as an unknown sender (personId null, senderJid = the Slack user id).
 */
export async function attachSlackMemberToPerson(db: Db, userId: string, personId: string): Promise<{ commitments: number }> {
  const [member] = await db.select().from(slackMembers).where(eq(slackMembers.userId, userId))
  if (!member) throw new Error('Slack member not found')
  await linkSlackMember(db, personId, {
    teamId: member.teamId,
    userId,
    name: slackMemberName(member),
    raw: { email: member.email, title: member.title },
  })
  const moved = await db
    .update(commitments)
    .set({ personId, senderJid: null, senderName: null, updatedAt: new Date().toISOString() })
    .where(and(eq(commitments.source, 'slack_channel'), eq(commitments.senderJid, userId), isNull(commitments.personId)))
    .returning({ id: commitments.id })
  return { commitments: moved.length }
}

export async function unlinkSlackMember(db: Db, userId: string): Promise<void> {
  await db
    .delete(personExternalIds)
    .where(and(eq(personExternalIds.provider, 'slack'), eq(personExternalIds.externalId, userId)))
}
