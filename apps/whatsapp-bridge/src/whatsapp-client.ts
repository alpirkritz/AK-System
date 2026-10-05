import {
  makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  type BaileysEventEmitter,
  type GroupMetadata,
  type WASocket,
  type proto,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  config,
  getSelfChatTarget,
  isAllowedGroupJid,
  isSelfChatJid,
  routeSelfChatJid,
  setSelfJid,
  setSelfLid,
} from './config.js'
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
import { drainDmQueue, enqueueDmMessage, noteLidPhoneFromStanza, requeueDmMessages, resolveCapturedDm } from './dm-capture.js'

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

/**
 * Minimal replacement for Baileys' `makeInMemoryStore`, which was removed in
 * 6.7.18+. We only ever used two things from it: the contact list (to map an
 * `@lid` private chat back to its phone JID for DM capture) and each chat's
 * last-message timestamp (for the group discovery list). Kept deliberately
 * tiny — no message history, no full chat objects.
 */
interface StoredContact {
  id: string
  lid?: string
}
const chatStore = {
  contacts: new Map<string, StoredContact>(),
  chatLastMessageAt: new Map<string, number>(),
  bind(ev: BaileysEventEmitter): void {
    const upsertContacts = (list: { id: string; lid?: string | null }[]) => {
      for (const c of list) {
        if (!c.id) continue
        const prev = this.contacts.get(c.id)
        this.contacts.set(c.id, { id: c.id, lid: c.lid ?? prev?.lid })
      }
    }
    const noteChatTs = (list: { id?: string | null; conversationTimestamp?: unknown; lastMessageRecvTimestamp?: unknown }[]) => {
      for (const c of list) {
        if (!c.id) continue
        const raw = c.lastMessageRecvTimestamp ?? c.conversationTimestamp
        // Baileys hands these over as number | Long — Number() handles both.
        const n = raw == null ? NaN : Number(raw)
        if (!Number.isFinite(n) || n <= 0) continue
        const ms = n < 1e12 ? n * 1000 : n
        const prev = this.chatLastMessageAt.get(c.id) ?? 0
        if (ms > prev) this.chatLastMessageAt.set(c.id, ms)
      }
    }
    ev.on('messaging-history.set', ({ contacts, chats }) => {
      upsertContacts(contacts)
      noteChatTs(chats)
    })
    ev.on('contacts.upsert', upsertContacts)
    ev.on('contacts.update', (updates) => upsertContacts(updates as { id: string; lid?: string | null }[]))
    ev.on('chats.upsert', noteChatTs)
    ev.on('chats.update', noteChatTs)
  },
}

/**
 * Group metadata cache for outbound group sends. Baileys re-queries the group
 * (participants + addressing mode) on every send otherwise; a short TTL keeps
 * the daily Tier 1 post cheap without going stale across membership changes.
 */
const groupMetadataCache = new Map<string, { at: number; data: GroupMetadata }>()
const GROUP_METADATA_TTL_MS = 5 * 60 * 1000

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

/** Baileys reports message time in seconds; everything downstream expects ms. */
function messageTimestampMs(msg: proto.IWebMessageInfo): number | null {
  const raw = Number(msg.messageTimestamp)
  if (!Number.isFinite(raw) || raw <= 0) return null
  return Math.round(raw < 1e12 ? raw * 1000 : raw)
}

