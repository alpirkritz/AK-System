import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure } from '../trpc'
import { feedDigests, feedItems, feedSources } from '@ak-system/database'
import { eq, desc, isNull } from 'drizzle-orm'
import { fetchRssFeed, DEFAULT_FEED_SOURCES } from '../services/feed-fetcher'
import { summarizeWithGemini } from '../services/feed-summarizer'
import {
  generateFeedDigest,
  isFeedDigestConfigured,
  type FeedDigestWatchItem,
} from '../services/feed-digest'

const categoryEnum = z.enum(['economics', 'us_market', 'ai_tech', 'israel_market'])
const digestCategoryEnum = z.enum(['all', 'economics', 'us_market', 'ai_tech', 'israel_market'])

function genId(): string {
  return 'fi' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

const FEED_FETCH_CONCURRENCY = 5

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const idx = next++
      results[idx] = await fn(items[idx]!)
    }
  }
  const n = Math.min(Math.max(1, limit), items.length || 1)
  await Promise.all(Array.from({ length: n }, () => worker()))
  return results
}

function parseStoredWatch(raw: string): FeedDigestWatchItem[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (row): row is FeedDigestWatchItem =>
        !!row &&
        typeof row === 'object' &&
        typeof (row as FeedDigestWatchItem).title === 'string' &&
        typeof (row as FeedDigestWatchItem).why === 'string' &&
        typeof (row as FeedDigestWatchItem).link === 'string' &&
        typeof (row as FeedDigestWatchItem).sourceName === 'string',
    )
  } catch {
    return []
  }
}

export const feedRouter = router({
  /** עדכונים אחרונים לוידג'ט בדשבורד */
  getLatest: protectedProcedure
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
  list: protectedProcedure
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
  listSources: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(feedSources).orderBy(feedSources.name)
  }),

  /** הוספת מקור חדש (id נוצר אוטומטית) */
  createSource: protectedProcedure
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
  deleteSource: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(feedSources).where(eq(feedSources.id, input.id))
      return { deleted: true }
    }),

  /** סנכרון: מזין מקורות ברירת מחדל (אם חסרים) ומשך RSS מכל המקורות */
  sync: protectedProcedure.mutation(async ({ ctx }) => {
    const now = new Date().toISOString()
    let sourcesInserted = 0

    const existingSourceIds = new Set(
      (await ctx.db.select({ id: feedSources.id }).from(feedSources)).map((r) => r.id)
    )
    for (const src of DEFAULT_FEED_SOURCES) {
      if (existingSourceIds.has(src.id)) continue
      await ctx.db.insert(feedSources).values({
        id: src.id,
        name: src.name,
        url: src.url,
        category: src.category,
        createdAt: now,
      })
      sourcesInserted++
    }

    let itemsInserted = 0
    const sources = await ctx.db.select().from(feedSources)

    // Pre-load all existing links for fast deduplication
    const existingLinks = new Set(
      (await ctx.db.select({ link: feedItems.link }).from(feedItems)).map((r) => r.link)
    )

    const fetched = await mapPool(sources, FEED_FETCH_CONCURRENCY, async (source) => {
      try {
        return { source, items: await fetchRssFeed(source.url) }
      } catch (err) {
        console.warn(`[feed] Failed to fetch ${source.name} (${source.url}):`, err)
        return { source, items: [] as Awaited<ReturnType<typeof fetchRssFeed>> }
      }
    })

    for (const { source, items } of fetched) {
      for (const item of items.slice(0, 30)) {
        if (existingLinks.has(item.link)) continue
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
        existingLinks.add(item.link)
        itemsInserted++
      }
    }
    return { sourcesInserted, itemsInserted }
  }),

  /** תמצית אחרונה לקטגוריה (TLDR + שים לב) */
  getDigest: protectedProcedure
    .input(z.object({ category: digestCategoryEnum.default('all') }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db.select().from(feedDigests).where(eq(feedDigests.id, input.category))
      if (!row) return null
      return {
        category: input.category,
        tldr: row.tldr,
        watch: parseStoredWatch(row.watch),
        itemCount: row.itemCount,
        generatedAt: row.generatedAt,
      }
    }),

  /** קורא את פריטי הפיד הנוכחיים ומייצר TLDR + נקודות לתשומת לב */
  generateDigest: protectedProcedure
    .input(
      z.object({
        category: digestCategoryEnum.default('all'),
        limit: z.number().min(1).max(150).default(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!isFeedDigestConfigured()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'אין מפתח Gemini. הוסף GEMINI_API_KEY כדי ליצור תמצית.',
        })
      }

      const cols = {
        title: feedItems.title,
        link: feedItems.link,
        summary: feedItems.summary,
        publishedAt: feedItems.publishedAt,
        sourceName: feedSources.name,
        category: feedSources.category,
      }
      const items =
        input.category === 'all'
          ? await ctx.db
              .select(cols)
              .from(feedItems)
              .innerJoin(feedSources, eq(feedItems.sourceId, feedSources.id))
              .orderBy(desc(feedItems.publishedAt))
              .limit(input.limit)
          : await ctx.db
              .select(cols)
              .from(feedItems)
              .innerJoin(feedSources, eq(feedItems.sourceId, feedSources.id))
              .where(eq(feedSources.category, input.category))
              .orderBy(desc(feedItems.publishedAt))
              .limit(input.limit)

      if (items.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'אין עדכונים לסכם. סנכרן מקורות קודם.',
        })
      }

      let digest
      try {
        digest = await generateFeedDigest(items)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Digest failed'
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: msg.includes('GEMINI') ? 'אין מפתח Gemini. הוסף GEMINI_API_KEY כדי ליצור תמצית.' : 'לא הצלחתי ליצור תמצית. נסה שוב.',
        })
      }

      const generatedAt = new Date().toISOString()
      await ctx.db
        .insert(feedDigests)
        .values({
          id: input.category,
          tldr: digest.tldr,
          watch: JSON.stringify(digest.watch),
          itemCount: items.length,
          generatedAt,
        })
        .onConflictDoUpdate({
          target: feedDigests.id,
          set: {
            tldr: digest.tldr,
            watch: JSON.stringify(digest.watch),
            itemCount: items.length,
            generatedAt,
          },
        })

      return {
        category: input.category,
        tldr: digest.tldr,
        watch: digest.watch,
        itemCount: items.length,
        generatedAt,
      }
    }),

  /** הפעלת Gemini לסיכום ולתגיות על פריטים שעדיין ללא תגיות (מגביל ל-10) */
  generateSummaries: protectedProcedure
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
