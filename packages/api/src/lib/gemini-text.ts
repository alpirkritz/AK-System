/**
 * One-shot Gemini text call for small background jobs (rule suggestions, memory distilling).
 * Returns null when no key is configured or the call fails — callers must degrade gracefully.
 */
import { GoogleGenerativeAI } from '@google/generative-ai'

export type TextModel = (prompt: string) => Promise<string | null>

export function geminiTextModel(): TextModel {
  return async (prompt: string) => {
    const key = process.env.GEMINI_API_KEY
    if (!key) return null
    try {
      const model = new GoogleGenerativeAI(key).getGenerativeModel({
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      })
      const res = await model.generateContent(prompt)
      return res.response.text().trim() || null
    } catch (err) {
      console.warn('[gemini-text] call failed:', err instanceof Error ? err.message : err)
      return null
    }
  }
}

/** Pull the first JSON value out of a model reply (handles ```json fences). */
export function parseJsonReply(raw: string | null): unknown {
  if (!raw) return null
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = (fenced ? fenced[1] : raw).trim()
  const start = body.search(/[[{]/)
  if (start < 0) return null
  try {
    return JSON.parse(body.slice(start))
  } catch {
    return null
  }
}