function messageAgeMs(msg: proto.IWebMessageInfo): number | null {
  const ms = messageTimestampMs(msg)
  return ms == null ? null : Date.now() - ms
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

function resolveClusterSummaryUrl(): string {
  if (config.akGroupClusterSummaryUrl) return config.akGroupClusterSummaryUrl
  if (!config.akWebhookUrl) return ''
  return config.akWebhookUrl.replace(/\/webhook\/?$/, '/group-cluster-summary')
}

function resolveMessagesIngestUrl(): string {
  if (config.akMessagesIngestUrl) return config.akMessagesIngestUrl
  if (!config.akWebhookUrl) return ''
  return config.akWebhookUrl.replace(/\/webhook\/?$/, '/messages/ingest')
}

function resolveDmIngestUrl(): string {
  if (!config.akWebhookUrl) return ''
  return config.akWebhookUrl.replace(/\/webhook\/?$/, '/dm/ingest')
}

function capturedDmFor(remoteJid: string): { jid: string; altJid: string | null } | null {
  return resolveCapturedDm(remoteJid, chatStore.contacts.values(), isSelfChatJid)
}

/** Queue an allowlisted 1:1 message (sent or received) for the AK database. */
function captureDmMessage(msg: proto.IWebMessageInfo, target: { jid: string; altJid: string | null }): void {
  const text = extractText(msg.message).trim()
  const id = msg.key.id
  if (!text || !id) return
  enqueueDmMessage({
    id,
    jid: target.jid,
    altJid: target.altJid,
    fromMe: !!msg.key.fromMe,
    text,
    timestamp: messageTimestampMs(msg) ?? Date.now(),
  })
}

async function flushDmQueue(): Promise<void> {
  const url = resolveDmIngestUrl()
  if (!url) return
  const messages = drainDmQueue()
  if (messages.length === 0) return
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.bridgeSecret}` },
      body: JSON.stringify({ messages }),
    })
    if (!res.ok) {
      logger.warn({ status: res.status }, 'DM ingest failed — requeueing')
      requeueDmMessages(messages)
    } else {
      logger.info({ count: messages.length }, 'Flushed 1:1 messages to AK')
    }
  } catch (err) {
    logger.warn({ err }, 'DM ingest error — requeueing')
    requeueDmMessages(messages)
  }
}

/** Flush queued watched-group and allowlisted 1:1 messages to the AK database. */
export async function flushPersistQueues(): Promise<void> {
  await flushDmQueue()
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

  const capturedDm = capturedDmFor(remoteJid)
  if (capturedDm) {
    captureDmMessage(msg, capturedDm)
    logger.info({ via: capturedDm.altJid ? 'lid' : 'phone' }, 'Queued private chat')
    return
  }

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
    // Use pushName if available, otherwise fall back to JID prefix
    const senderName = msg.pushName?.trim() || sender.split('@')[0] || sender
    const groupMessage: BufferedGroupMessage = {
      id: messageId,
      sender,
      senderName,
      text: trimmed,
      timestamp: messageTimestampMs(msg) ?? Date.now(),
    }
    bufferGroupMessage(remoteJid, groupMessage)
    enqueuePersistMessage(remoteJid, groupMessage)
    onGroupMessage(remoteJid, trimmed)
    logger.info({ groupJid: remoteJid, messageId, senderName }, 'Buffered group message')
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
    cachedGroupMetadata: async (jid) => {
      const hit = groupMetadataCache.get(jid)
      return hit && Date.now() - hit.at < GROUP_METADATA_TTL_MS ? hit.data : undefined
    },
  })

  sock = socket
  chatStore.bind(socket.ev)
  socket.ws.on('CB:message', (node: { attrs?: Record<string, string> }) => {
    if (node?.attrs) noteLidPhoneFromStanza(node.attrs)
  })

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
        const liveLid = socket.user.lid ? jidNormalizedUser(socket.user.lid) : ''
        if (!process.env.SELF_JID) setSelfJid(self)
        if (liveLid.endsWith('@lid')) setSelfLid(liveLid)
        logger.info({ selfJid: config.selfJid, selfLid: config.selfLid }, 'WhatsApp connected')
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
      // Allowlisted 1:1 chats take both: messages sent from the phone can arrive as append.
      if (!isGroup && type !== 'notify' && !capturedDmFor(msg.key.remoteJid ?? '')) continue
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
  const requested = to || getSelfChatTarget()
  const jid = routeSelfChatJid(requested, config.selfJid, config.selfLid)
  if (!jid) throw new Error('No self-chat JID configured')
  if (!isSelfChatJid(requested) && !isSelfChatJid(jid)) {
    throw new Error(`Blocked: outbound WhatsApp only allowed to self-chat, not ${jid}`)
  }
  if (jid !== requested) {
    logger.info({ requested, jid }, 'Routed self-chat send to LID')
  }
  const result = await sock.sendMessage(jid, { text: text.slice(0, 65000) })
  markRecentOutbound(text)
  lastOutbound = { jid, at: Date.now(), textKey: normalizeTextKey(text) }
  if (result?.key?.id) bridgeSentIds.add(result.key.id)
}

/**
 * Send into a specific WhatsApp group — the one narrow exception to the
 * self-chat-only guard, gated by an explicit allow-list (WHATSAPP_ALLOWED_GROUP_JIDS).
 * Completely separate from `sendWhatsAppMessage`: does not touch, relax, or
 * share code with the self-chat guard used by every other outbound path.
 * See docs/specs/tier1-qa-whatsapp-agent.md §5.
 */
export async function sendWhatsAppGroupMessage(groupJid: string, text: string): Promise<void> {
  if (!sock || !connected) {
    throw new Error('WhatsApp not connected')
  }
  if (!isAllowedGroupJid(groupJid)) {
    throw new Error(`Blocked: ${groupJid} is not in WHATSAPP_ALLOWED_GROUP_JIDS`)
  }

  // Preflight: resolve the group first so a bad target fails with a reason a
  // human can act on, instead of WhatsApp's bare `not-acceptable` from deep
  // inside the send. Also primes `cachedGroupMetadata` for the send itself.
  let meta: GroupMetadata
  try {
    meta = await sock.groupMetadata(groupJid)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Group lookup failed for ${groupJid} (${reason}) — is this account still a member, and is the JID the one from /groups/available?`,
    )
  }
  groupMetadataCache.set(groupJid, { at: Date.now(), data: meta })

  if (meta.isCommunity) {
    throw new Error(
      `${groupJid} is a community parent ("${meta.subject}"), not a chat group — use the JID of the group inside the community`,
    )
  }
  if (meta.announce) {
    const me = jidNormalizedUser(sock.user?.id ?? '')
    const meLid = sock.user?.lid ? jidNormalizedUser(sock.user.lid) : ''
    const isAdmin = meta.participants.some(
      (p) => !!p.admin && [p.id, p.lid].some((j) => j && (j === me || j === meLid)),
    )
    if (!isAdmin) {
      throw new Error(`"${meta.subject}" is admins-only (announcement group) and this account is not an admin`)
    }
  }

  await sock.sendMessage(groupJid, { text: text.slice(0, 65000) })
  logger.info({ groupJid, subject: meta.subject, participants: meta.participants.length }, 'Sent group message')
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
    return chatStore.chatLastMessageAt.get(jid) ?? null
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

