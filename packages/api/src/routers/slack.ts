/**
 * Slack read-only integration — tRPC router.
 * Manages the OAuth connection, channel configuration, and user identity sync.
 */
import { z } from 'zod'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { protectedProcedure, router } from '../trpc'
import { slackChannels, slackMessages } from '@ak-system/database'
import { isSelfPersonName } from '../lib/self-identity'
import {
  getActiveConnection,
  revokeConnection,
  syncChannels,
  syncSlackUsers,
} from '../services/slack'

export const slackRouter = router({
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
   * Stored Slack messages for Hugo's `get_slack_activity` tool: newest first,
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

      const channels = await ctx.db
        .select({ channelId: slackChannels.channelId, name: slackChannels.name })
        .from(slackChannels)
      const byId = new Map(channels.map((c) => [c.channelId, `#${c.name}`]))

      const rows = await ctx.db
        .select({
          channelId: slackMessages.channelId,
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
        const label = (byId.get(r.channelId) ?? r.channelId).toLowerCase()
        if (channelQ && !label.includes(channelQ)) return false
        if (personQ && !r.userName.toLowerCase().includes(personQ)) return false
        if (textQ && !r.text.toLowerCase().includes(textQ)) return false
        return true
      })

      const perChannel = new Map<string, { channel: string; count: number; lastAt: string }>()
      for (const r of matched) {
        const cur = perChannel.get(r.channelId)
        if (cur) cur.count += 1
        else perChannel.set(r.channelId, { channel: byId.get(r.channelId) ?? r.channelId, count: 1, lastAt: new Date(r.ts).toISOString() })
      }

      return {
        hasData: channels.length > 0 || rows.length > 0,
        windowHours: hours,
        total: matched.length,
        truncated: matched.length > limit,
        channels: [...perChannel.values()].sort((a, b) => b.count - a.count),
        messages: matched.slice(0, limit).map((r) => {
          const fromOwner = isSelfPersonName(r.userName)
          return {
            channel: byId.get(r.channelId) ?? r.channelId,
            from: fromOwner ? 'אני (the owner)' : r.userName,
            fromOwner,
            at: new Date(r.ts).toISOString(),
            inThread: !!r.threadTs && r.threadTs !== r.slackTs,
            text: r.text.slice(0, 1200),
          }
        }),
      }
    }),
})
