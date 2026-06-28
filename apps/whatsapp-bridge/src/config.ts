import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnvFile(): void {
  const envPath = resolve(process.cwd(), '.env')
  if (!existsSync(envPath)) return
  const content = readFileSync(envPath, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnvFile()

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback
}

function optionalList(name: string): string[] {
  const raw = process.env[name]
  if (!raw) return []
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

export const config = {
  port: Number(optional('PORT', '3001')),
  authStatePath: resolve(process.cwd(), optional('AUTH_STATE_PATH', './data/auth')),
  bridgeSecret: required('BRIDGE_SECRET'),
  akWebhookUrl: process.env.AK_WEBHOOK_URL || '',
  selfJid: process.env.SELF_JID || '',
  selfLid: process.env.SELF_LID || '',
  allowedJids: optionalList('ALLOWED_JIDS'),
  watchGroupJids: new Set(optionalList('WATCH_GROUP_JIDS')),
  deviceName: optional('DEVICE_NAME', 'AK System'),
  akGroupSummaryUrl: process.env.AK_GROUP_SUMMARY_URL || '',
  /** Must be explicitly enabled — default off to prevent accidental auto-replies. */
  replyEnabled: process.env.REPLY_ENABLED === '1' || process.env.REPLY_ENABLED === 'true',
}

export function assertSelfChatConfigured(): void {
  if (!config.selfJid && !config.selfLid && config.allowedJids.length === 0) {
    throw new Error('Configure SELF_JID and/or SELF_LID before starting the bridge')
  }
}

export function setSelfJid(jid: string): void {
  config.selfJid = jid
}

export function setSelfLid(jid: string): void {
  config.selfLid = jid
}

function normalizeJidBase(jid: string): string {
  return jid.split(':')[0] ?? jid
}

/** Message Yourself — only explicit self JIDs, never all @lid contacts. */
export function isSelfChatJid(jid: string): boolean {
  const base = normalizeJidBase(jid)
  if (config.selfJid && base === normalizeJidBase(config.selfJid)) return true
  if (config.selfLid && base === normalizeJidBase(config.selfLid)) return true
  if (config.allowedJids.length > 0) {
    return config.allowedJids.some((allowed) => base === normalizeJidBase(allowed))
  }
  return false
}

export function isAllowedJid(jid: string): boolean {
  return isSelfChatJid(jid)
}

export function getSelfChatTarget(): string {
  return config.selfLid || config.selfJid || config.allowedJids[0] || ''
}

export function isWatchedGroup(jid: string): boolean {
  return config.watchGroupJids.has(jid)
}