export async function requestClusterSummary(
  clusterName: string,
  groupJids: string[],
): Promise<{ ok: boolean; error?: string }> {
  const uniqueJids = [...new Set(groupJids.map((j) => j.trim()).filter(Boolean))]
  if (uniqueJids.length < 2) {
    return { ok: false, error: 'cluster requires at least two groupJids' }
  }

  const groups: {
    groupJid: string
    groupName: string
    messages: ReturnType<typeof getGroupBuffer>
  }[] = []
  for (const groupJid of uniqueJids) {
    const messages = getGroupBuffer(groupJid)
    if (messages.length === 0) continue
    const rule = getGroupRule(groupJid)
    const groupName = rule?.name?.trim() || groupJid.split('@')[0] || 'קבוצה'
    groups.push({ groupJid, groupName, messages })
  }

  if (groups.length === 0) {
    return { ok: false, error: 'No buffered messages for this cluster' }
  }

  const summaryUrl = resolveClusterSummaryUrl()
  if (!summaryUrl) {
    return { ok: false, error: 'AK_GROUP_CLUSTER_SUMMARY_URL or AK_WEBHOOK_URL not configured' }
  }

  const name = clusterName.trim() || groups.map((g) => g.groupName).join(' / ')
  const res = await fetch(summaryUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.bridgeSecret}`,
    },
    body: JSON.stringify({ clusterName: name, groups }),
  })

  if (!res.ok) {
    const body = await res.text()
    return { ok: false, error: `Cluster summary API failed (${res.status}): ${body}` }
  }

  const data = (await res.json()) as { summary?: string; reply?: string }
  const summary = data.summary || data.reply
  if (!summary) {
    return { ok: false, error: 'No summary in response' }
  }

  await flushPersistQueues().catch(() => {})
  for (const group of groups) {
    clearGroupBuffer(group.groupJid)
  }
  await sendWhatsAppMessage(getSelfChatTarget(), summary)
  return { ok: true }
}
