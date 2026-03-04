import Parser from 'rss-parser'
import type { FeedSource, FeedItem } from '@ak-system/database'

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'AK-System-Feed/1.0' },
})

export interface RssItem {
  title: string
  link: string
  summary?: string
  publishedAt: string // ISO
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
      link: link.trim(),
      summary: item.contentSnippet?.trim() ?? item.content?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500) ?? undefined,
      publishedAt,
    })
  }
  return items
}

/**
 * מקורות העדכונים – ערוצי RSS.
 * כלכלסיט = calcalist.co.il (כתובת ה-XML הרשמית; עלולה להכשיל בחלק מהרשתות – אז אפשר להוסיף מקור מ-rss.app מדף "מקורות").
 * רויטרס ביטלה RSS רשמי – השתמשנו ב-BBC/Guardian במקום.
 * קטגוריות: economics | us_market | ai_tech | israel_market
 */
export const DEFAULT_FEED_SOURCES: Array<{ id: string; name: string; url: string; category: string }> = [
  { id: 'calcalist', name: 'כלכליסט', url: 'https://www.calcalist.co.il/Ext/Comp/AllDay/CdaAllDay_Iframe_XML/0,15172,L-0-0,00.html', category: 'economics' },
  { id: 'guardian-business', name: 'The Guardian Business', url: 'https://www.theguardian.com/business/rss', category: 'economics' },
  { id: 'bbc-business', name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', category: 'us_market' },
  { id: 'techcrunch', name: 'TechCrunch', url: 'https://techcrunch.com/feed/', category: 'ai_tech' },
]
