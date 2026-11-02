import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import { commitments, tasks } from '@ak-system/database'
import { router, protectedProcedure } from '../trpc'
import { listWaiting } from '../services/waiting'
import { tasksRouter } from './tasks'

export const waitingRouter = router({
  /** Open items others owe the owner, bucketed by due date. */
  list: protectedProcedure
    .input(z.object({ personId: z.string().min(1).optional() }).optional())
    .query(({ ctx, input }) => listWaiting(ctx.db, { personId: input?.personId })),

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
