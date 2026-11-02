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
import { syncEmailThreads, type EmailHeaderMessage, type EmailSyncResult } from './email-sync'
import { ingestTeamsMessage, scanTeamsCommitments, upsertTeamsChat, type TeamsCommitmentScanResult } from './teams'

type Db = ReturnType<typeof getDb>

/**
 * Persist Outlook mail headers pushed from the bridge. Reuses the Gmail archive path by
 * feeding the posted messages through a one-shot fetcher, so matching, alias learning and
 * reply-need all behave exactly as they do for Gmail.
 */
export async function ingestWorkMail(db: Db, messages: EmailHeaderMessage[]): Promise<EmailSyncResult> {
  return syncEmailThreads(db, { fetch: async () => ({ messages, accountErrors: [] }) })
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
