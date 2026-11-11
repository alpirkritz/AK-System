/**
 * CFO Narrative — Hebrew LLM text synthesis for Personal CFO Module
 *
 * Follows finance-narrative.ts pattern: receives pre-computed facts, generates
 * Hebrew text (letters, summaries), hash-cached to avoid duplicate Gemini calls.
 *
 * Critical guardrail: LLM NEVER calculates. It only narrates facts.
 */

import { createHash } from 'node:crypto'
import { GoogleGenerativeAI } from '@google/generative-ai'

export type CfoNarrativeContext = 'leak' | 'debt' | 'liquidity' | 'pension' | 'monthly'

export interface CfoNarrativeInput {
  context: CfoNarrativeContext
  facts: Record<string, unknown>
  periodLabel?: string // e.g. "אוקטובר 2026"
}

export interface CfoNarrative {
  headline: string
  body: string
  actionItems?: string[]
  formalLetter?: string // for leak/pension negotiation
  model: string
}

const GUARDRAIL = `Calculate with code, don't estimate. Validate financial thresholds against 2026 Israeli regulations. Never invent numbers not present in the supplied facts.`

function getModel() {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY not set')
  const genAI = new GoogleGenerativeAI(key)
  return genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
}

export function hashInput(input: CfoNarrativeInput): string {
  const payload = JSON.stringify({ context: input.context, facts: sortKeys(input.facts) })
  return createHash('sha256').update(payload, 'utf8').digest('hex').substring(0, 16)
}

function sortKeys(obj: any): any {
  if (Array.isArray(obj)) return obj.map(sortKeys)
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortKeys(obj[key])
        return acc
      }, {} as any)
  }
  return obj
}

const CONTEXT_PROMPTS: Record<CfoNarrativeContext, string> = {
  leak: 'נתח חיובים חוזרים ודליפות. צור headline + body + actionItems בעברית. אם יש פריטים RENEGOTIATE, צור formalLetter מנומס.',
  debt: 'נתח תוכנית פירעון חובות (Avalanche). צור headline + body + actionItems בעברית.',
  liquidity: 'נתח הקצאת נזילות (3 שכבות + מיסוי). צור headline + body בעברית.',
  pension: 'נתח ביקורת פנסיה ועמלות. צור headline + body + formalLetter (אם יש עמלות מעל תקרה).',
  monthly: 'סכם סקירה חודשית (אנומליות + sweep + רשימה adversarial). צור headline + body + actionItems.',
}

export async function generateCfoNarrative(input: CfoNarrativeInput): Promise<CfoNarrative> {
  const model = getModel()

  const prompt = `${GUARDRAIL}

הקשר: ${CONTEXT_PROMPTS[input.context]}
תקופה: ${input.periodLabel || 'נוכחי'}

עובדות מחושבות (אל תשנה מספרים):
${JSON.stringify(input.facts, null, 2)}

החזר JSON בלבד:
{
  "headline": "כותרת בעברית",
  "body": "פסקה מפורטת בעברית",
  "actionItems": ["פעולה 1", "פעולה 2"],
  "formalLetter": "מכתב רשמי (אם רלוונטי)"
}
`

  try {
    const result = await model.generateContent(prompt)
    const text = result.response.text()

    // Try to parse JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        ...parsed,
        model: 'gemini-2.5-flash',
      }
    }

    // Fallback: plain text
    return {
      headline: 'סיכום CFO',
      body: text,
      model: 'gemini-2.5-flash',
    }
  } catch (error) {
    console.error('CFO narrative generation failed:', error)
    return {
      headline: 'שגיאה',
      body: 'לא ניתן לייצר נרטיב כרגע',
      model: 'gemini-2.5-flash',
    }
  }
}

export function isNarrativeConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY
}
