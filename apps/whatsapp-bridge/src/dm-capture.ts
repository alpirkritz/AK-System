import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import pino from 'pino'
import { configFilePath, resolveConfigFileForRead } from './config-store.js'
import { bareUserJid } from './self-chat.js'

const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

/**
 * 1:1 chats the owner opted in on a person card. Anything not on this list is never
 * forwarded; the AK ingest checks the list again on its side.
 */
let allowlist = new Set<string>()
/** `@lid` chat → phone JID, learned from the stanza WhatsApp attaches to each message. */
const lidToPhone = new Map<string, string>()

export interface DmQueuedMessage {
  id: string
  jid: string
  altJid: string | null
  fromMe: boolean
  text: string
  timestamp: number
  /** Set when the message came from a history sync, so AK can skip reply/notification paths. */
  historySync?: boolean
}

const queue: DmQueuedMessage[] = []
const queuedIds = new Set<string>()
const MAX_QUEUE = 5000

const DM_CONFIG_FILE = 'dm-config.json'
const DM_LID_MAP_FILE = 'dm-lid-map.json'

function persistPath(): string {
  return configFilePath(DM_CONFIG_FILE)
}

function lidMapPath(): string {
  return configFilePath(DM_LID_MAP_FILE)
}

export function loadPersistedDmConfig(): void {
  try {
    const file = resolveConfigFileForRead(DM_CONFIG_FILE)
    if (!existsSync(file)) {
      logger.warn({ file }, 'No DM capture allowlist on disk — every private chat will be ignored')
      return
    }
    const jids = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (!Array.isArray(jids)) return
    allowlist = new Set(jids.map((j) => bareUserJid(String(j))))
    if (allowlist.size === 0) {
      logger.warn({ file }, 'DM capture allowlist is empty — every private chat will be ignored')
    } else {
      logger.info({ count: allowlist.size }, 'Restored DM capture allowlist')
    }
  } catch (err) {
    logger.error({ err }, 'Failed to load DM capture allowlist')
  }
  try {
    const raw = JSON.parse(readFileSync(resolveConfigFileForRead(DM_LID_MAP_FILE), 'utf8')) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
    for (const [lid, phone] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof phone !== 'string') continue
      rememberLidPhone(lid, phone, false)
    }
    logger.info({ count: lidToPhone.size }, 'Restored DM lid map')
  } catch {
    // No map yet.
  }
}

export function reloadDmConfig(jids: string[]): number {
  allowlist = new Set(jids.map((j) => bareUserJid(j)).filter((j) => j.includes('@') && !j.endsWith('@g.us')))
  try {
    const file = persistPath()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify([...allowlist]), 'utf8')
  } catch (err) {
    logger.error({ err }, 'Failed to persist DM capture allowlist')
  }
  return allowlist.size
}

export function dmAllowlistSize(): number {
  return allowlist.size
}

export function clearLearnedLids(): void {
  lidToPhone.clear()
}

/** Remember that an `@lid` chat is this phone. Ignores anything that is not that pair. */
export function rememberLidPhone(lid: string, phone: string, persist = true): void {
  const bareLid = bareUserJid(lid)
  const barePhone = bareUserJid(phone)
  if (!bareLid.endsWith('@lid') || !barePhone.endsWith('@s.whatsapp.net')) return
  if (lidToPhone.get(bareLid) === barePhone) return
  lidToPhone.set(bareLid, barePhone)
  if (!persist) return
  try {
    const file = lidMapPath()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(Object.fromEntries(lidToPhone)), 'utf8')
  } catch (err) {
    logger.error({ err }, 'Failed to persist LID map')
  }
}

/**
 * Pair the hidden chat id on a raw WhatsApp stanza with the phone number WhatsApp
 * sends beside it. `sender_pn` belongs to `from`, `peer_recipient_pn` to `recipient`.
 */
export function noteLidPhoneFromStanza(attrs: Record<string, string | undefined>): void {
  const before = lidToPhone.size
  const pairs: Array<[string | undefined, string | undefined]> = [
    [attrs.from, attrs.sender_pn],
    [attrs.recipient, attrs.peer_recipient_pn],
    [attrs.participant, attrs.participant_pn],
  ]
  for (const [lid, phone] of pairs) {
    if (lid && phone) rememberLidPhone(lid, phone)
  }
  const from = attrs.from ? bareUserJid(attrs.from) : ''
  if (from.endsWith('@lid') && !lidToPhone.has(from)) {
    logger.info({ attrs: Object.keys(attrs) }, 'LID chat without a phone pair')
  } else if (lidToPhone.size > before) {
    logger.info({ mapped: lidToPhone.size }, 'Learned a private-chat phone')
  }
}

export interface ContactLike {
  id: string
  lid?: string
}

/** Phone JID behind an `@lid` chat, from the contact store; null when unknown. */
export function phoneJidForLid(lidJid: string, contacts: Iterable<ContactLike>): string | null {
  const target = bareUserJid(lidJid)
  for (const c of contacts) {
    if (c.lid && bareUserJid(c.lid) === target && c.id.endsWith('@s.whatsapp.net')) return bareUserJid(c.id)
  }
  return null
}

/**
 * The chat's identity for capture, or null when it is not allowlisted. Groups and self-chat
 * are never captured here.
 */
export function resolveCapturedDm(
  remoteJid: string,
  contacts: Iterable<ContactLike>,
  isSelfChat: (jid: string) => boolean,
): { jid: string; altJid: string | null } | null {
  if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast') || isSelfChat(remoteJid)) return null
  if (allowlist.size === 0) return null
  const bare = bareUserJid(remoteJid)
  const phone = bare.endsWith('@lid') ? (phoneJidForLid(bare, contacts) ?? lidToPhone.get(bare) ?? null) : null
  if (phone && allowlist.has(phone)) return { jid: phone, altJid: bare }
  if (allowlist.has(bare)) return { jid: bare, altJid: phone }
  return null
}

export function enqueueDmMessage(message: DmQueuedMessage): void {
  if (queuedIds.has(message.id)) return
  queuedIds.add(message.id)
  queue.push(message)
  if (queue.length > MAX_QUEUE) {
    for (const dropped of queue.splice(0, queue.length - MAX_QUEUE)) queuedIds.delete(dropped.id)
  }
}

export function drainDmQueue(): DmQueuedMessage[] {
  const out = queue.splice(0, queue.length)
  queuedIds.clear()
  return out
}

export function requeueDmMessages(messages: DmQueuedMessage[]): void {
  for (const m of messages) enqueueDmMessage(m)
}
