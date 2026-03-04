import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { feedItems, feedSources } from '@ak-system/database'
import { eq, desc, isNull } from 'drizzle-orm'
import { fetchRssFeed, DEFAULT_FEED_SOURCES } from '../services/feed-fetcher'
import { summarizeWithGemini } from '../services/feed-summarizer'

const categoryEnum = z.enum(['economics', 'us_market', 'ai_tech', 'israel_market'])

function genId(): string {
  return 'fi' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export const feedRouter = router({
  /** עדכונים אחרונים לוידג'ט בדשבורד */
  getLatest: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(20).default(5) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: feedItems.id,
          title: feedItems.title,
          link: feedItems.link,
          summary: feedItems.summary,
          publishedAt: feedItems.publishedAt,
          tags: feedItems.tags,
          sourceName: feedSources.name,
          category: feedSources.category,
        })
        .from(feedItems)
        .innerJoin(feedSources, eq(feedItems.sourceId, feedSources.id))
        .orderBy(desc(feedItems.publishedAt))
        .limit(input.limit)
      return rows
    }),

  /** פיד מלא עם פילטר לפי קטגוריה */
  list: publicProcedure
    .input(
      z.object({
        category: categoryEnum.optional(),
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const cols = {
        id: feedItems.id,
        title: feedItems.title,
        link: feedItems.link,
        summary: feedItems.summary,
        publishedAt: feedItems.publishedAt,
        tags: feedItems.tags,
        sourceName: feedSources.name,
        category: feedSources.category,
      }
      const q = ctx.db
        .select(cols)
        .from(feedItems)
        .innerJoin(feedSources, eq(feedItems.sourceId, feedSources.id))
        .orderBy(desc(feedItems.publishedAt))
        .limit(input.limit)
        .offset(input.offset)
      if (input.category) {
        return ctx.db
          .select(cols)
          .from(feedItems)
          .innerJoin(feedSources, eq(feedItems.sourceId, feedSources.id))
          .where(eq(feedSources.category, input.category))
          .orderBy(desc(feedItems.publishedAt))
          .limit(input.limit)
          .offset(input.offset)
      }
      return q
    }),

  /** רשימת מקורות (לאבחון/הגדרות) */
  listSources: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(feedSources).orderBy(feedSources.name)
  }),

  /** הוספת מקור חדש (id נוצר אוטומטית) */
  createSource: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        url: z.string().url().refine((u) => u.startsWith('http://') || u.startsWith('https://'), { message: 'URL must start with http:// or https://' }),
        category: categoryEnum,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const slug = input.name
        .replace(/\s+/g, '-')
        .replace(/[^a-zA-Z0-9\u0590-\u05FF\-]/g, '')
        .toLowerCase()
        .slice(0, 30) || 'source'
      const id = slug + '-' + Date.now().toString(36).slice(-6)
      const now = new Date().toISOString()
      await ctx.db.insert(feedSources).values({
        id,
        name: input.name.trim(),
        url: input.url.trim(),
        category: input.category,
        createdAt: now,
      })
      const [row] = await ctx.db.select().from(feedSources).where(eq(feedSources.id, id))
      return row!
    }),

  /** מחיקת מקור (פריטי הפיד שלו נמחקים ב-CASCADE) */
  deleteSource: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(feedSources).where(eq(feedSources.id, input.id))
      return { deleted: true }
    }),

  /** סנכרון: מזין מקורות ברירת מחדל (אם חסרים) ומשך RSS מכל המקורות */
  sync: publicProcedure.mutation(async ({ ctx }) => {
    const now = new Date().toISOString()
    let sourcesInserted = 0
    for (const src of DEFAULT_FEED_SOURCES) {
      const [existing] = await ctx.db.select().from(feedSources).where(eq(feedSources.id, src.id)).limit(1)
      if (!existing) {
        await ctx.db.insert(feedSources).values({
          id: src.id,
          name: src.name,
          url: src.url,
          category: src.category,
          createdAt: now,
        })
        sourcesInserted++
      }
    }

    let itemsInserted = 0
    const sources = await ctx.db.select().from(feedSources)
    for (const source of sources) {
      try {
        const items = await fetchRssFeed(source.url)
        for (const item of items.slice(0, 30)) {
          // מניעת כפילויות: אותו קישור לא ייכנס פעמיים (גם ממקורות שונים)
          const [existing] = await ctx.db
            .select({ id: feedItems.id })
            .from(feedItems)
            .where(eq(feedItems.link, item.link))
            .limit(1)
          if (existing) continue
          await ctx.db.insert(feedItems).values({
            id: genId(),
            sourceId: source.id,
            title: item.title,
            link: item.link,
            summary: item.summary ?? null,
            publishedAt: item.publishedAt,
            tags: null,
            createdAt: now,
          })
          itemsInserted++
        }
      } catch (err) {
        console.warn(`[feed] Failed to fetch ${source.name} (${source.url}):`, err)
      }
    }
    return { sourcesInserted, itemsInserted }
  }),

  /** הפעלת Gemini לסיכום ולתגיות על פריטים שעדיין ללא תגיות (מגביל ל-10) */
  generateSummaries: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(20).default(10) }))
    .mutation(async ({ ctx, input }) => {
      const items = await ctx.db
        .select()
        .from(feedItems)
        .where(isNull(feedItems.tags))
        .orderBy(desc(feedItems.publishedAt))
        .limit(input.limit)

      let updated = 0
      for (const item of items) {
        const { summary, tags } = await summarizeWithGemini(item.title, item.summary)
        const tagsJson = tags.length > 0 ? JSON.stringify(tags) : null
        const newSummary = summary ?? item.summary
        await ctx.db
          .update(feedItems)
          .set({ summary: newSummary, tags: tagsJson })
          .where(eq(feedItems.id, item.id))
        updated++
      }
      return { updated }
    }),
})
