import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { tasks, meetings } from '@ak-system/database'
import { eq } from 'drizzle-orm'

const priorityEnum = z.enum(['high', 'medium', 'low'])

const createInput = z.object({
  title: z.string().min(1),
  meetingId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  done: z.boolean().optional(),
  priority: priorityEnum.optional(),
})

const updateInput = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  meetingId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  done: z.boolean().optional(),
  priority: priorityEnum.optional(),
})

const idInput = z.object({ id: z.string().min(1) })

export const tasksRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(tasks).orderBy(tasks.createdAt)
  }),

  listByMeeting: publicProcedure.input(z.object({ meetingId: z.string() })).query(async ({ ctx, input }) => {
    return ctx.db.select().from(tasks).where(eq(tasks.meetingId, input.meetingId))
  }),

  listByProject: publicProcedure.input(z.object({ projectId: z.string() })).query(async ({ ctx, input }) => {
    return ctx.db.select().from(tasks).where(eq(tasks.projectId, input.projectId))
  }),

  getById: publicProcedure.input(idInput).query(async ({ ctx, input }) => {
    const [row] = await ctx.db.select().from(tasks).where(eq(tasks.id, input.id))
    return row ?? null
  }),

  create: publicProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    const id = 't' + Date.now()
    const now = new Date().toISOString()
    let projectId = input.projectId ?? null
    if (input.meetingId && projectId === null) {
      const [meeting] = await ctx.db.select().from(meetings).where(eq(meetings.id, input.meetingId))
      if (meeting?.projectId) projectId = meeting.projectId
    }
    await ctx.db.insert(tasks).values({
      id,
      title: input.title,
      meetingId: input.meetingId ?? null,
      projectId,
      assigneeId: input.assigneeId ?? null,
      dueDate: input.dueDate ?? null,
      done: input.done ?? false,
      priority: input.priority ?? 'medium',
      createdAt: now,
      updatedAt: now,
    })
    const [row] = await ctx.db.select().from(tasks).where(eq(tasks.id, id))
    return row!
  }),

  update: publicProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
    const { id, ...rest } = input
    const updates: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date().toISOString() }
    if (rest.title !== undefined) updates.title = rest.title
    if (rest.meetingId !== undefined) updates.meetingId = rest.meetingId
    if (rest.projectId !== undefined) updates.projectId = rest.projectId
    if (rest.assigneeId !== undefined) updates.assigneeId = rest.assigneeId
    if (rest.dueDate !== undefined) updates.dueDate = rest.dueDate
    if (rest.done !== undefined) updates.done = rest.done
    if (rest.priority !== undefined) updates.priority = rest.priority
    await ctx.db.update(tasks).set(updates).where(eq(tasks.id, id))
    const [row] = await ctx.db.select().from(tasks).where(eq(tasks.id, id))
    return row ?? null
  }),

  toggleDone: publicProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const [task] = await ctx.db.select().from(tasks).where(eq(tasks.id, input.id))
    if (!task) return null
    const done = !task.done
    await ctx.db.update(tasks).set({ done, updatedAt: new Date().toISOString() }).where(eq(tasks.id, input.id))
    return { ...task, done }
  }),

  delete: publicProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(tasks).where(eq(tasks.id, input.id))
    return { ok: true }
  }),
})
