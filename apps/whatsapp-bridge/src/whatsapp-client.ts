import {
  makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  type WASocket,
  type proto,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { config, getSelfChatTarget, isSelfChatJid, isWatchedGroup, setSelfJid } from './config.js'
import { bufferGroupMessage, clearGroupBuffer, getGroupBuffer } from './group-buffer.js'

export interface BridgeStatus {
  connected: boolean
  selfJid: string
  qrAvailable: boolean
  lastError: string | null
}

let sock: WASocket | null = null
let currentQr: string | null = null
let connected = false
let lastError: string | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
/** Skip our own outbound replies (fromMe loop prevention). */
const bridgeSentIds = new Set<string>()

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

  // Message Yourself arrives as fromMe when sent from the phone — must allow in self-chat only
  if (msg.key.fromMe) {
    if (bridgeSentIds.has(messageId)) {
      bridgeSentIds.delete(messageId)
      return
    }
    if (!isSelfChatJid(remoteJid)) return
  }

  const text = extractText(msg.message)
  if (!text.trim()) return

  if (remoteJid.endsWith('@g.us')) {
    if (!isWatchedGroup(remoteJid)) return
    const sender = msg.key.participant || msg.participant || 'unknown'
    bufferGroupMessage(remoteJid, {
      id: messageId,
      sender,
      senderName: sender.split('@')[0] ?? sender,
      text: text.trim(),
      timestamp: Number(msg.messageTimestamp) || Date.now(),
    })
    logger.info({ groupJid: remoteJid, messageId }, 'Buffered group message')
    return
  }

  if (!isSelfChatJid(remoteJid)) {
    return
  }

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
      try {
        await handleInboundMessage(msg)
      } catch (err) {
        logger.error({ err }, 'Failed to handle message')
      }
    }
  })
}

export function getStatus(): BridgeStatus {
  return {
    connected,
    selfJid: config.selfJid,
    qrAvailable: !!currentQr,
    lastError,
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
  if (result?.key?.id) bridgeSentIds.add(result.key.id)
}

export function getSelfJid(): string {
  return config.selfJid
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

  const res = await fetch(summaryUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.bridgeSecret}`,
    },
    body: JSON.stringify({ groupJid, messages }),
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

  clearGroupBuffer(groupJid)
  await sendWhatsAppMessage(getSelfChatTarget(), summary)
  return { ok: true }
}
