/**
 * Gemini-based insight generation over persisted WhatsApp group messages.
 * Self-contained (mirrors feed-summarizer.ts) so tRPC procedures can call it
 * directly. Only runs when GEMINI_API_KEY is set.
 */
import { GoogleGenerativeAI, type GenerationConfig } from '@google/generative-ai'
import { getDefaultTimezone } from '../lib/calendar-dates'

export type GroupInsightMode = 'summary' | 'topics' | 'style'

export interface InsightMessage {
  senderName: string
  text: string
  ts: number
}

export interface DigestGroupInput {
  groupJid: string
  name: string
  priority: number
  messages: InsightMessage[]
}

export interface DigestItem {
  groupJid: string
  name: string
  priority: number
  score: number
  messageCount: number
  topic: string | null
}

export interface CrossGroupDigestResult {
  text: string
  items: DigestItem[]
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

/** Message lines for the prompt, timestamped in the system timezone (not the server's UTC). */
function formatLines(messages: InsightMessage[]): string {
  const timeZone = getDefaultTimezone()
  return messages
    .map((m) => {
      const time = new Date(m.ts).toLocaleString('he-IL', {
        timeZone,
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
      return `[${time}] ${m.senderName}: ${m.text}`
    })
    .join('\n')
}

const MODE_PROMPTS: Record<GroupInsightMode, (name: string) => string[]> = {
  summary: (name) => [
    `A friend is briefing the user about what happened in the WhatsApp group "${name}".`,
    'Write in natural spoken Hebrew (unless most messages are in English).',
    'Sound like a friend telling you over coffee — not a report, no bullet points, no labels.',
    'Cover naturally: what the conversation was about, what people discussed, any outcome or decision, and the overall vibe.',
    '3–6 short sentences. Do not invent facts not in the messages. Do not quote long excerpts.',
    'If nothing meaningful happened, say that plainly in a casual tone.',
  ],
  topics: (name) => [
    `Analyze the WhatsApp group "${name}" and tell the user what is being discussed.`,
    'Write in Hebrew (unless most messages are in English).',
    'Structure: a short opening line, then 3–6 bullet points — each a distinct topic or open thread.',
    'For each topic note if there is a decision, an open question, or something that needs the user\'s attention.',
    'Be concrete and grounded in the messages. Do not invent facts.',
  ],
  style: (name) => [
    `Study the WhatsApp group "${name}" over this period and produce insight about it, not just a summary.`,
    'Write in Hebrew (unless most messages are in English).',
    'Cover: recurring themes, the tone/vibe, who drives the conversation, and any patterns you notice over time.',
    'Then add YOUR OWN original observations and suggestions, clearly framed as your opinion (e.g. "לדעתי", "שווה לשים לב").',
    'Keep it insightful and specific. Do not invent facts about people; base patterns on the messages.',
  ],
}

/** Generate a per-group insight (summary / topics / style) in Hebrew. */
export async function generateGroupInsight(
  displayName: string,
  messages: InsightMessage[],
  mode: GroupInsightMode,
  rangeLabel?: string,
): Promise<string> {
  if (messages.length === 0) {
    return rangeLabel
      ? `אין הודעות בקבוצה בטווח הזה (${rangeLabel}).`
      : 'אין הודעות בקבוצה בטווח הזמן שנבחר.'
  }
  const model = getModel()
  const prompt = [
    ...MODE_PROMPTS[mode](displayName),
    ...(rangeLabel
      ? [
          `The messages below cover exactly this period: ${rangeLabel} (Israel local time, timestamps shown as DD.MM, HH:MM).`,
          'Only describe what happened in this period. Do not claim anything about times outside it.',
        ]
      : []),
    '',
    'Messages:',
    formatLines(messages),
  ].join('\n')

  const result = await model.generateContent(prompt)
  const body = result.response.text().trim()
  if (!body) throw new Error('Empty insight from Gemini')
  return body.slice(0, 60000)
}

interface DigestJson {
  narrative?: string
  items?: { group?: string; topic?: string }[]
}

/**
 * Generate a single prioritized briefing across multiple groups.
 * Groups should be pre-sorted by importance (highest first). Returns a Hebrew
 * narrative plus per-group topic lines merged back into the caller's metadata.
 */
export async function generateCrossGroupDigest(
  groups: (DigestGroupInput & { score: number })[],
  rangeLabel?: string,
): Promise<CrossGroupDigestResult> {
  const withMessages = groups.filter((g) => g.messages.length > 0)
  if (withMessages.length === 0) {
    return { text: 'אין פעילות חדשה בקבוצות שאתה עוקב אחריהן בטווח הזה.', items: [] }
  }

  const model = getModel()
  const priorityLabel = (p: number) => (p >= 2 ? 'קריטי' : p === 1 ? 'חשוב' : 'רגיל')

  const blocks = withMessages
    .map((g) => {
      const header = `=== קבוצה: ${g.name} (עדיפות: ${priorityLabel(g.priority)}, ${g.messages.length} הודעות) ===`
      return `${header}\n${formatLines(g.messages.slice(-120))}`
    })
    .join('\n\n')

  const prompt = [
    rangeLabel
      ? `You are giving the user a single briefing about their WhatsApp groups for exactly this period: ${rangeLabel} (Israel local time, timestamps shown as DD.MM, HH:MM). Only describe what happened in this period.`
      : 'You are giving the user a single briefing answering "what is happening right now in my WhatsApp groups".',
    'Write in natural spoken Hebrew (unless most messages are in English).',
    'Rank by importance: the user marked some groups as חשוב/קריטי — weight those higher, and weight bursts of activity higher.',
    'Connect related topics that span multiple groups (if the same event/person/subject appears in more than one group, say so).',
    'Flag anything that needs the user to respond or act. End with a one-line tail about quiet/low-signal groups if any.',
    'Do not invent facts not present in the messages.',
    '',
    'Respond in JSON only, no markdown fences, with this shape:',
    '{"narrative": "<the spoken-Hebrew briefing, a few short paragraphs>", "items": [{"group": "<exact group name>", "topic": "<one short Hebrew line: what is happening there now>"}]}',
    '',
    'Groups and messages:',
    blocks,
  ].join('\n')

  let narrative = ''
  const topicByName = new Map<string, string>()
  try {
    const result = await model.generateContent(prompt)
    const raw = result.response.text().trim()
    const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(jsonStr) as DigestJson
    narrative = typeof parsed.narrative === 'string' ? parsed.narrative.trim() : ''
    if (Array.isArray(parsed.items)) {
      for (const it of parsed.items) {
        if (it?.group && it?.topic) topicByName.set(String(it.group).trim(), String(it.topic).trim())
      }
    }
  } catch (err) {
    console.warn('[whatsapp-insights] digest JSON parse failed, falling back to text:', err)
    // Fall back to a plain-text second attempt without JSON.
    try {
      const result = await model.generateContent(
        prompt.replace(/Respond in JSON[\s\S]*?Groups and messages:/, 'Groups and messages:'),
      )
      narrative = result.response.text().trim()
    } catch (err2) {
      throw err2 instanceof Error ? err2 : new Error('Digest generation failed')
    }
  }

  if (!narrative) narrative = 'לא הצלחתי לנסח סיכום כרגע, נסה שוב.'

  const items: DigestItem[] = withMessages.map((g) => ({
    groupJid: g.groupJid,
    name: g.name,
    priority: g.priority,
    score: g.score,
    messageCount: g.messages.length,
    topic: topicByName.get(g.name.trim()) ?? null,
  }))

  return { text: narrative.slice(0, 60000), items }
}
