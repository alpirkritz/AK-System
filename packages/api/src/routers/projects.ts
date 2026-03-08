import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { projects, meetings, tasks } from '@ak-system/database'
import { eq } from 'drizzle-orm'

const createInput = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
})

const updateInput = createInput.extend({
  id: z.string().min(1),
})

const idInput = z.object({ id: z.string().min(1) })

export const projectsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(projects).orderBy(projects.name)
  }),

  getById: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const [row] = await ctx.db.select().from(projects).where(eq(projects.id, input.id))
    return row ?? null
  }),

  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    const id = 'proj' + Date.now()
    const now = new Date().toISOString()
    await ctx.db.insert(projects).values({
      id,
      name: input.name,
      color: input.color ?? '#47b8e8',
      createdAt: now,
      updatedAt: now,
    })
    const [row] = await ctx.db.select().from(projects).where(eq(projects.id, id))
    return row!
  }),

  update: protectedProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
    await ctx.db
      .update(projects)
      .set({
        name: input.name,
        color: input.color ?? undefined,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(projects.id, input.id))
    const [row] = await ctx.db.select().from(projects).where(eq(projects.id, input.id))
    return row ?? null
  }),

  delete: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.update(meetings).set({ projectId: null }).where(eq(meetings.projectId, input.id))
    await ctx.db.update(tasks).set({ projectId: null }).where(eq(tasks.projectId, input.id))
    await ctx.db.delete(projects).where(eq(projects.id, input.id))
    return { ok: true }
  }),
})
