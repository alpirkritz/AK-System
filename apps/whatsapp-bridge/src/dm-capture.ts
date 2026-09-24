import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import pino from 'pino'
import { config } from './config.js'
import { bareUserJid } from './self-chat.js'

const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

/**
 * 1:1 chats the owner opted in on a person card. Anything not on this list is never
 * forwarded; the AK ingest checks the list again on its side.
 */
let allowlist = new Set<string>()

export interface DmQueuedMessage {
  id: string
  jid: string
  altJid: string | null
  fromMe: boolean
  text: string
  timestamp: number
}

const queue: DmQueuedMessage[] = []
const queuedIds = new Set<string>()
const MAX_QUEUE = 5000

function persistPath(): string {
  return join(config.authStatePath, 'dm-config.json')
}

export function loadPersistedDmConfig(): void {
  try {
    const file = persistPath()
    if (!existsSync(file)) return
    const jids = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (!Array.isArray(jids)) return
    allowlist = new Set(jids.map((j) => bareUserJid(String(j))))
    logger.info({ count: allowlist.size }, 'Restored DM capture allowlist')
  } catch (err) {
    logger.error({ err }, 'Failed to load DM capture allowlist')
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
  const phone = bare.endsWith('@lid') ? phoneJidForLid(bare, contacts) : null
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
