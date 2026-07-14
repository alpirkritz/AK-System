import {
  makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  makeInMemoryStore,
  type WASocket,
  type proto,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { config, getSelfChatTarget, isSelfChatJid, setSelfJid } from './config.js'
import { isGroupWatched, getGroupRule } from './group-config.js'
import { onGroupMessage } from './rules-engine.js'
import {
  bufferGroupMessage,
  clearGroupBuffer,
  getGroupBuffer,
  getGroupLastActivity,
  enqueuePersistMessage,
  drainPersistQueues,
  requeuePersistMessages,
  type BufferedGroupMessage,
} from './group-buffer.js'

export interface BridgeStatus {
  connected: boolean
  selfJid: string
  qrAvailable: boolean
  lastError: string | null
  akWebhookConfigured: boolean
  akWebhookHost: string
  replyEnabled: boolean
}

let sock: WASocket | null = null
const chatStore = makeInMemoryStore({ logger: pino({ level: 'silent' }) })
let currentQr: string | null = null
let connected = false
let lastError: string | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
/** Skip our own outbound replies (fromMe loop prevention). */
const bridgeSentIds = new Set<string>()
/** Content we recently sent — bot echoes often get new message IDs on @lid self-chat. */
const recentOutboundText = new Map<string, number>()
const RECENT_OUTBOUND_TTL_MS = 5 * 60 * 1000
/** Brief pause after sending before accepting new inbound on the same JID. */
let lastOutbound: { jid: string; at: number; textKey: string } | null = null
const OUTBOUND_GUARD_MS = 45_000
/** Dedupe message IDs — append/history sync can replay old self-chat bot replies. */
const processedInboundIds = new Map<string, number>()
const PROCESSED_INBOUND_TTL_MS = 24 * 60 * 60 * 1000
const PROCESSED_INBOUND_MAX = 2000
/** Only process live self-chat notifications; ignore stale history replays. */
const SELF_CHAT_MAX_AGE_MS = 3 * 60 * 1000

function isSameSelfChatJid(a: string, b: string): boolean {
  if (a === b) return true
  return isSelfChatJid(a) && isSelfChatJid(b)
}

function pruneProcessedInboundIds(): void {
  const cutoff = Date.now() - PROCESSED_INBOUND_TTL_MS
  for (const [id, at] of processedInboundIds) {
    if (at < cutoff) processedInboundIds.delete(id)
  }
  while (processedInboundIds.size > PROCESSED_INBOUND_MAX) {
    const oldest = processedInboundIds.keys().next().value
    if (!oldest) break
    processedInboundIds.delete(oldest)
  }
}

function markInboundProcessed(messageId: string): void {
  pruneProcessedInboundIds()
  processedInboundIds.set(messageId, Date.now())
}

function wasInboundProcessed(messageId: string): boolean {
  pruneProcessedInboundIds()
  return processedInboundIds.has(messageId)
}

function messageAgeMs(msg: proto.IWebMessageInfo): number | null {
  const raw = Number(msg.messageTimestamp)
  if (!Number.isFinite(raw) || raw <= 0) return null
  const ms = raw < 1e12 ? raw * 1000 : raw
  return Date.now() - ms
}

function normalizeTextKey(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 240).toLowerCase()
}

function pruneRecentOutbound(): void {
  const cutoff = Date.now() - RECENT_OUTBOUND_TTL_MS
  for (const [key, at] of recentOutboundText) {
    if (at < cutoff) recentOutboundText.delete(key)
  }
}

function markRecentOutbound(text: string): void {
  pruneRecentOutbound()
  const key = normalizeTextKey(text)
  if (!key) return
  recentOutboundText.set(key, Date.now())
}

function isRecentOutbound(text: string): boolean {
  pruneRecentOutbound()
  const key = normalizeTextKey(text)
  if (!key) return false
  if (recentOutboundText.has(key)) return true
  // Prefix match — WhatsApp may truncate or normalize line breaks differently on echo.
  for (const [sentKey] of recentOutboundText) {
    if (key.length >= 40 && sentKey.startsWith(key.slice(0, 40))) return true
    if (sentKey.length >= 40 && key.startsWith(sentKey.slice(0, 40))) return true
  }
  return false
}

