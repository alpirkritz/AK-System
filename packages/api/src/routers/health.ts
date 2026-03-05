import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { healthMetrics } from '@ak-system/database'
import { eq, and, gte, lte } from 'drizzle-orm'

/** Health data ingestion and query — heart rate, sleep; for meeting correlation */
export const healthRouter = router({
  list: publicProcedure
    .input(z.object({
      type: z.enum(['heart_rate', 'sleep_quality', 'activity']).optional(),
      startAt: z.string().optional(),
      endAt: z.string().optional(),
      limit: z.number().min(1).max(500).default(100),
    }))
    .query(async ({ ctx, input }) => {
      const conditions = []
      if (input.type) conditions.push(eq(healthMetrics.type, input.type))
      if (input.startAt) conditions.push(gte(healthMetrics.at, input.startAt))
      if (input.endAt) conditions.push(lte(healthMetrics.at, input.endAt))
      const where = conditions.length > 0 ? and(...conditions) : undefined
      return ctx.db
        .select()
        .from(healthMetrics)
        .where(where)
        .orderBy(healthMetrics.at)
        .limit(input.limit)
    }),

  ingest: publicProcedure
    .input(z.object({
      type: z.enum(['heart_rate', 'sleep_quality', 'activity']),
      value: z.union([z.number(), z.string()]),
      at: z.string(), // ISO timestamp
      source: z.enum(['garmin', 'apple_health', 'manual', 'csv']).default('manual'),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = 'h' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
      const now = new Date().toISOString()
      const valueStr = typeof input.value === 'number' ? String(input.value) : input.value
      await ctx.db.insert(healthMetrics).values({
        id,
        type: input.type,
        value: valueStr,
        at: input.at,
        source: input.source,
        createdAt: now,
      })
      const [row] = await ctx.db.select().from(healthMetrics).where(eq(healthMetrics.id, id))
      return row!
    }),

  /** Average heart rate in a time window (for daily summary correlation) */
  averageHeartRate: publicProcedure
    .input(z.object({ startAt: z.string(), endAt: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ value: healthMetrics.value })
        .from(healthMetrics)
        .where(and(
          eq(healthMetrics.type, 'heart_rate'),
          gte(healthMetrics.at, input.startAt),
          lte(healthMetrics.at, input.endAt),
        ))
      if (rows.length === 0) return null
      const sum = rows.reduce((acc, r) => acc + Number(r.value) || 0, 0)
      return Math.round(sum / rows.length)
    }),
})
