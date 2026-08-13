import { GoogleGenerativeAI, type GenerationConfig } from '@google/generative-ai'

export interface FeedDigestItemInput {
  title: string
  link: string
  summary?: string | null
  sourceName: string
  category: string
  publishedAt: string
}

export interface FeedDigestWatchItem {
  title: string
  why: string
  link: string
  sourceName: string
}

export interface FeedDigestResult {
  tldr: string
  watch: FeedDigestWatchItem[]
}

const MAX_WATCH = 7
const MAX_SNIPPET = 220

function geminiModelId(): string {
  return process.env.GEMINI_MODEL || 'gemini-2.5-flash'
}

function geminiGenerationConfig(): GenerationConfig {
  const model = geminiModelId()
  if (model.startsWith('gemini-3')) {
    const level = (process.env.GEMINI_THINKING_LEVEL || 'high').toLowerCase()
    return { thinkingConfig: { thinkingLevel: level } } as GenerationConfig
  }
  if (model.includes('2.5')) {
    const raw = process.env.GEMINI_THINKING_BUDGET?.trim()
    const budget = raw !== undefined && raw !== '' ? Number(raw) : -1
    return { thinkingConfig: { thinkingBudget: Number.isFinite(budget) ? budget : -1 } } as GenerationConfig
  }
  return {}
}

export function isFeedDigestConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY
}

export function formatFeedDigestItemLine(item: FeedDigestItemInput, index: number): string {
  const snippet = (item.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_SNIPPET)
  const date = item.publishedAt.slice(0, 16).replace('T', ' ')
  return `[${index}] ${date} | ${item.sourceName} | ${item.title}${snippet ? ` — ${snippet}` : ''}`
}

export function buildFeedDigestPrompt(items: FeedDigestItemInput[]): string {
  const lines = items.map((item, i) => formatFeedDigestItemLine(item, i + 1)).join('\n')
  return `You are briefing Alpir, a Hebrew-speaking investor/trader, on his personal news+X feed.

Read ALL of the numbered items. Write in Hebrew.

Respond in JSON only, no markdown, with:
1) "tldr": 2–4 short Hebrew sentences — the picture of the tape (macro, US market, names that keep repeating, crypto/Tesla if present). No greeting.
2) "watch": array of 3–7 objects, each { "item": <number from the list>, "why": <one Hebrew sentence: why he should pay attention> }.
   Pick catalysts, unusual claims, conflicting views, or things that can move a position. Skip filler/promos.
   "item" MUST be an integer that appears in the list.

Items:
${lines}
`
}

function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```json?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

export function parseFeedDigestJson(raw: string, items: FeedDigestItemInput[]): FeedDigestResult {
  const parsed = JSON.parse(stripFences(raw)) as {
    tldr?: unknown
    watch?: unknown
  }
  const tldr = typeof parsed.tldr === 'string' ? parsed.tldr.trim() : ''
  if (!tldr) throw new Error('Digest JSON had no tldr')

  const watch: FeedDigestWatchItem[] = []
  const seen = new Set<string>()
  if (Array.isArray(parsed.watch)) {
    for (const row of parsed.watch) {
      if (!row || typeof row !== 'object') continue
      const rec = row as { item?: unknown; why?: unknown; title?: unknown }
      const idx = typeof rec.item === 'number' ? rec.item : Number(rec.item)
      const source = Number.isInteger(idx) ? items[idx - 1] : undefined
      const why = typeof rec.why === 'string' ? rec.why.trim() : ''
      if (!source || !why) continue
      if (seen.has(source.link)) continue
      seen.add(source.link)
      watch.push({
        title: source.title,
        why,
        link: source.link,
        sourceName: source.sourceName,
      })
      if (watch.length >= MAX_WATCH) break
    }
  }

  return { tldr, watch }
}

export async function generateFeedDigest(items: FeedDigestItemInput[]): Promise<FeedDigestResult> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is not set')
  if (items.length === 0) throw new Error('No feed items to digest')

  const genAI = new GoogleGenerativeAI(key)
  const model = genAI.getGenerativeModel({
    model: geminiModelId(),
    generationConfig: geminiGenerationConfig(),
  })
  const raw = (await model.generateContent(buildFeedDigestPrompt(items))).response.text() ?? ''
  return parseFeedDigestJson(raw, items)
}
