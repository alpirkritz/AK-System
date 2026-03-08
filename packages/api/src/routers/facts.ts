import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { facts } from '@ak-system/database'
import { eq, desc } from 'drizzle-orm'

/** Facts / memory for conversation engine — save_fact, get_reports */
export const factsRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(50) }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 50
      return ctx.db
        .select()
        .from(facts)
        .orderBy(desc(facts.createdAt))
        .limit(limit)
    }),

  create: protectedProcedure
    .input(z.object({ content: z.string().min(1), source: z.enum(['conversation', 'manual', 'report']).default('conversation') }))
    .mutation(async ({ ctx, input }) => {
      const id = 'f' + Date.now()
      const now = new Date().toISOString()
      await ctx.db.insert(facts).values({
        id,
        content: input.content,
        source: input.source,
        createdAt: now,
      })
      const [row] = await ctx.db.select().from(facts).where(eq(facts.id, id))
      return row!
    }),

  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(facts).where(eq(facts.id, input.id))
    return { ok: true }
  }),
})
