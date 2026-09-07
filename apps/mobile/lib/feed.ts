/** Feed categories and mapping — shared by the updates screen and Vitest. */

export const FEED_CATEGORY_KEY = 'ak.updates-category'

export const FEED_CATEGORIES = [
  { id: 'all', label: 'הכל' },
  { id: 'economics', label: 'כלכלה' },
  { id: 'us_market', label: 'בורסה ארה"ב' },
  { id: 'ai_tech', label: 'טק ו-AI' },
  { id: 'israel_market', label: 'בורסה ישראלית' },
] as const

export type FeedCategory = (typeof FEED_CATEGORIES)[number]['id']
export type FeedListCategory = Exclude<FeedCategory, 'all'>

export type MobileFeedItem = {
  id: string
  title: string
  link: string | null
  summary: string | null
  category: string | null
  sourceName: string | null
  publishedAt: string | null
}

export type MobileFeedWatchItem = {
  title: string
  why: string
  link: string
  sourceName: string
}

export type MobileFeedDigest = {
  category: string
  tldr: string
  watch: MobileFeedWatchItem[]
  itemCount: number
  generatedAt: string
}

export type FeedSyncResult = {
  itemsInserted: number
  sourcesInserted: number
}

const CATEGORY_IDS = new Set<string>(FEED_CATEGORIES.map((c) => c.id))

export function isFeedCategory(value: string | null | undefined): value is FeedCategory {
  return typeof value === 'string' && CATEGORY_IDS.has(value)
}

export function categoryLabel(id: string | null | undefined): string {
  if (!id) return ''
  return FEED_CATEGORIES.find((c) => c.id === id)?.label ?? id
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function mapFeedItem(raw: unknown): MobileFeedItem | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = asString(row.id)
  const title = asString(row.title)
  if (!id || !title) return null
  return {
    id,
    title,
    link: asString(row.link) ?? asString(row.url),
    summary: asString(row.summary),
    category: asString(row.category),
    sourceName: asString(row.sourceName),
    publishedAt: asString(row.publishedAt),
  }
}

export function mapFeedItems(raw: unknown): MobileFeedItem[] {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items)
      ? (raw as { items: unknown[] }).items
      : []
  return rows.map(mapFeedItem).filter((item): item is MobileFeedItem => item !== null)
}

function mapWatchItem(raw: unknown): MobileFeedWatchItem | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const title = asString(row.title)
  const why = asString(row.why)
  const link = asString(row.link)
  if (!title || !why || !link) return null
  return {
    title,
    why,
    link,
    sourceName: asString(row.sourceName) ?? '',
  }
}

export function mapFeedDigest(raw: unknown): MobileFeedDigest | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const tldr = asString(row.tldr)
  if (!tldr) return null
  const watch = Array.isArray(row.watch)
    ? row.watch.map(mapWatchItem).filter((item): item is MobileFeedWatchItem => item !== null)
    : []
  return {
    category: asString(row.category) ?? 'all',
    tldr,
    watch,
    itemCount: typeof row.itemCount === 'number' ? row.itemCount : 0,
    generatedAt: asString(row.generatedAt) ?? '',
  }
}

export function formatSyncResult(res: FeedSyncResult): string {
  return `נוספו ${res.itemsInserted} פריטים (${res.sourcesInserted} מקורות חדשים)`
}

export function formatDigestMeta(digest: MobileFeedDigest, fmtDate: (iso: string) => string): string {
  const time = digest.generatedAt ? fmtDate(digest.generatedAt) : ''
  return time
    ? `על בסיס ${digest.itemCount} עדכונים · ${time}`
    : `על בסיס ${digest.itemCount} עדכונים`
}
