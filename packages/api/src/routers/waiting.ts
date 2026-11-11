import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import { commitments, people, tasks } from '@ak-system/database'
import { router, protectedProcedure } from '../trpc'
import { listOwedByMe, listWaiting } from '../services/waiting'
import { ensureSelfPerson } from '../services/self-person'
import { tasksRouter } from './tasks'

export const waitingRouter = router({
  /** Open items others owe the owner, bucketed by due date. */
  list: protectedProcedure
    .input(z.object({ personId: z.string().min(1).optional() }).optional())
    .query(({ ctx, input }) => listWaiting(ctx.db, { personId: input?.personId })),

  /** Open tasks I took on that this person is linked to: "what I owe them". */
  owedByMe: protectedProcedure
    .input(z.object({ personId: z.string().min(1) }))
    .query(({ ctx, input }) => listOwedByMe(ctx.db, { personId: input.personId })),

  /**
   * One-line capture from the person panel. `iOwe` is a task on me linked to the person;
   * `theyOwe` is a task assigned to them, or an accepted `owner = them` commitment.
   */
  quickAdd: protectedProcedure
    .input(z.object({
      personId: z.string().min(1),
      title: z.string().trim().min(1),
      direction: z.enum(['iOwe', 'theyOwe']),
      as: z.enum(['task', 'commitment']).default('task'),
    }))
    .mutation(async ({ ctx, input }) => {
      const [person] = await ctx.db.select({ id: people.id }).from(people).where(eq(people.id, input.personId))
      if (!person) throw new TRPCError({ code: 'NOT_FOUND', message: 'איש הקשר לא נמצא' })
      const now = new Date().toISOString()

      if (input.as === 'commitment') {
        if (input.direction !== 'theyOwe') throw new TRPCError({ code: 'BAD_REQUEST', message: 'התחייבות אפשר להוסיף רק מהצד שלהם' })
        const id = 'c' + Date.now() + Math.random().toString(36).slice(2, 7)
        await ctx.db.insert(commitments).values({
          id, personId: input.personId, owner: 'them', content: input.title, source: 'manual',
          status: 'accepted', createdAt: now, updatedAt: now,
        })
        return { kind: 'commitment' as const, id }
      }

      const self = await ensureSelfPerson(ctx.db)
      const tasksCaller = tasksRouter.createCaller(ctx)
      const created = await tasksCaller.create({
        title: input.title,
        assigneeId: input.direction === 'iOwe' ? self.id : input.personId,
      })
      await tasksCaller.setTaskPeople({ taskId: created.id, personIds: [input.personId] })
      return { kind: 'task' as const, id: created.id }
    }),

  /** The other person delivered: close the task, or the task-less commitment. */
  complete: protectedProcedure
    .input(z.object({ kind: z.enum(['task', 'commitment']), id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString()
      if (input.kind === 'task') {
        // Through tasks.update so a Notion-synced task is closed there too.
        const [row] = await ctx.db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, input.id)).limit(1)
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'המשימה לא נמצאה' })
        await tasksRouter.createCaller(ctx).update({ id: input.id, status: 'done' })
      } else {
        const res = await ctx.db
          .update(commitments)
          .set({ status: 'dismissed', updatedAt: now })
          .where(eq(commitments.id, input.id))
          .returning({ id: commitments.id })
        if (res.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'ההתחייבות לא נמצאה' })
      }
      return { ok: true }
    }),
})
