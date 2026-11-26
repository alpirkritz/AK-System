/**
 * Slack read-only integration — tRPC router.
 * Manages the OAuth connection, channel configuration, and user identity sync.
 */
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { protectedProcedure, router } from '../trpc'
import { people, personExternalIds, slackChannels, slackMembers, slackMessages } from '@ak-system/database'
import { attachSlackMemberToPerson, slackMemberName, unlinkSlackMember } from '../services/slack-cache-ingest'
import { slackBridgeStatus } from '../services/slack-capture'
import { peopleRouter } from './people'
import {
  getActiveConnection,
  revokeConnection,
  syncChannels,
  syncSlackUsers,
} from '../services/slack'

export const slackRouter = router({
  /**
   * Status of the desktop-cache bridge: whether any Slack data has arrived, and when.
   * docs/specs/local-chat-cache-ingest.md
   */
  cacheStatus: protectedProcedure.query(async ({ ctx }) => {
    const status = await slackBridgeStatus(ctx.db)
    // lastIngestAt is the bridge heartbeat: it moves every run, with or without new messages.
    return { active: status.active, lastIngestAt: status.lastHeartbeatAt, lastMessageTs: status.lastMessageTs, messagesLast24h: status.messagesLast24h, stale: status.stale }
  }),

  /**
   * Slack people the bridge has seen, with their AK person link. `linked: false` is the
   * "אנשים מסלאק" to-do list (unlinked, not ignored, not me).
   */
  listMembers: protectedProcedure
    .input(z.object({ linked: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          userId: slackMembers.userId,
          teamId: slackMembers.teamId,
          realName: slackMembers.realName,
          displayName: slackMembers.displayName,
          email: slackMembers.email,
          title: slackMembers.title,
          isSelf: slackMembers.isSelf,
          ignored: slackMembers.ignored,
          personId: personExternalIds.personId,
          personName: people.name,
        })
        .from(slackMembers)
        .leftJoin(
          personExternalIds,
          and(eq(personExternalIds.provider, 'slack'), eq(personExternalIds.externalId, slackMembers.userId)),
        )
        .leftJoin(people, eq(people.id, personExternalIds.personId))
      // Most recent conversation partner first.
      const lastSeen = new Map(
        (await ctx.db
          .select({ userId: slackMessages.userId, ts: sql<number>`max(${slackMessages.ts})` })
          .from(slackMessages)
          .groupBy(slackMessages.userId)).map((r) => [r.userId, Number(r.ts)]),
      )
      return rows
        .filter((r) => !r.isSelf)
        .filter((r) => (input?.linked === undefined ? true : input.linked ? !!r.personId : !r.personId && !r.ignored))
        .map((r) => ({ ...r, name: slackMemberName(r), isSelf: !!r.isSelf, ignored: !!r.ignored, lastMessageTs: lastSeen.get(r.userId) ?? null }))
        .sort((a, b) => (b.lastMessageTs ?? 0) - (a.lastMessageTs ?? 0))
    }),

  /** Links a Slack member to an existing person (and moves their unknown-sender commitments). */
  linkMember: protectedProcedure
    .input(z.object({ slackUserId: z.string().min(1), personId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [person] = await ctx.db.select({ id: people.id }).from(people).where(eq(people.id, input.personId))
      if (!person) throw new TRPCError({ code: 'NOT_FOUND', message: 'האדם לא נמצא' })
      return attachSlackMemberToPerson(ctx.db, input.slackUserId, input.personId)
    }),

  /** Creates a person from the Slack profile (name, email) and links it. */
  createPersonFromMember: protectedProcedure
    .input(z.object({ slackUserId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [m] = await ctx.db.select().from(slackMembers).where(eq(slackMembers.userId, input.slackUserId))
      if (!m) throw new TRPCError({ code: 'NOT_FOUND', message: 'משתמש הסלאק לא נמצא' })
      const person = await peopleRouter.createCaller(ctx).create({ name: slackMemberName(m), ...(m.email ? { email: m.email } : {}) })
      await attachSlackMemberToPerson(ctx.db, input.slackUserId, person.id)
      return { personId: person.id }
    }),

  unlinkMember: protectedProcedure
    .input(z.object({ slackUserId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await unlinkSlackMember(ctx.db, input.slackUserId)
      return { ok: true }
    }),

  /** Hides a member from the to-link list (bots-in-disguise, people you never deal with). */
  ignoreMember: protectedProcedure
    .input(z.object({ slackUserId: z.string().min(1), ignored: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(slackMembers).set({ ignored: input.ignored ? 1 : 0 }).where(eq(slackMembers.userId, input.slackUserId))
      return { ok: true }
    }),

  /** The person's Slack identity, for the person page. */
  memberForPerson: protectedProcedure
    .input(z.object({ personId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ userId: personExternalIds.externalId, displayName: personExternalIds.displayName })
        .from(personExternalIds)
        .where(and(eq(personExternalIds.provider, 'slack'), eq(personExternalIds.personId, input.personId)))
        .limit(1)
      return row ?? null
    }),

  /** Returns whether there is an active Slack connection. */
  getConnection: protectedProcedure.query(async ({ ctx }) => {
    const conn = await getActiveConnection(ctx.db)
    if (!conn) return { connected: false }
    return { connected: true, teamId: conn.teamId, teamName: conn.teamName, scopes: conn.scopes }
  }),

  /** Revokes the Slack token and marks the connection as disconnected. */
  disconnect: protectedProcedure.mutation(async ({ ctx }) => {
    await revokeConnection(ctx.db)
    return { ok: true }
  }),

  /** Lists all known channels (from last sync). Triggers a background re-sync. */
  listChannels: protectedProcedure.query(async ({ ctx }) => {
    // Background sync — non-blocking
    syncChannels(ctx.db).catch(() => {})
    const rows = await ctx.db
      .select()
      .from(slackChannels)
      .orderBy(slackChannels.name)
    return rows
  }),

  /** Updates channel settings (enabled, FOMO config, keywords). */
  updateChannel: protectedProcedure
    .input(
      z.object({
        channelId: z.string().min(1),
        enabled: z.boolean().optional(),
        fomoEnabled: z.boolean().optional(),
        fomoThreshold: z.number().int().min(2).max(500).optional(),
        fomoWindowMinutes: z.number().int().min(1).max(60).optional(),
        keywords: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString()
      const patch: Partial<typeof slackChannels.$inferInsert> = { updatedAt: now }
      if (input.enabled !== undefined) patch.enabled = input.enabled ? 1 : 0
      if (input.fomoEnabled !== undefined) patch.fomoEnabled = input.fomoEnabled ? 1 : 0
      if (input.fomoThreshold !== undefined) patch.fomoThreshold = input.fomoThreshold
      if (input.fomoWindowMinutes !== undefined) patch.fomoWindowMinutes = input.fomoWindowMinutes
      if (input.keywords !== undefined) patch.keywords = JSON.stringify(input.keywords)

      await ctx.db.update(slackChannels).set(patch).where(eq(slackChannels.channelId, input.channelId))
      const [updated] = await ctx.db
        .select()
        .from(slackChannels)
        .where(eq(slackChannels.channelId, input.channelId))
        .limit(1)
      return updated
    }),

  /** Syncs workspace members to person_external_ids by email. */
  syncUsers: protectedProcedure.mutation(async ({ ctx }) => {
    const synced = await syncSlackUsers(ctx.db)
    return { synced }
  }),

  /** Triggers a background channel list refresh from Slack API. */
  syncChannels: protectedProcedure.mutation(async ({ ctx }) => {
    await syncChannels(ctx.db)
    return { ok: true }
  }),

  /**
   * Stored Slack messages for Hugo's `get_slack_activity` tool: raw rows, newest first,
   * narrowed by channel / sender / text. No model call here; the agent writes the answer.
   */
  forTool: protectedProcedure
    .input(
      z.object({
        channel: z.string().optional(),
        person: z.string().optional(),
        query: z.string().optional(),
        hours: z.number().min(1).max(24 * 30).default(24),
        limit: z.number().int().min(1).max(150).default(60),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const hours = input?.hours ?? 24
      const limit = input?.limit ?? 60
      const sinceMs = Date.now() - hours * 3600_000

      const [channels, selfRows] = await Promise.all([
        ctx.db
          .select({ channelId: slackChannels.channelId, name: slackChannels.name, kind: slackChannels.kind, memberNames: slackChannels.memberNames })
          .from(slackChannels),
        ctx.db.select({ userId: slackMembers.userId }).from(slackMembers).where(sql`${slackMembers.isSelf} = 1`),
      ])
      const selfIds = new Set(selfRows.map((r) => r.userId))
      const labelOf = (c: (typeof channels)[number]): string => {
        if (c.kind === 'channel') return `#${c.name}`
        let names: string[] = []
        try { names = JSON.parse(c.memberNames ?? '[]') as string[] } catch { /* keep the stored name */ }
        return names.length > 0 ? `DM: ${names.join(', ')}` : `DM: ${c.name}`
      }
      const byId = new Map(channels.map((c) => [c.channelId, { label: labelOf(c), kind: c.kind }]))

      const rows = await ctx.db
        .select({
          channelId: slackMessages.channelId,
          userId: slackMessages.userId,
          userName: slackMessages.userName,
          text: slackMessages.text,
          ts: slackMessages.ts,
          threadTs: slackMessages.threadTs,
          slackTs: slackMessages.slackTs,
        })
        .from(slackMessages)
        .where(and(gte(slackMessages.ts, sinceMs), sql`${slackMessages.deleted} = 0`))
        .orderBy(desc(slackMessages.ts))
        .limit(3000)

      const channelQ = input?.channel?.trim().replace(/^#/, '').toLowerCase()
      const personQ = input?.person?.trim().toLowerCase()
      const textQ = input?.query?.trim().toLowerCase()
      const matched = rows.filter((r) => {
        const label = byId.get(r.channelId)?.label.toLowerCase() ?? r.channelId.toLowerCase()
        if (channelQ && !label.includes(channelQ)) return false
        if (personQ && !r.userName.toLowerCase().includes(personQ) && !(byId.get(r.channelId)?.kind !== 'channel' && label.includes(personQ))) return false
        if (textQ && !r.text.toLowerCase().includes(textQ)) return false
        return true
      })

      const perChannel = new Map<string, { channel: string; kind: string; count: number; lastAt: string }>()
      for (const r of matched) {
        const meta = byId.get(r.channelId) ?? { label: r.channelId, kind: 'channel' }
        const cur = perChannel.get(r.channelId)
        if (cur) cur.count += 1
        else perChannel.set(r.channelId, { channel: meta.label, kind: meta.kind, count: 1, lastAt: new Date(r.ts).toISOString() })
      }

      return {
        hasData: channels.length > 0,
        windowHours: hours,
        total: matched.length,
        truncated: matched.length > limit,
        channels: [...perChannel.values()].sort((a, b) => b.count - a.count),
        messages: matched.slice(0, limit).map((r) => ({
          channel: byId.get(r.channelId)?.label ?? r.channelId,
          from: selfIds.has(r.userId) ? 'אני (the owner)' : r.userName,
          fromOwner: selfIds.has(r.userId),
          at: new Date(r.ts).toISOString(),
          inThread: !!r.threadTs && r.threadTs !== r.slackTs,
          text: r.text.length > 500 ? `${r.text.slice(0, 500)}…` : r.text,
        })),
      }
    }),
})
