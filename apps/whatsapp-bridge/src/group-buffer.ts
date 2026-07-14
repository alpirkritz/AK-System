export interface BufferedGroupMessage {
  id: string
  sender: string
  senderName: string
  text: string
  timestamp: number
}

const buffers = new Map<string, BufferedGroupMessage[]>()
const lastActivityAt = new Map<string, number>()
const MAX_MESSAGES_PER_GROUP = 500

/**
 * Persist queue — decoupled from the FOMO buffer above so messages are never
 * dropped by the 500-cap before they are flushed to the AK database.
 */
const persistQueues = new Map<string, BufferedGroupMessage[]>()
const MAX_PERSIST_QUEUE_PER_GROUP = 5000

export function bufferGroupMessage(groupJid: string, message: BufferedGroupMessage): void {
  const list = buffers.get(groupJid) ?? []
  list.push(message)
  if (list.length > MAX_MESSAGES_PER_GROUP) {
    list.splice(0, list.length - MAX_MESSAGES_PER_GROUP)
  }
  buffers.set(groupJid, list)
  const ts = message.timestamp < 1e12 ? message.timestamp * 1000 : message.timestamp
  const prev = lastActivityAt.get(groupJid) ?? 0
  if (ts >= prev) lastActivityAt.set(groupJid, ts)
}

export function getGroupLastActivity(groupJid: string): number | null {
  return lastActivityAt.get(groupJid) ?? null
}

export function getGroupBuffer(groupJid: string): BufferedGroupMessage[] {
  return buffers.get(groupJid) ?? []
}

export function clearGroupBuffer(groupJid: string): BufferedGroupMessage[] {
  const messages = getGroupBuffer(groupJid)
  buffers.set(groupJid, [])
  return messages
}

export function listGroups(): { groupJid: string; messageCount: number }[] {
  return Array.from(buffers.entries()).map(([groupJid, messages]) => ({
    groupJid,
    messageCount: messages.length,
  }))
}

export function enqueuePersistMessage(groupJid: string, message: BufferedGroupMessage): void {
  const list = persistQueues.get(groupJid) ?? []
  list.push(message)
  if (list.length > MAX_PERSIST_QUEUE_PER_GROUP) {
    list.splice(0, list.length - MAX_PERSIST_QUEUE_PER_GROUP)
  }
  persistQueues.set(groupJid, list)
}

export function hasPendingPersist(): boolean {
  for (const list of persistQueues.values()) {
    if (list.length > 0) return true
  }
  return false
}

/** Drain all pending persist messages, returning them grouped by JID and clearing the queues. */
export function drainPersistQueues(): { groupJid: string; messages: BufferedGroupMessage[] }[] {
  const out: { groupJid: string; messages: BufferedGroupMessage[] }[] = []
  for (const [groupJid, messages] of persistQueues.entries()) {
    if (messages.length > 0) out.push({ groupJid, messages })
  }
  persistQueues.clear()
  return out
}

/** Re-queue messages that failed to flush so they are retried on the next flush. */
export function requeuePersistMessages(groupJid: string, messages: BufferedGroupMessage[]): void {
  if (messages.length === 0) return
  const list = persistQueues.get(groupJid) ?? []
  persistQueues.set(groupJid, [...messages, ...list].slice(-MAX_PERSIST_QUEUE_PER_GROUP))
}

export function listWatchedGroupsWithCounts(watchJids: Set<string>): { groupJid: string; messageCount: number; watched: boolean }[] {
  const result = new Map<string, { groupJid: string; messageCount: number; watched: boolean }>()
  for (const jid of watchJids) {
    result.set(jid, { groupJid: jid, messageCount: getGroupBuffer(jid).length, watched: true })
  }
  for (const [jid, messages] of buffers.entries()) {
    if (!result.has(jid)) {
      result.set(jid, { groupJid: jid, messageCount: messages.length, watched: watchJids.has(jid) })
    }
  }
  return Array.from(result.values())
}
