import { z } from 'zod'
import { desc, eq } from 'drizzle-orm'
import { personEmailThreads } from '@ak-system/database'
import { router, protectedProcedure } from '../trpc'
import { gmailThreadUrl } from '../services/commitments'
import { syncEmailThreads } from '../services/email-sync'

export const emailRouter = router({
  threadsForPerson: protectedProcedure
    .input(z.object({ personId: z.string().min(1), limit: z.number().int().min(1).max(100).optional() }))
    .query(async ({ ctx, input }) => {
      const limit = input.limit ?? 20
      const rows = await ctx.db
        .select()
        .from(personEmailThreads)
        .where(eq(personEmailThreads.personId, input.personId))
        .orderBy(desc(personEmailThreads.date))
        .limit(limit + 1)
      return {
        threads: rows.slice(0, limit).map((t) => ({ ...t, gmailUrl: gmailThreadUrl(t.gmailThreadId) })),
        hasMore: rows.length > limit,
      }
    }),

  syncNow: protectedProcedure
    .input(z.object({ personIds: z.array(z.string().min(1)).optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const result = await syncEmailThreads(ctx.db, { personIds: input?.personIds })
      return { syncedCount: result.created + result.updated, ...result }
    }),
})
