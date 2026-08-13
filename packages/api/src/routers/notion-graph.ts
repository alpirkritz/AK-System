import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import {
  isNotionGraphConfigured,
  listConfiguredGraphDatabases,
  syncNotionGraph,
} from '../services/notion-graph-sync'

export const notionGraphRouter = router({
  configured: protectedProcedure.query(() => ({
    configured: isNotionGraphConfigured(),
    databases: listConfiguredGraphDatabases(),
  })),

  sync: protectedProcedure
    .input(
      z
        .object({
          windowDays: z.number().int().min(1).max(365).optional(),
          dryRun: z.boolean().optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      return syncNotionGraph(
        { windowDays: input?.windowDays ?? 90, dryRun: input?.dryRun ?? false },
        ctx.db,
      )
    }),
})
