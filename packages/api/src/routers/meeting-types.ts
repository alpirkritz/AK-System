import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { meetingTypes, meetings } from '@ak-system/database'
import { eq } from 'drizzle-orm'

const createInput = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
})

const updateInput = createInput.extend({
  id: z.string().min(1),
})

const idInput = z.object({ id: z.string().min(1) })

export const meetingTypesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(meetingTypes).orderBy(meetingTypes.name)
  }),

  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    const id = 'mt' + Date.now()
    const now = new Date().toISOString()
    await ctx.db.insert(meetingTypes).values({
      id,
      name: input.name,
      color: input.color ?? '#8b5cf6',
      createdAt: now,
      updatedAt: now,
    })
    const [row] = await ctx.db.select().from(meetingTypes).where(eq(meetingTypes.id, id))
    return row!
  }),

  update: protectedProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
    await ctx.db
      .update(meetingTypes)
      .set({
        name: input.name,
        color: input.color ?? undefined,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(meetingTypes.id, input.id))
    const [row] = await ctx.db.select().from(meetingTypes).where(eq(meetingTypes.id, input.id))
    return row ?? null
  }),

  delete: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.update(meetings).set({ typeId: null }).where(eq(meetings.typeId, input.id))
    await ctx.db.delete(meetingTypes).where(eq(meetingTypes.id, input.id))
    return { ok: true }
  }),
})
