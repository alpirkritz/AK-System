import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { workspaces, tasks } from '@ak-system/database'
import { eq } from 'drizzle-orm'

const createInput = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  notionAccountLabel: z.string().nullable().optional(),
})

const updateInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  color: z.string().optional(),
  notionAccountLabel: z.string().nullable().optional(),
})

const idInput = z.object({ id: z.string().min(1) })

export const workspacesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(workspaces).orderBy(workspaces.name)
  }),

  getById: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const [row] = await ctx.db.select().from(workspaces).where(eq(workspaces.id, input.id))
    return row ?? null
  }),

  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    const id = 'ws' + Date.now() + Math.random().toString(36).slice(2, 7)
    const now = new Date().toISOString()
    await ctx.db.insert(workspaces).values({
      id,
      name: input.name,
      color: input.color ?? '#2dd4bf',
      notionAccountLabel: input.notionAccountLabel?.trim() || null,
      createdAt: now,
      updatedAt: now,
    })
    const [row] = await ctx.db.select().from(workspaces).where(eq(workspaces.id, id))
    return row!
  }),

  update: protectedProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
    const updates: Partial<typeof workspaces.$inferInsert> = { updatedAt: new Date().toISOString() }
    if (input.name !== undefined) updates.name = input.name
    if (input.color !== undefined) updates.color = input.color
    if (input.notionAccountLabel !== undefined) {
      updates.notionAccountLabel = input.notionAccountLabel?.trim() || null
    }
    await ctx.db.update(workspaces).set(updates).where(eq(workspaces.id, input.id))
    const [row] = await ctx.db.select().from(workspaces).where(eq(workspaces.id, input.id))
    return row ?? null
  }),

  delete: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.update(tasks).set({ workspaceId: null }).where(eq(tasks.workspaceId, input.id))
    await ctx.db.delete(workspaces).where(eq(workspaces.id, input.id))
    return { ok: true }
  }),
})
