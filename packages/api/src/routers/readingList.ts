import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { readingListItems } from '@ak-system/database'
import { eq, desc } from 'drizzle-orm'

// Trim before validating — pasted URLs routinely carry surrounding whitespace.
const urlSchema = z
  .string()
  .trim()
  .url()
  .refine((u) => u.startsWith('http://') || u.startsWith('https://'), {
    message: 'URL must start with http:// or https://',
  })

function genId(): string {
  return 'rl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

/** רשימת קריאה אישית — קישורים שנשמרו לקריאה מאוחרת. */
export const readingListRouter = router({
  /** כל הפריטים, החדשים קודם; אפשר לסנן לפי סטטוס */
  list: protectedProcedure
    .input(z.object({ status: z.enum(['unread', 'read', 'all']).default('all') }).optional())
    .query(async ({ ctx, input }) => {
      const status = input?.status ?? 'all'
      const rows = await ctx.db
        .select()
        .from(readingListItems)
        .orderBy(desc(readingListItems.createdAt))
      return status === 'all' ? rows : rows.filter((r) => r.status === status)
    }),

  create: protectedProcedure
    .input(
      z.object({
        url: urlSchema,
        title: z.string().min(1).max(300),
        note: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = genId()
      await ctx.db.insert(readingListItems).values({
        id,
        url: input.url.trim(),
        title: input.title.trim(),
        note: input.note?.trim() || null,
        status: 'unread',
        createdAt: new Date().toISOString(),
        readAt: null,
      })
      const [row] = await ctx.db
        .select()
        .from(readingListItems)
        .where(eq(readingListItems.id, id))
        .limit(1)
      return row ?? null
    }),

  markRead: protectedProcedure
    .input(z.object({ id: z.string().min(1), read: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(readingListItems)
        .set({
          status: input.read ? 'read' : 'unread',
          readAt: input.read ? new Date().toISOString() : null,
        })
        .where(eq(readingListItems.id, input.id))
      const [row] = await ctx.db
        .select()
        .from(readingListItems)
        .where(eq(readingListItems.id, input.id))
        .limit(1)
      return row ?? null
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(readingListItems).where(eq(readingListItems.id, input.id))
      return { success: true }
    }),
})