function shouldSkipInboundEcho(remoteJid: string, text: string, fromMe: boolean): boolean {
  if (isRecentOutbound(text)) return true
  if (!lastOutbound) return false
  if (!isSameSelfChatJid(lastOutbound.jid, remoteJid)) return false
  if (Date.now() - lastOutbound.at > OUTBOUND_GUARD_MS) return false
  if (fromMe) return true
  const key = normalizeTextKey(text)
  if (!key) return false
  return key === lastOutbound.textKey || lastOutbound.textKey.startsWith(key.slice(0, 40))
}

const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

function extractText(message: proto.IMessage | null | undefined): string {
  if (!message) return ''
  if (message.conversation) return message.conversation
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text
  if (message.imageMessage?.caption) return message.imageMessage.caption
  return ''
}

async function forwardToAkWebhook(payload: {
  message: string
  from: string
  chatJid: string
  messageId: string
}): Promise<string | null> {
  if (!config.akWebhookUrl) return null
  const res = await fetch(config.akWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.bridgeSecret}`,
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`AK webhook failed (${res.status}): ${body}`)
  }
  const data = (await res.json()) as { reply?: string }
  return data.reply ?? null
}

function resolveGroupSummaryUrl(): string {
  if (config.akGroupSummaryUrl) return config.akGroupSummaryUrl
  if (!config.akWebhookUrl) return ''
  return config.akWebhookUrl.replace(/\/webhook\/?$/, '/group-summary')
}

function resolveMessagesIngestUrl(): string {
  if (config.akMessagesIngestUrl) return config.akMessagesIngestUrl
  if (!config.akWebhookUrl) return ''
  return config.akWebhookUrl.replace(/\/webhook\/?$/, '/messages/ingest')
}

/** Flush queued watched-group messages to the AK database (batched, per group). */
export async function flushPersistQueues(): Promise<void> {
  const ingestUrl = resolveMessagesIngestUrl()
  if (!ingestUrl) return
  const batches = drainPersistQueues()
  if (batches.length === 0) return

  for (const { groupJid, messages } of batches) {
    try {
      const rule = getGroupRule(groupJid)
      const groupName = rule?.name?.trim() || groupJid.split('@')[0] || ''
      const res = await fetch(ingestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.bridgeSecret}`,
        },
        body: JSON.stringify({ groupJid, groupName, messages }),
      })
      if (!res.ok) {
        const body = await res.text()
        logger.warn({ groupJid, status: res.status, body: body.slice(0, 200) }, 'Message ingest failed — requeueing')
        requeuePersistMessages(groupJid, messages)
      } else {
        logger.info({ groupJid, count: messages.length }, 'Flushed group messages to AK')
      }
    } catch (err) {
      logger.warn({ err, groupJid }, 'Message ingest error — requeueing')
      requeuePersistMessages(groupJid, messages)
    }
  }
}

let persistFlushTimer: ReturnType<typeof setInterval> | null = null
const PERSIST_FLUSH_INTERVAL_MS = 60_000

/** Start the periodic flush loop (idempotent). */
export function startPersistFlushLoop(): void {
  if (persistFlushTimer) return
  persistFlushTimer = setInterval(() => {
    void flushPersistQueues()
  }, PERSIST_FLUSH_INTERVAL_MS)
  if (typeof persistFlushTimer.unref === 'function') persistFlushTimer.unref()
}

