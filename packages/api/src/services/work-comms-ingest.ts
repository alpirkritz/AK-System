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
import { loadEmailMatchPool, matchEmailCandidate, queueUnknownEmailSender } from './person-resolution'
import { isSelfPersonName } from '../lib/self-identity'
import { ingestTeamsMessage, scanTeamsCommitments, upsertTeamsChat, type TeamsCommitmentScanResult } from './teams'

type Db = ReturnType<typeof getDb>

/** Cap how many unknown senders we queue per run so the first 30-day pull can't flood the review list. */
const MAX_SUGGESTED_SENDERS = 50

export interface WorkMailIngestResult extends EmailSyncResult {
  /** New non-contact correspondents (senders or recipients) queued for review this run. */
  suggestedSenders: number
}

/** Parse a `"Name" <addr>` header into its display name, if present. */
function senderName(from: string): string | null {
  return from.match(/^\s*"?([^"<@]+?)"?\s*</)?.[1]?.trim() || null
}

/** Each `Name <addr>` entry of a To/Cc header, split on commas outside quotes. */
export function headerEntries(header: string): { name: string | null; address: string }[] {
  const out: { name: string | null; address: string }[] = []
  for (const part of header.match(/(?:"[^"]*"|[^,])+/g) ?? []) {
    const [address] = extractAddresses(part)
    if (address) out.push({ address, name: senderName(part) })
  }
  return out
}

export interface Correspondent {
  email: string
  name: string | null
  /** Messages they sent me */
  sent: number
  /** Messages they appear on at all (From, To or Cc) */
  total: number
}

/**
 * Every address on these messages that isn't me or already known, ranked: people who write to
 * me above people I only write to, then by volume.
 */
export function rankUnknownCorrespondents(messages: EmailHeaderMessage[], known: Set<string>): Correspondent[] {
  const freq = new Map<string, Correspondent>()
  const note = (entry: { name: string | null; address: string }, account: string, isSender: boolean) => {
    if (entry.address === account || known.has(entry.address)) return
    const cur = freq.get(entry.address) ?? { email: entry.address, name: entry.name, sent: 0, total: 0 }
    if (isSender) cur.sent++
    cur.total++
    if (!cur.name) cur.name = entry.name
    freq.set(entry.address, cur)
  }
  for (const m of messages) {
    const account = m.accountEmail.toLowerCase()
    const [from] = headerEntries(m.from)
    if (from) note(from, account, true)
    for (const entry of [...headerEntries(m.to), ...headerEntries(m.cc)]) note(entry, account, false)
  }
  return [...freq.values()].sort((a, b) => b.sent - a.sent || b.total - a.total)
}

/**
 * Persist Outlook mail headers pushed from the bridge. Reuses the Gmail archive path (matching,
 * alias learning, reply-need) for threads that touch a known person, then surfaces the remaining
 * real-human correspondents — From, To and Cc — for review: "attach to X" when the name matches
 * an existing person, otherwise "add to People". Their mail archives once they're linked.
 */
export async function ingestWorkMail(db: Db, messages: EmailHeaderMessage[]): Promise<WorkMailIngestResult> {
  const result = await syncEmailThreads(db, { fetch: async () => ({ messages, accountErrors: [] }) })

  // Surface correspondents we don't know yet (review-first; mail itself isn't stored for them).
  const known = await knownEmailAddresses(db)
  const ranked = rankUnknownCorrespondents(messages, new Set(known.keys())).slice(0, MAX_SUGGESTED_SENDERS)
  const pool = await loadEmailMatchPool(db)
  const rows = pool.rows.filter((r) => !isSelfPersonName(r.name))
  let suggestedSenders = 0
  for (const { email, name, sent } of ranked) {
    const candidatePersonId = matchEmailCandidate({ name, address: email }, rows, pool.aliases)
    const context = sent > 0 ? 'מייל עבודה' : 'מייל עבודה · נמען/ת'
    if (await queueUnknownEmailSender(db, { name: name ?? email, email, context, candidatePersonId })) {
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
