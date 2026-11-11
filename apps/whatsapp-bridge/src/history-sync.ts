import type { proto } from '@whiskeysockets/baileys'
import type { DmQueuedMessage } from './dm-capture.js'
import type { BufferedGroupMessage } from './group-buffer.js'
import { extractText, messageTimestampMs, senderNameFor } from './message-fields.js'

/**
 * How far back a `messaging-history.set` payload is read. Re-pairing hands over far more than
 * this; anything older is dropped so a re-link does not pour an archive into the database.
 */
export const HISTORY_WINDOW_MS = 3 * 24 * 60 * 60 * 1000

/** Ids the bridge already queued, so history does not re-send what the live path captured. */
const capturedIds = new Map<string, number>()
const CAPTURED_ID_TTL_MS = HISTORY_WINDOW_MS + 24 * 60 * 60 * 1000
const CAPTURED_ID_MAX = 20_000

function pruneCapturedIds(): void {
  const cutoff = Date.now() - CAPTURED_ID_TTL_MS
  for (const [id, at] of capturedIds) {
    if (at < cutoff) capturedIds.delete(id)
  }
  while (capturedIds.size > CAPTURED_ID_MAX) {
    const oldest = capturedIds.keys().next().value
    if (!oldest) break
    capturedIds.delete(oldest)
  }
}

export function noteCapturedMessageId(id: string): void {
  if (!id) return
  pruneCapturedIds()
  capturedIds.set(id, Date.now())
}

export function wasMessageCaptured(id: string): boolean {
  pruneCapturedIds()
  return capturedIds.has(id)
}

export function clearCapturedMessageIds(): void {
  capturedIds.clear()
}

export interface HistoryIngestHandlers {
  isGroupWatched(groupJid: string): boolean
  capturedDm(remoteJid: string): { jid: string; altJid: string | null } | null
  queueGroupMessage(groupJid: string, message: BufferedGroupMessage): void
  queueDmMessage(message: DmQueuedMessage): void
  now?(): number
}

export interface HistoryIngestResult {
  groupMessages: number
  dmMessages: number
  duplicates: number
  outOfWindow: number
  ignored: number
}

/**
 * Queue history-sync messages onto the same persist queues the live path uses. Deliberately
 * does not touch the FOMO buffer or the rules engine: history is data, not an event, and must
 * never produce a reply, a Hugo call, or an alert.
 */
export function ingestHistoryMessages(
  messages: proto.IWebMessageInfo[],
  handlers: HistoryIngestHandlers,
): HistoryIngestResult {
  const now = handlers.now?.() ?? Date.now()
  const result: HistoryIngestResult = {
    groupMessages: 0,
    dmMessages: 0,
    duplicates: 0,
    outOfWindow: 0,
    ignored: 0,
  }

  for (const msg of messages) {
    const remoteJid = msg?.key?.remoteJid
    const id = msg?.key?.id
    const text = extractText(msg?.message).trim()
    const timestamp = msg ? messageTimestampMs(msg) : null
    if (!remoteJid || !id || !text || timestamp == null) {
      result.ignored++
      continue
    }
    if (now - timestamp > HISTORY_WINDOW_MS) {
      result.outOfWindow++
      continue
    }
    if (wasMessageCaptured(id)) {
      result.duplicates++
      continue
    }

    const dm = handlers.capturedDm(remoteJid)
    if (dm) {
      handlers.queueDmMessage({
        id,
        jid: dm.jid,
        altJid: dm.altJid,
        fromMe: !!msg.key?.fromMe,
        text,
        timestamp,
        historySync: true,
      })
      noteCapturedMessageId(id)
      result.dmMessages++
      continue
    }

    if (remoteJid.endsWith('@g.us') && handlers.isGroupWatched(remoteJid)) {
      const sender = msg.key?.participant || msg.participant || 'unknown'
      handlers.queueGroupMessage(remoteJid, {
        id,
        sender,
        senderName: senderNameFor(msg, sender),
        text,
        timestamp,
        historySync: true,
      })
      noteCapturedMessageId(id)
      result.groupMessages++
      continue
    }

    result.ignored++
  }

  return result
}
