import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb, feedDigests, feedItems, feedSources } from '@ak-system/database'
import { createTestCaller } from '../test-utils'
import { DEFAULT_FEED_SOURCES } from '../services/feed-fetcher'

vi.mock('../services/feed-fetcher', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../services/feed-fetcher')>()
  return {
    ...orig,
    fetchRssFeed: vi.fn(async () => []),
  }
})

vi.mock('../services/feed-digest', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../services/feed-digest')>()
  return {
    ...orig,
    isFeedDigestConfigured: vi.fn(() => true),
    generateFeedDigest: vi.fn(async () => ({
      tldr: 'השוק חיובי עם דגש על טסלה.',
      watch: [
        {
          title: 'Tesla deliveries beat',
          why: 'מכות תחזית',
          link: 'https://example.com/tsla',
          sourceName: 'Gary Black',
        },
      ],
    })),
  }
})

describe('feed router', () => {
  beforeEach(async () => {
    const db = getDb()
    await db.delete(feedItems)
    await db.delete(feedSources)
    await db.delete(feedDigests)
  })

  it('listSources seeds missing default sources including Micha X accounts', async () => {
    const caller = await createTestCaller()
    const sources = await caller.feed.listSources()
    expect(sources).toHaveLength(DEFAULT_FEED_SOURCES.length)
    expect(sources.map((s) => s.id)).toContain('x-jimcramer')
    expect(sources.map((s) => s.id)).toContain('x-tamirtiko2110')
  })

  it('sync inserts missing default sources including Micha X accounts', async () => {
    const caller = await createTestCaller()
    const result = await caller.feed.sync()
    expect(result.sourcesInserted).toBe(DEFAULT_FEED_SOURCES.length)
    expect(result.itemsInserted).toBe(0)

    const sources = await caller.feed.listSources()
    const ids = sources.map((s) => s.id)
    expect(ids).toEqual(expect.arrayContaining(DEFAULT_FEED_SOURCES.map((s) => s.id)))
    expect(ids).toContain('x-jimcramer')
    expect(ids).toContain('x-cathiedwood')
    expect(ids).toContain('x-tamirtiko2110')
  })

  it('sync is idempotent for already-seeded sources', async () => {
    const caller = await createTestCaller()
    await caller.feed.sync()
    const second = await caller.feed.sync()
    expect(second.sourcesInserted).toBe(0)
  })

  it('getDigest returns null when none stored', async () => {
    const caller = await createTestCaller()
    expect(await caller.feed.getDigest({ category: 'all' })).toBeNull()
  })

  it('generateDigest writes a TLDR briefing and getDigest reads it back', async () => {
    const db = getDb()
    const now = new Date().toISOString()
    await db.insert(feedSources).values({
      id: 'src-digest',
      name: 'Gary Black',
      url: 'https://nitter.net/garyblack00/rss',
      category: 'us_market',
      createdAt: now,
    })
    await db.insert(feedItems).values({
      id: 'fi-digest-1',
      sourceId: 'src-digest',
      title: 'Tesla deliveries beat',
      link: 'https://example.com/tsla',
      summary: 'beats',
      publishedAt: now,
      tags: null,
      createdAt: now,
    })

    const caller = await createTestCaller()
    const created = await caller.feed.generateDigest({ category: 'all' })
    expect(created.tldr).toContain('טסלה')
    expect(created.watch).toHaveLength(1)
    expect(created.itemCount).toBe(1)

    const stored = await caller.feed.getDigest({ category: 'all' })
    expect(stored?.tldr).toBe(created.tldr)
    expect(stored?.watch[0]?.link).toBe('https://example.com/tsla')
  })

  it('generateDigest rejects when the feed is empty', async () => {
    const caller = await createTestCaller()
    await expect(caller.feed.generateDigest({ category: 'all' })).rejects.toThrow(/אין עדכונים/)
  })
})
