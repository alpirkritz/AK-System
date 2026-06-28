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
