import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { listEpisodes } from '../services/agent-episodes'

/** What the agents already delivered — cross-agent run history (spec: agent-episodes). */
export const episodesRouter = router({
  list: protectedProcedure
    .input(z.object({ sinceHours: z.number().int().min(1).max(24 * 14).default(24), agentId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await listEpisodes(ctx.db, input?.sinceHours ?? 24)
      return input?.agentId ? rows.filter((r) => r.agentId === input.agentId) : rows
    }),
})
