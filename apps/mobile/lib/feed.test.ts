import { describe, expect, it } from 'vitest'
import {
  categoryLabel,
  formatDigestMeta,
  formatSyncResult,
  isFeedCategory,
  mapFeedDigest,
  mapFeedItem,
  mapFeedItems,
} from './feed'

describe('feed mapping', () => {
  it('maps API link onto the open-url field (url is a fallback)', () => {
    expect(
      mapFeedItem({
        id: '1',
        title: 'Headline',
        link: 'https://example.com/a',
        url: 'https://example.com/ignored',
        summary: '  blurb  ',
        category: 'economics',
        sourceName: 'TheMarker',
        publishedAt: '2026-09-06T08:00:00.000Z',
      }),
    ).toEqual({
      id: '1',
      title: 'Headline',
      link: 'https://example.com/a',
      summary: 'blurb',
      category: 'economics',
      sourceName: 'TheMarker',
      publishedAt: '2026-09-06T08:00:00.000Z',
    })

    expect(mapFeedItem({ id: '2', title: 'X post', url: 'https://x.com/a' })?.link).toBe(
      'https://x.com/a',
    )
  })

  it('drops rows without id or title', () => {
    expect(mapFeedItem({ title: 'no id' })).toBeNull()
    expect(mapFeedItem({ id: '1' })).toBeNull()
    expect(mapFeedItems([{ id: '1', title: 'ok' }, { id: '2' }])).toHaveLength(1)
  })

  it('unwraps { items } payloads and ignores junk', () => {
    expect(mapFeedItems({ items: [{ id: '1', title: 'A' }] })).toHaveLength(1)
    expect(mapFeedItems(null)).toEqual([])
  })

  it('maps a digest and skips incomplete watch rows', () => {
    const digest = mapFeedDigest({
      category: 'all',
      tldr: 'השווקים ירדו.',
      itemCount: 12,
      generatedAt: '2026-09-06T09:00:00.000Z',
      watch: [
        { title: 'Fed', why: 'ריבית', link: 'https://example.com/fed', sourceName: 'BBC' },
        { title: 'missing link', why: 'x' },
      ],
    })
    expect(digest?.tldr).toBe('השווקים ירדו.')
    expect(digest?.watch).toHaveLength(1)
    expect(digest?.watch[0]?.sourceName).toBe('BBC')
    expect(mapFeedDigest(null)).toBeNull()
  })
})

describe('feed copy', () => {
  it('labels web categories in Hebrew and rejects unknown ids', () => {
    expect(categoryLabel('us_market')).toBe('בורסה ארה"ב')
    expect(categoryLabel('mystery')).toBe('mystery')
    expect(isFeedCategory('ai_tech')).toBe(true)
    expect(isFeedCategory('rss')).toBe(false)
  })

  it('formats sync and digest meta the same way as web', () => {
    expect(formatSyncResult({ itemsInserted: 4, sourcesInserted: 1 })).toBe(
      'נוספו 4 פריטים (1 מקורות חדשים)',
    )
    expect(
      formatDigestMeta(
        {
          category: 'all',
          tldr: 'x',
          watch: [],
          itemCount: 80,
          generatedAt: '2026-09-06T09:00:00.000Z',
        },
        () => '06.09.2026, 12:00',
      ),
    ).toBe('על בסיס 80 עדכונים · 06.09.2026, 12:00')
  })
})
