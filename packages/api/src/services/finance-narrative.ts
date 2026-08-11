/**
 * The "what is actually going on underneath" paragraph, written by Gemini over the
 * deterministic engines' output. Mirrors whatsapp-insights.ts: self-contained, only runs
 * when GEMINI_API_KEY is set, JSON response with a plain-text fallback.
 *
 * The model gets facts and nothing else. It does not query the database, it does not do
 * arithmetic, and the prompt forbids any number that is not in the supplied facts — a number
 * in the narrative that is absent from `facts` is a bug, not a rounding difference.
 */
import { createHash } from 'node:crypto'
import { GoogleGenerativeAI, type GenerationConfig } from '@google/generative-ai'
import type { Insight } from './cashflow-analytics'

export type NarrativeScope = 'cashflow' | 'trading' | 'overview'

export interface NarrativeInput {
  scope: NarrativeScope
  /** Human label for the period the facts describe, e.g. 'אוגוסט 2026' or 'החודש האחרון'. */
  periodLabel: string
  /** Deterministic figures, already rounded and named. Serialized verbatim into the prompt. */
  facts: Record<string, unknown>
  insights: readonly Insight[]
}

export interface FinanceNarrative {
  headline: string
  body: string
  /** Cross-domain links the model spotted between the supplied facts. */
  connections: string[]
  /** What to keep an eye on next month. */
  watchlist: string[]
  model: string
}

const MAX_CHARS = 4000

const SCOPE_BRIEF: Record<NarrativeScope, string> = {
  cashflow: 'תזרים המזומנים האישי של המשתמש',
  trading: 'יומן המסחר של המשתמש',
  overview: 'התמונה הפיננסית הכוללת של המשתמש (בנק, תיק, מסלול, חשיפה מטבעית)',
}

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

function getModel() {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is not set')
  const genAI = new GoogleGenerativeAI(key)
  return genAI.getGenerativeModel({ model: geminiModelId(), generationConfig: geminiGenerationConfig() })
}

export function isNarrativeConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY
}

/**
 * Cache key for a narrative: same facts and same model means the same paragraph, so there is
 * no reason to pay Gemini twice. Object keys are sorted so property order cannot bust the cache.
 */
export function hashNarrativeInput(input: NarrativeInput): string {
  const payload = JSON.stringify({
    scope: input.scope,
    periodLabel: input.periodLabel,
    facts: stable(input.facts),
    insights: input.insights.map((i) => [i.id, i.kind, i.severity, i.amount]),
    model: geminiModelId(),
  })
  return createHash('sha256').update(payload).digest('hex').slice(0, 32)
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, stable(v)])
    )
  }
  return value
}

function buildPrompt(input: NarrativeInput): string {
  const insightLines = input.insights.length
    ? input.insights.map((i) => `- [${i.severity}/${i.kind}] ${i.title} — ${i.body}`).join('\n')
    : '- (אין תובנות דטרמיניסטיות בתקופה הזו)'

  return [
    `אתה אנליסט פיננסי אישי שכותב למשתמש על ${SCOPE_BRIEF[input.scope]} עבור: ${input.periodLabel}.`,
    'המטרה: להסביר מה באמת קורה מתחת לפני השטח — לחבר נקודות בין נתונים, לא לחזור עליהם.',
    'כתוב בעברית טבעית, ישירה, בגוף שני. בלי כותרות משנה ובלי בולטים בתוך ה-body.',
    '',
    'חוקים מחייבים:',
    '1. כל מספר שתכתוב חייב להופיע במדויק בעובדות שקיבלת. אסור לחשב, להעריך, לסכם או להמציא מספר חדש.',
    '2. אם נתון חסר או מסומן כלא אמין — אמור זאת במפורש במקום לנחש.',
    '3. אל תיתן ייעוץ השקעות או המלצות קנייה/מכירה. תאר דפוסים והשלכות בלבד.',
    '4. אם אין מספיק נתונים לאמירה משמעותית — אמור זאת בקצרה במקום למתוח את מה שיש.',
    '',
    'החזר JSON בלבד, בלי גדרות markdown, במבנה הזה:',
    '{"headline": "<משפט אחד, עד 90 תווים>", "body": "<2-4 משפטים שמסבירים את התמונה>", "connections": ["<קשר בין שני נתונים שונים>"], "watchlist": ["<מה לעקוב אחריו בהמשך>"]}',
    '',
    'עובדות (JSON):',
    JSON.stringify(input.facts),
    '',
    'תובנות דטרמיניסטיות שכבר חושבו:',
    insightLines,
  ].join('\n')
}

interface NarrativeJson {
  headline?: unknown
  body?: unknown
  connections?: unknown
  watchlist?: unknown
}

function toStringList(value: unknown, limit = 4): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .slice(0, limit)
}

/** Model output may arrive wrapped in ```json fences even when the prompt says otherwise. */
function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```json?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

export async function generateFinanceNarrative(input: NarrativeInput): Promise<FinanceNarrative> {
  const model = getModel()
  const prompt = buildPrompt(input)
  const modelId = geminiModelId()

  const raw = (await model.generateContent(prompt)).response.text()

  try {
    const parsed = JSON.parse(stripFences(raw)) as NarrativeJson
    const headline = typeof parsed.headline === 'string' ? parsed.headline.trim() : ''
    const body = typeof parsed.body === 'string' ? parsed.body.trim() : ''
    if (!headline && !body) throw new Error('Narrative JSON had no text')
    return {
      headline: (headline || body.split('\n')[0]).slice(0, 200),
      body: body.slice(0, MAX_CHARS),
      connections: toStringList(parsed.connections),
      watchlist: toStringList(parsed.watchlist),
      model: modelId,
    }
  } catch (err) {
    // A malformed envelope is not a reason to lose the analysis — keep the prose as the body.
    console.warn('[finance-narrative] JSON parse failed, falling back to text:', err)
    const text = stripFences(raw)
    if (!text) throw new Error('Empty narrative from Gemini')
    return {
      headline: text.split('\n')[0].slice(0, 200),
      body: text.slice(0, MAX_CHARS),
      connections: [],
      watchlist: [],
      model: modelId,
    }
  }
}
