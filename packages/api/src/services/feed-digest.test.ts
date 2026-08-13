import { describe, expect, it } from 'vitest'
import { buildFeedDigestPrompt, parseFeedDigestJson, type FeedDigestItemInput } from './feed-digest'

const items: FeedDigestItemInput[] = [
  {
    title: 'Tesla deliveries beat',
    link: 'https://x.com/garyblack00/status/1',
    summary: 'Q deliveries higher than expected',
    sourceName: 'Gary Black',
    category: 'us_market',
    publishedAt: '2026-08-13T12:00:00.000Z',
  },
  {
    title: 'Fed holds rates',
    link: 'https://x.com/DeItaone/status/2',
    summary: 'No cut this meeting',
    sourceName: 'Walter Bloomberg',
    category: 'economics',
    publishedAt: '2026-08-13T11:00:00.000Z',
  },
]

describe('parseFeedDigestJson', () => {
  it('maps watch item indexes onto real titles and links', () => {
    const result = parseFeedDigestJson(
      JSON.stringify({
        tldr: 'פד בהמתנה וטסלה מפתיעה למעלה.',
        watch: [
          { item: 1, why: 'מכות תחזית משלוחים' },
          { item: 2, why: 'אין הורדת ריבית הקרובה' },
        ],
      }),
      items,
    )
    expect(result.tldr).toContain('טסלה')
    expect(result.watch).toHaveLength(2)
    expect(result.watch[0]).toMatchObject({
      title: 'Tesla deliveries beat',
      link: 'https://x.com/garyblack00/status/1',
      sourceName: 'Gary Black',
      why: 'מכות תחזית משלוחים',
    })
  })

  it('strips markdown fences and drops invalid indexes', () => {
    const result = parseFeedDigestJson(
      '```json\n{"tldr":"סיכום","watch":[{"item":9,"why":"אין"},{"item":2,"why":"פד"}]}\n```',
      items,
    )
    expect(result.tldr).toBe('סיכום')
    expect(result.watch).toHaveLength(1)
    expect(result.watch[0].title).toBe('Fed holds rates')
  })

  it('throws when tldr is missing', () => {
    expect(() => parseFeedDigestJson('{"watch":[]}', items)).toThrow(/tldr/)
  })
})

describe('buildFeedDigestPrompt', () => {
  it('numbers every item so the model can cite them', () => {
    const prompt = buildFeedDigestPrompt(items)
    expect(prompt).toContain('[1]')
    expect(prompt).toContain('[2]')
    expect(prompt).toContain('Tesla deliveries beat')
    expect(prompt).toContain('Gary Black')
  })
})
