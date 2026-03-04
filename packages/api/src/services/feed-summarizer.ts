/**
 * Optional Gemini-based summarization and tagging for feed items.
 * Only runs when GEMINI_API_KEY is set.
 */
import { GoogleGenerativeAI } from '@google/generative-ai'

const CATEGORIES = ['economics', 'us_market', 'ai_tech', 'israel_market'] as const
export type FeedCategory = (typeof CATEGORIES)[number]

export interface SummarizeResult {
  summary: string | null
  tags: string[] // subset of CATEGORIES
}

export async function summarizeWithGemini(
  title: string,
  existingSummary?: string | null
): Promise<SummarizeResult> {
  const key = process.env.GEMINI_API_KEY
  if (!key) return { summary: null, tags: [] }

  const genAI = new GoogleGenerativeAI(key)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

  const text = existingSummary ? `${title}\n\n${existingSummary}` : title
  const prompt = `You are classifying and summarizing a news headline (and optional short excerpt) for a personal feed.

Categories (use only these exact IDs, one or more): economics, us_market, ai_tech, israel_market.
- economics: general economy, macro, policy
- us_market: US stock market, indices, US companies
- ai_tech: technology, AI, practical tools, startups
- israel_market: Israeli stock market, Israeli economy

Respond in JSON only, no markdown, with two keys:
1) "summary": a very short Hebrew summary in 1-2 sentences (or null if the title is enough)
2) "tags": array of category IDs that apply (e.g. ["us_market","ai_tech"])

Text to classify:
---
${text.slice(0, 2000)}
---`

  try {
    const result = await model.generateContent(prompt)
    const response = result.response
    const raw = response.text()?.trim() ?? ''
    const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(jsonStr) as { summary?: string | null; tags?: string[] }
    const tags = Array.isArray(parsed.tags)
      ? (parsed.tags as string[]).filter((t) => CATEGORIES.includes(t as FeedCategory))
      : []
    const summary =
      typeof parsed.summary === 'string' && parsed.summary.length > 0 ? parsed.summary : null
    return { summary, tags }
  } catch (err) {
    console.warn('[feed-summarizer] Gemini error:', err)
    return { summary: null, tags: [] }
  }
}
