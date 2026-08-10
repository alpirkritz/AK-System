import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { notifications, eq, desc, isNull, and, runMutation } from '@ak-system/database'

export const notificationsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        includeArchived: z.boolean().optional().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.includeArchived) {
        return ctx.db
          .select()
          .from(notifications)
          .orderBy(desc(notifications.createdAt))
          .limit(input.limit)
      }
      return ctx.db
        .select()
        .from(notifications)
        .where(isNull(notifications.archivedAt))
        .orderBy(desc(notifications.createdAt))
        .limit(input.limit)
    }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(isNull(notifications.readAt), isNull(notifications.archivedAt)))
    return { count: rows.length }
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(notifications)
        .where(eq(notifications.id, input.id))
        .limit(1)
      return rows[0] ?? null
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
          .where(and(isNull(notifications.readAt), isNull(notifications.archivedAt)))
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

  archive: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        undo: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.undo) {
        await runMutation(
          ctx.db
            .update(notifications)
            .set({ archivedAt: null })
            .where(eq(notifications.id, input.id)),
        )
        return { archived: false }
      }
      const now = new Date().toISOString()
      await runMutation(
        ctx.db
          .update(notifications)
          .set({ archivedAt: now })
          .where(eq(notifications.id, input.id)),
      )
      return { archived: true }
    }),

  archiveAll: protectedProcedure
    .input(
      z.object({
        undo: z.boolean().optional(),
        batchAt: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.undo) {
        if (!input.batchAt) {
          return { archived: false, updated: 0 }
        }
        const rows = await ctx.db
          .select({ id: notifications.id })
          .from(notifications)
          .where(eq(notifications.archivedAt, input.batchAt))
        for (const row of rows) {
          await runMutation(
            ctx.db
              .update(notifications)
              .set({ archivedAt: null })
              .where(eq(notifications.id, row.id)),
          )
        }
        return { archived: false, updated: rows.length }
      }

      const now = new Date().toISOString()
      const rows = await ctx.db
        .select({ id: notifications.id })
        .from(notifications)
        .where(isNull(notifications.archivedAt))
      for (const row of rows) {
        await runMutation(
          ctx.db
            .update(notifications)
            .set({ archivedAt: now })
            .where(eq(notifications.id, row.id)),
        )
      }
      return { archived: true, updated: rows.length, batchAt: now }
    }),
})
