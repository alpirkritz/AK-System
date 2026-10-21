/**
 * Whether a stored email thread is something to answer.
 *
 * Deterministic rules run first. Anything left over is one Gemini label
 * (`needs_reply` | `fyi` | `chatter`). A missing key or a failed call returns null
 * so the caller can leave the thread unlabeled — silence beats a false "reply owed".
 */
import { GoogleGenerativeAI } from '@google/generative-ai'

export type ReplyNeed = 'needs_reply' | 'fyi' | 'chatter'

/** Same automated-sender pattern as calendar participant filtering. */
const BOT_FROM = /meetingbot|teams@teams\.|noreply|no-reply|calendar\.google|zoom\.us|resource\.calendar/i
const FYI_TEXT = /fyi|לידיעה|לעיונך|לעיון|newsletter|unsubscribe/i
const ASK_TEXT = /[?？]|תוכל|אפשר|אשמח|\bplease\b/i

const LABELS = new Set<ReplyNeed>(['needs_reply', 'fyi', 'chatter'])

export function deterministicReplyNeed(input: {
  from: string
  subject: string
  snippet: string | null
  commitmentLinked: boolean
}): ReplyNeed | null {
  const text = `${input.subject}\n${input.snippet ?? ''}`
  if (BOT_FROM.test(input.from) || FYI_TEXT.test(text)) return 'fyi'
  if (input.commitmentLinked || ASK_TEXT.test(text)) return 'needs_reply'
  return null
}

/** Classify an ambiguous subject+snippet. Null means "do not alert". */
export async function classifyAmbiguousReplyNeed(
  subject: string,
  snippet: string | null,
): Promise<ReplyNeed | null> {
  const key = process.env.GEMINI_API_KEY
  if (!key) return null
  try {
    const model = new GoogleGenerativeAI(key).getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    })
    const result = await model.generateContent(
      `Classify this email as exactly one token: needs_reply, fyi, or chatter.\n` +
        `needs_reply = the sender asks the recipient to do or answer something.\n` +
        `fyi = informational, no reply expected.\n` +
        `chatter = social small talk with no ask.\n` +
        `Subject: ${subject}\nSnippet: ${snippet ?? ''}`,
    )
    const raw = result.response.text().trim().toLowerCase()
    const hit = [...LABELS].find((label) => raw.includes(label))
    return hit ?? null
  } catch (err) {
    console.warn('[email-reply-need] classify failed:', err)
    return null
  }
}
