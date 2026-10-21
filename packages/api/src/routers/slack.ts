/**
 * Slack read-only integration — tRPC router.
 * Manages the OAuth connection, channel configuration, and user identity sync.
 */
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { protectedProcedure, router } from '../trpc'
import { slackChannels, slackConnections } from '@ak-system/database'
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
})