async function handleInboundMessage(msg: proto.IWebMessageInfo): Promise<void> {
  if (!msg.key.remoteJid) return

  const remoteJid = msg.key.remoteJid

  // Never process or reply to anyone except explicit self-chat JIDs
  if (!isSelfChatJid(remoteJid)) {
    if (!remoteJid.endsWith('@g.us')) {
      logger.warn({ remoteJid }, 'Ignored — not self-chat (no reply)')
    }
    if (!remoteJid.endsWith('@g.us')) return
  }

  if (!config.replyEnabled || !config.akWebhookUrl) {
    if (isSelfChatJid(remoteJid)) {
      logger.info({ remoteJid }, 'Self-chat message ignored — REPLY_ENABLED is off')
    }
    if (!remoteJid.endsWith('@g.us')) return
  }

  const messageId = msg.key.id || String(Date.now())

  if (wasInboundProcessed(messageId)) {
    logger.info({ remoteJid, messageId }, 'Skipped duplicate inbound message')
    return
  }

  // Message Yourself arrives as fromMe when sent from the phone — must allow in self-chat only
  if (msg.key.fromMe) {
    if (bridgeSentIds.has(messageId)) {
      bridgeSentIds.delete(messageId)
      markInboundProcessed(messageId)
      return
    }
    if (!isSelfChatJid(remoteJid)) return
  }

  const text = extractText(msg.message)
  if (!text.trim()) return

  if (remoteJid.endsWith('@g.us')) {
    if (!isGroupWatched(remoteJid)) return
    const sender = msg.key.participant || msg.participant || 'unknown'
    const trimmed = text.trim()
    const groupMessage: BufferedGroupMessage = {
      id: messageId,
      sender,
      senderName: sender.split('@')[0] ?? sender,
      text: trimmed,
      timestamp: Number(msg.messageTimestamp) || Date.now(),
    }
    bufferGroupMessage(remoteJid, groupMessage)
    enqueuePersistMessage(remoteJid, groupMessage)
    onGroupMessage(remoteJid, trimmed)
    logger.info({ groupJid: remoteJid, messageId }, 'Buffered group message')
    return
  }

  if (!isSelfChatJid(remoteJid)) {
    return
  }

  const ageMs = messageAgeMs(msg)
  if (ageMs != null && ageMs > SELF_CHAT_MAX_AGE_MS) {
    logger.info({ remoteJid, messageId, ageMs }, 'Skipped stale self-chat message (history sync)')
    markInboundProcessed(messageId)
    return
  }

  if (shouldSkipInboundEcho(remoteJid, text, !!msg.key.fromMe)) {
    logger.info({ remoteJid, messageId }, 'Skipped inbound echo (loop prevention)')
    markInboundProcessed(messageId)
    return
  }

  markInboundProcessed(messageId)
  logger.info({ remoteJid, text: text.slice(0, 80) }, 'Inbound self-chat message')

  try {
    const reply = await forwardToAkWebhook({
      message: text.trim(),
      from: remoteJid,
      chatJid: remoteJid,
      messageId,
    })

    if (reply) {
      await sendWhatsAppMessage(remoteJid, reply)
    }
  } catch (err) {
    logger.error({ err }, 'AK webhook error — no auto-reply sent')
    lastError = err instanceof Error ? err.message : 'AK webhook error'
  }
}

export async function startWhatsAppClient(): Promise<void> {
  if (sock) return

  mkdirSync(dirname(config.authStatePath), { recursive: true })
  mkdirSync(config.authStatePath, { recursive: true })

  const { state, saveCreds } = await useMultiFileAuthState(config.authStatePath)
  const { version } = await fetchLatestBaileysVersion()

  const socket = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    printQRInTerminal: false,
    browser: [config.deviceName, 'Chrome', '120.0.0'],
    syncFullHistory: false,
    markOnlineOnConnect: false,
  })

  sock = socket
  chatStore.bind(socket.ev)

  socket.ev.on('creds.update', saveCreds)

  socket.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      currentQr = qr
      connected = false
    }

    if (connection === 'open') {
      connected = true
      currentQr = null
      lastError = null
      if (socket.user?.id) {
        const self = jidNormalizedUser(socket.user.id)
        setSelfJid(config.selfJid || self)
        logger.info({ selfJid: config.selfJid }, 'WhatsApp connected')
      }
    }

    if (connection === 'close') {
      connected = false
      sock = null
      const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut
      lastError = lastDisconnect?.error?.message ?? 'Connection closed'

      if (shouldReconnect) {
        if (reconnectTimer) clearTimeout(reconnectTimer)
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          void startWhatsAppClient()
        }, 3000)
      } else {
        currentQr = null
        lastError = 'Logged out — delete auth state and re-pair'
      }
    }
  })

  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' && type !== 'append') return
    for (const msg of messages) {
      const isGroup = msg.key.remoteJid?.endsWith('@g.us')
      // Self-chat: only live notifications — append replays old bot replies and causes loops.
      if (!isGroup && type !== 'notify') continue
      try {
        await handleInboundMessage(msg)
      } catch (err) {
        logger.error({ err }, 'Failed to handle message')
      }
    }
  })
}

