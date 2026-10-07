import type { proto } from '@whiskeysockets/baileys'

export function extractText(message: proto.IMessage | null | undefined): string {
  if (!message) return ''
  if (message.conversation) return message.conversation
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text
  if (message.imageMessage?.caption) return message.imageMessage.caption
  return ''
}

/** Baileys reports message time in seconds; everything downstream expects ms. */
export function messageTimestampMs(msg: proto.IWebMessageInfo): number | null {
  const raw = Number(msg.messageTimestamp)
  if (!Number.isFinite(raw) || raw <= 0) return null
  return Math.round(raw < 1e12 ? raw * 1000 : raw)
}

export function senderNameFor(msg: proto.IWebMessageInfo, sender: string): string {
  return msg.pushName?.trim() || sender.split('@')[0] || sender
}
