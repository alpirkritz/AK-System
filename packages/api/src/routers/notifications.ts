import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { notifications, eq, desc, isNull, runMutation } from '@ak-system/database'

export const notificationsRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(50) }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(notifications)
        .orderBy(desc(notifications.createdAt))
        .limit(input.limit)
    }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(isNull(notifications.readAt))
    return { count: rows.length }
  }),

  markRead: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        all: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString()
      if (input.all) {
        const unread = await ctx.db
          .select({ id: notifications.id })
          .from(notifications)
          .where(isNull(notifications.readAt))
        for (const row of unread) {
          await runMutation(
            ctx.db
              .update(notifications)
              .set({ readAt: now })
              .where(eq(notifications.id, row.id)),
          )
        }
        return { updated: unread.length }
      }
      if (!input.id) {
        return { updated: 0 }
      }
      await runMutation(
        ctx.db
          .update(notifications)
          .set({ readAt: now })
          .where(eq(notifications.id, input.id)),
      )
      return { updated: 1 }
    }),
})
