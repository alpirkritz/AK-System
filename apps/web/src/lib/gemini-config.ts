import type { GenerationConfig } from '@google/generative-ai'

/** Default model — Gemini 2.5 Flash supports extended thinking via thinkingBudget. */
export function getGeminiModelId(): string {
  return process.env.GEMINI_MODEL || 'gemini-2.5-flash'
}

/**
 * Extended thinking config for Gemini API.
 * - Gemini 3.x: thinkingLevel (default `high` = extended/deep reasoning)
 * - Gemini 2.5: thinkingBudget (default `-1` = dynamic extended thinking)
 */
export function getGeminiGenerationConfig(): GenerationConfig {
  const model = getGeminiModelId()
  const level = (process.env.GEMINI_THINKING_LEVEL || 'high').toLowerCase()
  const budgetRaw = process.env.GEMINI_THINKING_BUDGET?.trim()
  const budget = budgetRaw !== undefined && budgetRaw !== '' ? Number(budgetRaw) : -1

  if (model.startsWith('gemini-3')) {
    return { thinkingConfig: { thinkingLevel: level } } as GenerationConfig
  }

  if (model.includes('2.5')) {
    return {
      thinkingConfig: {
        thinkingBudget: Number.isFinite(budget) ? budget : -1,
      },
    } as GenerationConfig
  }

  return {}
}

export function getGeminiModelOptions(): { model: string; generationConfig: GenerationConfig } {
  return {
    model: getGeminiModelId(),
    generationConfig: getGeminiGenerationConfig(),
  }
}

/** Fallback without extended thinking — used when API times out on complex requests. */
export function getGeminiModelOptionsFast(): { model: string; generationConfig: GenerationConfig } {
  return { model: getGeminiModelId(), generationConfig: {} }
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/** Gemini requires history to start with user and alternate roles. */
export function sanitizeChatHistory(history: ChatTurn[]): ChatTurn[] {
  let turns = history.filter((t) => t.content?.trim())

  while (turns.length > 0 && turns[0]?.role === 'assistant') {
    turns = turns.slice(1)
  }

  const merged: ChatTurn[] = []
  for (const turn of turns) {
    const last = merged[merged.length - 1]
    if (last && last.role === turn.role) {
      last.content = `${last.content}\n\n${turn.content}`
    } else {
      merged.push({ ...turn })
    }
  }

  while (merged.length > 0 && merged[merged.length - 1]?.role === 'user') {
    merged.pop()
  }

  return merged.slice(-8)
}
