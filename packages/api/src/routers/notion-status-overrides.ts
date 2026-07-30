import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { notionStatusOverrides, tasks, TASK_STATUSES } from '@ak-system/database'
import { eq, isNotNull } from 'drizzle-orm'
import { guessCanonicalStatus } from '../services/notion-tasks-sync'

const canonicalStatusEnum = z.enum(TASK_STATUSES)

const idInput = z.object({ id: z.string().min(1) })

export const notionStatusOverridesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(notionStatusOverrides).orderBy(notionStatusOverrides.rawLabel)
  }),

  upsert: protectedProcedure
    .input(z.object({ rawLabel: z.string().min(1), canonicalStatus: canonicalStatusEnum }))
    .mutation(async ({ ctx, input }) => {
      const rawLabel = input.rawLabel.trim()
      const now = new Date().toISOString()
      const [existing] = await ctx.db
        .select()
        .from(notionStatusOverrides)
        .where(eq(notionStatusOverrides.rawLabel, rawLabel))
      if (existing) {
        await ctx.db
          .update(notionStatusOverrides)
          .set({ canonicalStatus: input.canonicalStatus, updatedAt: now })
          .where(eq(notionStatusOverrides.id, existing.id))
        return { ...existing, canonicalStatus: input.canonicalStatus, updatedAt: now }
      }
      const id = 'nso' + Date.now() + Math.random().toString(36).slice(2, 7)
      await ctx.db.insert(notionStatusOverrides).values({
        id,
        rawLabel,
        canonicalStatus: input.canonicalStatus,
        createdAt: now,
        updatedAt: now,
      })
      const [row] = await ctx.db.select().from(notionStatusOverrides).where(eq(notionStatusOverrides.id, id))
      return row!
    }),

  delete: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(notionStatusOverrides).where(eq(notionStatusOverrides.id, input.id))
    return { ok: true }
  }),

  /** Distinct Notion status labels seen in tasks that have no override yet. */
  unmapped: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ raw: tasks.notionStatusRaw })
      .from(tasks)
      .where(isNotNull(tasks.notionStatusRaw))
    const overrides = await ctx.db
      .select({ rawLabel: notionStatusOverrides.rawLabel })
      .from(notionStatusOverrides)
    const overridden = new Set(overrides.map((o) => o.rawLabel.trim().toLowerCase()))

    const counts = new Map<string, { rawLabel: string; taskCount: number }>()
    for (const r of rows) {
      const raw = (r.raw ?? '').trim()
      if (!raw) continue
      const key = raw.toLowerCase()
      if (overridden.has(key)) continue
      const entry = counts.get(key)
      if (entry) entry.taskCount++
      else counts.set(key, { rawLabel: raw, taskCount: 1 })
    }
    return [...counts.values()]
      .map((e) => ({ ...e, guessedStatus: guessCanonicalStatus(e.rawLabel) }))
      .sort((a, b) => a.rawLabel.localeCompare(b.rawLabel))
  }),
})
