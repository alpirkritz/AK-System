import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { hugoInstructions, memories } from '@ak-system/database'
import { eq, desc } from 'drizzle-orm'

const INSTRUCTIONS_ID = 'default'

const kindSchema = z.enum(['instruction', 'memory', 'knowledge'])
const sourceSchema = z.enum(['manual', 'auto', 'chat'])

/** Persistent Hugo memory: standing instructions + memories/knowledge items. */
export const memoryRouter = router({
  instructions: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const [row] = await ctx.db
        .select()
        .from(hugoInstructions)
        .where(eq(hugoInstructions.id, INSTRUCTIONS_ID))
        .limit(1)
      return { content: row?.content ?? '', enabled: row ? !!row.enabled : true }
    }),

    set: protectedProcedure
      .input(z.object({ content: z.string().max(20000), enabled: z.boolean().default(true) }))
      .mutation(async ({ ctx, input }) => {
        const now = new Date().toISOString()
        const [existing] = await ctx.db
          .select()
          .from(hugoInstructions)
          .where(eq(hugoInstructions.id, INSTRUCTIONS_ID))
          .limit(1)
        if (existing) {
          await ctx.db
            .update(hugoInstructions)
            .set({ content: input.content, enabled: input.enabled, updatedAt: now })
            .where(eq(hugoInstructions.id, INSTRUCTIONS_ID))
        } else {
          await ctx.db.insert(hugoInstructions).values({
            id: INSTRUCTIONS_ID,
            content: input.content,
            enabled: input.enabled,
            updatedAt: now,
          })
        }
        return { ok: true }
      }),
  }),

  memories: router({
    list: protectedProcedure
      .input(
        z
          .object({ kind: kindSchema.optional(), limit: z.number().min(1).max(500).default(200) })
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        const limit = input?.limit ?? 200
        const rows = await ctx.db
          .select()
          .from(memories)
          .orderBy(desc(memories.pinned), desc(memories.updatedAt))
          .limit(limit)
        const filtered = input?.kind ? rows.filter((r) => r.kind === input.kind) : rows
        return filtered.map((r) => ({ ...r, pinned: !!r.pinned }))
      }),

    create: protectedProcedure
      .input(
        z.object({
          content: z.string().min(1).max(20000),
          kind: kindSchema.default('memory'),
          source: sourceSchema.default('manual'),
          pinned: z.boolean().default(false),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const id = 'mem_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
        const now = new Date().toISOString()
        await ctx.db.insert(memories).values({
          id,
          content: input.content.trim(),
          kind: input.kind,
          source: input.source,
          pinned: input.pinned,
          createdAt: now,
          updatedAt: now,
        })
        const [row] = await ctx.db.select().from(memories).where(eq(memories.id, id)).limit(1)
        return row ? { ...row, pinned: !!row.pinned } : null
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.string(),
          content: z.string().min(1).max(20000).optional(),
          kind: kindSchema.optional(),
          pinned: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() }
        if (input.content !== undefined) patch.content = input.content.trim()
        if (input.kind !== undefined) patch.kind = input.kind
        if (input.pinned !== undefined) patch.pinned = input.pinned
        await ctx.db.update(memories).set(patch).where(eq(memories.id, input.id))
        return { ok: true }
      }),

    togglePin: protectedProcedure
      .input(z.object({ id: z.string(), pinned: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .update(memories)
          .set({ pinned: input.pinned, updatedAt: new Date().toISOString() })
          .where(eq(memories.id, input.id))
        return { ok: true }
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db.delete(memories).where(eq(memories.id, input.id))
        return { ok: true }
      }),
  }),
})