export function getStatus(): BridgeStatus {
  let akWebhookHost = ''
  if (config.akWebhookUrl) {
    try {
      akWebhookHost = new URL(config.akWebhookUrl).host
    } catch {
      akWebhookHost = config.akWebhookUrl
    }
  }
  return {
    connected,
    selfJid: config.selfJid,
    qrAvailable: !!currentQr,
    lastError,
    akWebhookConfigured: !!config.akWebhookUrl,
    akWebhookHost,
    replyEnabled: config.replyEnabled,
  }
}

export function getCurrentQr(): string | null {
  return currentQr
}

export async function sendWhatsAppMessage(to: string, text: string): Promise<void> {
  if (!sock || !connected) {
    throw new Error('WhatsApp not connected')
  }
  const jid = to || getSelfChatTarget()
  if (!jid) throw new Error('No self-chat JID configured')
  if (!isSelfChatJid(jid)) {
    throw new Error(`Blocked: outbound WhatsApp only allowed to self-chat, not ${jid}`)
  }
  const result = await sock.sendMessage(jid, { text: text.slice(0, 65000) })
  markRecentOutbound(text)
  lastOutbound = { jid, at: Date.now(), textKey: normalizeTextKey(text) }
  if (result?.key?.id) bridgeSentIds.add(result.key.id)
}

export function getSelfJid(): string {
  return config.selfJid
}

export async function discoverAvailableGroups(): Promise<
  { jid: string; name: string; participantCount: number; lastMessageAt: number | null }[]
> {
  if (!sock || !connected) {
    throw new Error('WhatsApp not connected')
  }
  const groups = await sock.groupFetchAllParticipating()

  function chatLastMessageMs(jid: string): number | null {
    const chat = chatStore.chats.get(jid)
    if (!chat) return null
    const raw =
      chat.lastMessageRecvTimestamp ??
      (chat as { conversationTimestamp?: number | null }).conversationTimestamp
    if (raw == null) return null
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) return null
    return n < 1e12 ? n * 1000 : n
  }

  return Object.values(groups).map((g) => {
    const fromChat = chatLastMessageMs(g.id)
    const fromBuffer = getGroupLastActivity(g.id)
    const candidates = [fromChat, fromBuffer].filter((t): t is number => t != null && t > 0)
    const lastMessageAt = candidates.length > 0 ? Math.max(...candidates) : null
    return {
      jid: g.id,
      name: g.subject || g.id,
      participantCount: g.participants?.length ?? 0,
      lastMessageAt,
    }
  })
}

export async function requestGroupSummary(groupJid: string): Promise<{ ok: boolean; error?: string }> {
  const messages = getGroupBuffer(groupJid)
  if (messages.length === 0) {
    return { ok: false, error: 'No buffered messages for this group' }
  }

  const summaryUrl = resolveGroupSummaryUrl()
  if (!summaryUrl) {
    return { ok: false, error: 'AK_GROUP_SUMMARY_URL or AK_WEBHOOK_URL not configured' }
  }

  const rule = getGroupRule(groupJid)
  const groupName = rule?.name?.trim() || groupJid.split('@')[0] || 'קבוצה'

  const res = await fetch(summaryUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.bridgeSecret}`,
    },
    body: JSON.stringify({ groupJid, groupName, messages }),
  })

  if (!res.ok) {
    const body = await res.text()
    return { ok: false, error: `Summary API failed (${res.status}): ${body}` }
  }

  const data = (await res.json()) as { summary?: string; reply?: string }
  const summary = data.summary || data.reply
  if (!summary) {
    return { ok: false, error: 'No summary in response' }
  }

  // Persist any queued messages before clearing the FOMO buffer so history stays complete.
  await flushPersistQueues().catch(() => {})
  clearGroupBuffer(groupJid)
  await sendWhatsAppMessage(getSelfChatTarget(), summary)
  return { ok: true }
}
