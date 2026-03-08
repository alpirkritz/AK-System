import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { tasks, meetings, taskPeople, people } from '@ak-system/database'
import { eq, inArray } from 'drizzle-orm'

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
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(tasks).orderBy(tasks.createdAt)
  }),

  listByMeeting: protectedProcedure.input(z.object({ meetingId: z.string() })).query(async ({ ctx, input }) => {
    return ctx.db.select().from(tasks).where(eq(tasks.meetingId, input.meetingId))
  }),

  listByProject: protectedProcedure.input(z.object({ projectId: z.string() })).query(async ({ ctx, input }) => {
    return ctx.db.select().from(tasks).where(eq(tasks.projectId, input.projectId))
  }),

  getById: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const [row] = await ctx.db.select().from(tasks).where(eq(tasks.id, input.id))
    return row ?? null
  }),

  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
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

  update: protectedProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
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

  toggleDone: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const [task] = await ctx.db.select().from(tasks).where(eq(tasks.id, input.id))
    if (!task) return null
    const done = !task.done
    await ctx.db.update(tasks).set({ done, updatedAt: new Date().toISOString() }).where(eq(tasks.id, input.id))
    return { ...task, done }
  }),

  delete: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(tasks).where(eq(tasks.id, input.id))
    return { ok: true }
  }),

  getTaskPeople: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const rows = await ctx.db
      .select({ personId: taskPeople.personId })
      .from(taskPeople)
      .where(eq(taskPeople.taskId, input.id))
    return rows.map(r => r.personId)
  }),

  getTaskPeopleWithNames: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const rows = await ctx.db
      .select({ personId: taskPeople.personId, name: people.name })
      .from(taskPeople)
      .innerJoin(people, eq(taskPeople.personId, people.id))
      .where(eq(taskPeople.taskId, input.id))
    return rows.map(r => ({ id: r.personId, name: r.name }))
  }),

  setTaskPeople: protectedProcedure
    .input(z.object({ taskId: z.string().min(1), personIds: z.array(z.string().min(1)) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(taskPeople).where(eq(taskPeople.taskId, input.taskId))
      for (const personId of input.personIds) {
        await ctx.db.insert(taskPeople).values({ taskId: input.taskId, personId })
      }
      return { ok: true }
    }),
})
