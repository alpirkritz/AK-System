import Parser from 'rss-parser'

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'AK-System-Feed/1.0' },
})

export type FeedCategory = 'economics' | 'us_market' | 'ai_tech' | 'israel_market'

export interface RssItem {
  title: string
  link: string
  summary?: string
  publishedAt: string // ISO
}

export interface DefaultFeedSource {
  id: string
  name: string
  url: string
  category: FeedCategory
}

const DEFAULT_TWITTER_RSS_BASE = 'https://nitter.net'

/** Base host for X/Twitter RSS (Nitter-style `/{handle}/rss`). No trailing slash. */
export function twitterRssBase(): string {
  const raw = process.env.TWITTER_RSS_BASE?.trim() || DEFAULT_TWITTER_RSS_BASE
  return raw.replace(/\/+$/, '')
}

export function twitterRssUrl(handle: string): string {
  const h = handle.replace(/^@/, '').trim()
  return `${twitterRssBase()}/${h}/rss`
}

/** Point nitter item URLs at x.com so the feed opens the real post. */
export function canonicalizeFeedLink(link: string): string {
  try {
    const u = new URL(link)
    if (u.hostname === 'nitter.net' || u.hostname.endsWith('.nitter.net')) {
      u.protocol = 'https:'
      u.hostname = 'x.com'
      return u.toString()
    }
  } catch {
    /* keep original */
  }
  return link
}

export async function fetchRssFeed(url: string): Promise<RssItem[]> {
  const feed = await parser.parseURL(url)
  const items: RssItem[] = []
  for (const item of feed.items ?? []) {
    const link = item.link ?? item.guid
    if (!link || !item.title) continue
    let publishedAt = new Date().toISOString()
    if (item.pubDate) {
      const d = new Date(item.pubDate)
      if (!isNaN(d.getTime())) publishedAt = d.toISOString()
    }
    items.push({
      title: item.title.trim(),
      link: canonicalizeFeedLink(link.trim()),
      summary: item.contentSnippet?.trim() ?? item.content?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500) ?? undefined,
      publishedAt,
    })
  }
  return items
}

function xSource(
  handle: string,
  name: string,
  category: FeedCategory,
): DefaultFeedSource {
  const h = handle.replace(/^@/, '')
  return {
    id: `x-${h.toLowerCase()}`,
    name: `${name} (@${h})`,
    url: twitterRssUrl(h),
    category,
  }
}

/**
 * מקורות העדכונים – ערוצי RSS.
 * כלכלסיט = calcalist.co.il (כתובת ה-XML הרשמית; עלולה להכשיל בחלק מהרשתות – אז אפשר להוסיף מקור מ-rss.app מדף "מקורות").
 * רויטרס ביטלה RSS רשמי – השתמשנו ב-BBC/Guardian במקום.
 * חשבונות X מגיעים מ-Nitter (`TWITTER_RSS_BASE`, ברירת מחדל nitter.net).
 * קטגוריות: economics | us_market | ai_tech | israel_market
 */
export const NEWS_FEED_SOURCES: DefaultFeedSource[] = [
  { id: 'calcalist', name: 'כלכליסט', url: 'https://www.calcalist.co.il/Ext/Comp/AllDay/CdaAllDay_Iframe_XML/0,15172,L-0-0,00.html', category: 'economics' },
  { id: 'guardian-business', name: 'The Guardian Business', url: 'https://www.theguardian.com/business/rss', category: 'economics' },
  { id: 'bbc-business', name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', category: 'us_market' },
  { id: 'techcrunch', name: 'TechCrunch', url: 'https://techcrunch.com/feed/', category: 'ai_tech' },
]

/** Micha watchlist — technical analysis / setups. */
const MICHA_TECHNICAL: Array<[string, string]> = [
  ['TamirTiko2110', 'Tamir T.'],
  ['theoptionoracle', 'AJ Monte'],
  ['StocktonKatie', 'Katie Stockton'],
  ['verrone_chris', 'Chris Verrone'],
  ['CarterBWorth', 'Carter Braxton Worth'],
  ['TrendSpider', 'Jake Wujastyk / TrendSpider'],
  ['puppy_trades', 'PuppyTrades'],
  ['ThePupOfWallSt', 'Danny Naz'],
]

/** Micha watchlist — macro, news, market research. */
const MICHA_MACRO: Array<[string, string, FeedCategory]> = [
  ['FSinsight', 'FSInsight', 'us_market'],
  ['fundstrat', 'Tom Lee', 'us_market'],
  ['MarketRebels', 'Market Rebellion', 'us_market'],
  ['theflynews', 'The Fly', 'economics'],
  ['DeItaone', 'Walter Bloomberg', 'economics'],
  ['LizThomasStrat', 'Liz Young Thomas (SoFi)', 'economics'],
  ['AnastasiaAmoroso', 'Anastasia Amoroso', 'economics'],
  ['glassnode', 'Glassnode', 'us_market'],
]

/** Micha watchlist — ARK Invest. */
const MICHA_ARK: Array<[string, string]> = [
  ['CathieDWood', 'Cathie Wood'],
  ['skorusARK', 'Sam Korus'],
  ['urman_ali', 'Ali Urman'],
  ['TashaARK', 'Tasha Keeney'],
  ['will_summerlin', 'Will Summerlin'],
  ['yassine_elman', 'Yassine Elmandjra'],
]

/** Micha watchlist — Tesla, crypto, data bots. */
const MICHA_NAMES: Array<[string, string]> = [
  ['ICannot_Enough', 'James Stephenson'],
  ['robmaurer', 'Rob Maurer (Tesla Daily)'],
  ['garyblack00', 'Gary Black'],
  ['CryptosRUs', 'CryptosRus'],
  ['saylor', 'Michael Saylor'],
  ['real_vijay', 'Vijay Boyapati'],
  ['Tradytics', 'Tradytics'],
  ['ElonJet', "Elon Musk's Jet"],
]

/** Micha watchlist — CNBC presenters. */
const MICHA_CNBC: Array<[string, string]> = [
  ['KellyCNBC', 'Kelly Evans'],
  ['TheDomino', 'Dominic Chu'],
  ['SaraEisen', 'Sara Eisen'],
  ['jimcramer', 'Jim Cramer'],
  ['GuyAdami', 'Guy Adami'],
  ['jonnajarian', 'Jon Najarian'],
  ['PeteNajarian', 'Pete Najarian'],
  ['steveweisscnbc', 'Steve Weiss'],
  ['RiskReversal', 'Dan Nathan'],
]

export const MICHA_X_FEED_SOURCES: DefaultFeedSource[] = [
  ...MICHA_TECHNICAL.map(([handle, name]) => xSource(handle, name, 'us_market')),
  ...MICHA_MACRO.map(([handle, name, category]) => xSource(handle, name, category)),
  ...MICHA_ARK.map(([handle, name]) => xSource(handle, name, 'ai_tech')),
  ...MICHA_NAMES.map(([handle, name]) => xSource(handle, name, 'us_market')),
  ...MICHA_CNBC.map(([handle, name]) => xSource(handle, name, 'us_market')),
]

export const DEFAULT_FEED_SOURCES: DefaultFeedSource[] = [
  ...NEWS_FEED_SOURCES,
  ...MICHA_X_FEED_SOURCES,
]
