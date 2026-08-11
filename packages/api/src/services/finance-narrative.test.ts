import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const generateContent = vi.fn()

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent }
    }
  },
}))

import {
  generateFinanceNarrative,
  hashNarrativeInput,
  isNarrativeConfigured,
  type NarrativeInput,
} from './finance-narrative'
import type { Insight } from './cashflow-analytics'

function reply(text: string) {
  return { response: { text: () => text } }
}

const insight: Insight = {
  id: 'overspend:מזון',
  kind: 'overspend',
  severity: 'warn',
  title: 'מזון — ₪800 מעל הרגיל',
  body: 'הוצאת ₪3,000 החודש מול ממוצע ₪2,200.',
  amount: 800,
  category: 'מזון',
  href: null,
}

function input(over: Partial<NarrativeInput> = {}): NarrativeInput {
  return {
    scope: 'cashflow',
    periodLabel: 'אוגוסט 2026',
    facts: { income: 20000, expense: 15000, savingsRate: 25 },
    insights: [insight],
    ...over,
  }
}

beforeEach(() => {
  generateContent.mockReset()
  process.env.GEMINI_API_KEY = 'test-key'
})

afterEach(() => {
  delete process.env.GEMINI_API_KEY
})

describe('generateFinanceNarrative', () => {
  it('returns the structured narrative the model produced', async () => {
    generateContent.mockResolvedValue(
      reply(
        JSON.stringify({
          headline: 'החודש נשמר קצב חיסכון של 25%',
          body: 'ההכנסה עמדה על ₪20,000 מול הוצאה של ₪15,000.',
          connections: ['ההוצאה על מזון עלתה בדיוק בחודש שבו ההכנסה ירדה'],
          watchlist: ['מזון'],
        })
      )
    )

    const result = await generateFinanceNarrative(input())
    expect(result.headline).toBe('החודש נשמר קצב חיסכון של 25%')
    expect(result.body).toContain('₪20,000')
    expect(result.connections).toHaveLength(1)
    expect(result.watchlist).toEqual(['מזון'])
    expect(result.model).toBeTruthy()
  })

  it('accepts a response wrapped in markdown fences', async () => {
    generateContent.mockResolvedValue(
      reply('```json\n{"headline":"כותרת","body":"גוף","connections":[],"watchlist":[]}\n```')
    )
    const result = await generateFinanceNarrative(input())
    expect(result.headline).toBe('כותרת')
    expect(result.body).toBe('גוף')
  })

  it('keeps the prose when the model ignores the JSON envelope', async () => {
    generateContent.mockResolvedValue(reply('שורה ראשונה\nעוד פירוט על החודש.'))
    const result = await generateFinanceNarrative(input())
    expect(result.headline).toBe('שורה ראשונה')
    expect(result.body).toContain('עוד פירוט')
    expect(result.connections).toEqual([])
  })

  it('drops non-string entries from the lists instead of rendering them', async () => {
    generateContent.mockResolvedValue(
      reply(JSON.stringify({ headline: 'כותרת', body: 'גוף', connections: [null, 5, 'קשר אמיתי'], watchlist: 'לא מערך' }))
    )
    const result = await generateFinanceNarrative(input())
    expect(result.connections).toEqual(['קשר אמיתי'])
    expect(result.watchlist).toEqual([])
  })

  it('fails loudly when the model returns nothing at all', async () => {
    generateContent.mockResolvedValue(reply('   '))
    await expect(generateFinanceNarrative(input())).rejects.toThrow(/Empty narrative/)
  })

  it('refuses to run without an API key rather than returning a placeholder', async () => {
    delete process.env.GEMINI_API_KEY
    expect(isNarrativeConfigured()).toBe(false)
    await expect(generateFinanceNarrative(input())).rejects.toThrow(/GEMINI_API_KEY/)
  })

  it('sends the facts and the anti-invention rule to the model', async () => {
    generateContent.mockResolvedValue(reply(JSON.stringify({ headline: 'כ', body: 'ג' })))
    await generateFinanceNarrative(input())
    const prompt = generateContent.mock.calls[0][0] as string
    expect(prompt).toContain('"income":20000')
    expect(prompt).toContain('אסור לחשב, להעריך, לסכם או להמציא מספר חדש')
    expect(prompt).toContain(insight.title)
  })
})

describe('hashNarrativeInput', () => {
  it('is stable across property order', () => {
    const a = hashNarrativeInput(input({ facts: { income: 1, expense: 2 } }))
    const b = hashNarrativeInput(input({ facts: { expense: 2, income: 1 } }))
    expect(a).toBe(b)
  })

  it('changes when a fact changes', () => {
    const a = hashNarrativeInput(input({ facts: { income: 1 } }))
    const b = hashNarrativeInput(input({ facts: { income: 2 } }))
    expect(a).not.toBe(b)
  })

  it('changes when an insight amount changes', () => {
    const a = hashNarrativeInput(input())
    const b = hashNarrativeInput(input({ insights: [{ ...insight, amount: 900 }] }))
    expect(a).not.toBe(b)
  })

  it('changes with the scope and the period', () => {
    expect(hashNarrativeInput(input())).not.toBe(hashNarrativeInput(input({ scope: 'trading' })))
    expect(hashNarrativeInput(input())).not.toBe(hashNarrativeInput(input({ periodLabel: 'יולי 2026' })))
  })
})
