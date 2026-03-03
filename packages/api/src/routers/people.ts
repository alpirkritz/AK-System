import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { people } from '@ak-system/database'
import { eq } from 'drizzle-orm'

const createInput = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  email: z.string().optional(),
  color: z.string().optional(),
})

const updateInput = createInput.extend({
  id: z.string().min(1),
})

const idInput = z.object({ id: z.string().min(1) })

export const peopleRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(people).orderBy(people.name)
  }),

  getById: publicProcedure.input(idInput).query(async ({ ctx, input }) => {
    const [row] = await ctx.db.select().from(people).where(eq(people.id, input.id))
    return row ?? null
  }),

  create: publicProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    const id = 'p' + Date.now()
    const createdAt = new Date().toISOString()
    await ctx.db.insert(people).values({
      id,
      name: input.name,
      role: input.role ?? null,
      email: input.email ?? null,
      color: input.color ?? '#e8c547',
      createdAt,
    })
    const [row] = await ctx.db.select().from(people).where(eq(people.id, id))
    return row!
  }),

  update: publicProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
    await ctx.db
      .update(people)
      .set({
        name: input.name,
        role: input.role ?? null,
        email: input.email ?? null,
        color: input.color ?? undefined,
      })
      .where(eq(people.id, input.id))
    const [row] = await ctx.db.select().from(people).where(eq(people.id, input.id))
    return row ?? null
  }),

  delete: publicProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(people).where(eq(people.id, input.id))
    return { ok: true }
  }),
})
