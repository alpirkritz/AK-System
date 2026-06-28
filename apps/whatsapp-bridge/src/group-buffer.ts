export interface BufferedGroupMessage {
  id: string
  sender: string
  senderName: string
  text: string
  timestamp: number
}

const buffers = new Map<string, BufferedGroupMessage[]>()
const MAX_MESSAGES_PER_GROUP = 500

export function bufferGroupMessage(groupJid: string, message: BufferedGroupMessage): void {
  const list = buffers.get(groupJid) ?? []
  list.push(message)
  if (list.length > MAX_MESSAGES_PER_GROUP) {
    list.splice(0, list.length - MAX_MESSAGES_PER_GROUP)
  }
  buffers.set(groupJid, list)
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
