import { afterEach, describe, expect, it } from 'vitest'
import {
  canonicalizeFeedLink,
  DEFAULT_FEED_SOURCES,
  MICHA_X_FEED_SOURCES,
  NEWS_FEED_SOURCES,
  twitterRssUrl,
} from './feed-fetcher'

const MICHA_HANDLES = [
  'TamirTiko2110',
  'theoptionoracle',
  'StocktonKatie',
  'verrone_chris',
  'CarterBWorth',
  'TrendSpider',
  'puppy_trades',
  'ThePupOfWallSt',
  'FSinsight',
  'fundstrat',
  'MarketRebels',
  'theflynews',
  'DeItaone',
  'LizThomasStrat',
  'AnastasiaAmoroso',
  'glassnode',
  'CathieDWood',
  'skorusARK',
  'urman_ali',
  'TashaARK',
  'will_summerlin',
  'yassine_elman',
  'ICannot_Enough',
  'robmaurer',
  'garyblack00',
  'CryptosRUs',
  'saylor',
  'real_vijay',
  'Tradytics',
  'ElonJet',
  'KellyCNBC',
  'TheDomino',
  'SaraEisen',
  'jimcramer',
  'GuyAdami',
  'jonnajarian',
  'PeteNajarian',
  'steveweisscnbc',
  'RiskReversal',
]

describe('twitterRssUrl', () => {
  const prev = process.env.TWITTER_RSS_BASE
  afterEach(() => {
    if (prev === undefined) delete process.env.TWITTER_RSS_BASE
    else process.env.TWITTER_RSS_BASE = prev
  })

  it('builds a nitter RSS URL and strips a leading @', () => {
    delete process.env.TWITTER_RSS_BASE
    expect(twitterRssUrl('@jimcramer')).toBe('https://nitter.net/jimcramer/rss')
    expect(twitterRssUrl('jimcramer')).toBe('https://nitter.net/jimcramer/rss')
  })

  it('uses TWITTER_RSS_BASE without a trailing slash', () => {
    process.env.TWITTER_RSS_BASE = 'https://rss.example.com/'
    expect(twitterRssUrl('saylor')).toBe('https://rss.example.com/saylor/rss')
  })
})

describe('canonicalizeFeedLink', () => {
  it('rewrites nitter.net post URLs to x.com', () => {
    expect(
      canonicalizeFeedLink('https://nitter.net/jimcramer/status/123'),
    ).toBe('https://x.com/jimcramer/status/123')
  })

  it('leaves non-nitter URLs unchanged', () => {
    expect(canonicalizeFeedLink('https://techcrunch.com/feed/item')).toBe(
      'https://techcrunch.com/feed/item',
    )
  })
})

describe('DEFAULT_FEED_SOURCES', () => {
  it('keeps the original news outlets', () => {
    const ids = NEWS_FEED_SOURCES.map((s) => s.id)
    expect(ids).toEqual(['calcalist', 'guardian-business', 'bbc-business', 'techcrunch'])
  })

  it('includes every Micha X handle as a default source', () => {
    const names = MICHA_X_FEED_SOURCES.map((s) => s.name)
    for (const handle of MICHA_HANDLES) {
      expect(names.some((n) => n.includes(`(@${handle})`)), handle).toBe(true)
    }
    expect(MICHA_X_FEED_SOURCES).toHaveLength(MICHA_HANDLES.length)
  })

  it('has unique ids and http(s) RSS urls', () => {
    const ids = DEFAULT_FEED_SOURCES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const src of DEFAULT_FEED_SOURCES) {
      expect(src.url.startsWith('http://') || src.url.startsWith('https://')).toBe(true)
    }
  })
})
