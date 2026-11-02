/**
 * Server-side ingest for the local work-comms bridge.
 *
 * The bridge runs on Alpir's Mac (the signed-in sessions are device-bound) and POSTs the
 * data it pulls to the production app on EC2, which persists it and runs the commitment
 * scan here — same split as the WhatsApp bridge (local capture → HTTP → server storage).
 * This keeps the Gemini keys and the single source-of-truth DB on the server; the Mac only
 * forwards rows.
 */
import type { getDb } from '@ak-system/database'
import {
  syncEmailThreads,
  knownEmailAddresses,
  extractAddresses,
  type EmailHeaderMessage,
  type EmailSyncResult,
} from './email-sync'
import { queueUnknownEmailSender } from './person-resolution'
import { ingestTeamsMessage, scanTeamsCommitments, upsertTeamsChat, type TeamsCommitmentScanResult } from './teams'

type Db = ReturnType<typeof getDb>

/** Cap how many unknown senders we queue per run so the first 30-day pull can't flood the review list. */
const MAX_SUGGESTED_SENDERS = 50

export interface WorkMailIngestResult extends EmailSyncResult {
  /** New non-contact senders queued for "add to People" review this run. */
  suggestedSenders: number
}

/** Parse a `"Name" <addr>` header into its display name, if present. */
function senderName(from: string): string | null {
  return from.match(/^\s*"?([^"<@]+?)"?\s*</)?.[1]?.trim() || null
}

/**
 * Persist Outlook mail headers pushed from the bridge. Reuses the Gmail archive path (matching,
 * alias learning, reply-need) for threads that touch a known person, then surfaces the remaining
 * real-human senders for "add to People" review — their mail archives once they're added.
 */
export async function ingestWorkMail(db: Db, messages: EmailHeaderMessage[]): Promise<WorkMailIngestResult> {
  const result = await syncEmailThreads(db, { fetch: async () => ({ messages, accountErrors: [] }) })

  // Surface senders we don't know yet (review-first; mail itself isn't stored for them).
  const known = await knownEmailAddresses(db)
  const freq = new Map<string, { name: string | null; count: number }>()
  for (const m of messages) {
    const account = m.accountEmail.toLowerCase()
    const addrs = extractAddresses(m.from)
    if (addrs.length === 0) continue
    const addr = addrs[0]! // the From address
    if (addr === account || known.has(addr)) continue
    const cur = freq.get(addr) ?? { name: senderName(m.from), count: 0 }
    cur.count++
    if (!cur.name) cur.name = senderName(m.from)
    freq.set(addr, cur)
  }

  const ranked = [...freq.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, MAX_SUGGESTED_SENDERS)
  let suggestedSenders = 0
  for (const [email, { name }] of ranked) {
    if (await queueUnknownEmailSender(db, { name: name ?? email, email, context: 'מייל עבודה' })) {
      suggestedSenders++
    }
  }
  return { ...result, suggestedSenders }
}

export interface WorkTeamsIngestPayload {
  chats: { chatId: string; topic: string | null; chatType: string; memberNames: string[] }[]
  messages: { chatId: string; messageId: string; fromName: string; fromEmail: string | null; text: string; ts: number }[]
}

export interface WorkTeamsIngestResult {
  chats: number
  stored: number
  scan: TeamsCommitmentScanResult
}

/** Persist Teams chats + messages pushed from the bridge, then scan for commitments. */
export async function ingestWorkTeams(db: Db, payload: WorkTeamsIngestPayload): Promise<WorkTeamsIngestResult> {
  for (const chat of payload.chats) {
    await upsertTeamsChat(db, chat)
  }
  let stored = 0
  for (const msg of payload.messages) {
    const r = await ingestTeamsMessage(db, msg)
    if (r.stored) stored++
  }
  const scan = await scanTeamsCommitments(db)
  return { chats: payload.chats.length, stored, scan }
}
