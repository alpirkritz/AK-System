import { describe, expect, it, beforeAll, beforeEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'ak-bridge-history-'))

process.env.BRIDGE_SECRET = 'test'
process.env.AUTH_STATE_PATH = join(root, 'auth')
process.env.BRIDGE_CONFIG_PATH = join(root, 'config')
process.env.SELF_JID = '972500000000@s.whatsapp.net'
process.env.AK_WEBHOOK_URL = 'https://ak.test/api/whatsapp/webhook'
process.env.REPLY_ENABLED = '1'

type Handler = (payload: unknown) => void
const handlers = new Map<string, Handler[]>()
const socket = {
  ev: {
    on(event: string, handler: Handler) {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
    },
  },
  ws: { on: vi.fn() },
  user: { id: '972500000000@s.whatsapp.net' },
  sendMessage: vi.fn(),
}

function emit(event: string, payload: unknown): void {
  for (const handler of handlers.get(event) ?? []) handler(payload)
}

vi.mock('@whiskeysockets/baileys', () => ({
  makeWASocket: () => socket,
  useMultiFileAuthState: async () => ({ state: { creds: {}, keys: {} }, saveCreds: vi.fn() }),
  fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 0] }),
  makeCacheableSignalKeyStore: (keys: unknown) => keys,
  jidNormalizedUser: (jid: string) => jid,
  DisconnectReason: { loggedOut: 401 },
}))

const GROUP = '120363012345678901@g.us'
const PN = '972501234567@s.whatsapp.net'

const { reloadDmConfig } = await import('./dm-capture.js')
const { reloadGroupConfig } = await import('./group-config.js')
const { drainPersistQueues, getGroupBuffer } = await import('./group-buffer.js')
const { drainDmQueue } = await import('./dm-capture.js')
const { clearCapturedMessageIds } = await import('./history-sync.js')
const { startWhatsAppClient } = await import('./whatsapp-client.js')

const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }))

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchSpy)
  reloadDmConfig([PN])
  reloadGroupConfig([
    {
      jid: GROUP,
      name: 'קבוצה',
      enabled: true,
      fomoEnabled: false,
      fomoThreshold: 5,
      fomoWindowMinutes: 5,
      keywords: [],
      summaryTimes: [],
      labelSummaryTimes: [],
      lastFomoAlertAt: null,
    },
  ])
  await startWhatsAppClient()
})

beforeEach(() => {
  fetchSpy.mockClear()
  clearCapturedMessageIds()
  drainPersistQueues()
  drainDmQueue()
})

describe('messaging-history.set', () => {
  it('persists history messages without replying, calling AK, or alerting', () => {
    const ts = Math.round(Date.now() / 1000) - 3600
    emit('messaging-history.set', {
      contacts: [{ id: PN }],
      chats: [{ id: GROUP, conversationTimestamp: ts }],
      messages: [
        {
          key: { id: 'g-hist', remoteJid: GROUP, participant: PN },
          message: { conversation: 'תעדכן אותי מחר' },
          messageTimestamp: ts,
          pushName: 'עדי',
        },
        {
          key: { id: 'd-hist', remoteJid: PN },
          message: { conversation: 'שלחתי לך את המסמך' },
          messageTimestamp: ts,
        },
      ],
    })

    const batches = drainPersistQueues()
    expect(batches).toEqual([
      {
        groupJid: GROUP,
        messages: [
          { id: 'g-hist', sender: PN, senderName: 'עדי', text: 'תעדכן אותי מחר', timestamp: ts * 1000, historySync: true },
        ],
      },
    ])
    expect(drainDmQueue()).toEqual([
      { id: 'd-hist', jid: PN, altJid: null, fromMe: false, text: 'שלחתי לך את המסמך', timestamp: ts * 1000, historySync: true },
    ])

    // No webhook call means no Hugo reply, no group alert and no notification.
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(socket.sendMessage).not.toHaveBeenCalled()
    // The FOMO buffer drives alerts and summaries — history must stay out of it.
    expect(getGroupBuffer(GROUP)).toEqual([])
  })

  it('does not re-queue a message the live path already handled', async () => {
    const ts = Math.round(Date.now() / 1000)
    const live = {
      key: { id: 'g-live', remoteJid: GROUP, participant: PN },
      message: { conversation: 'הודעה חיה' },
      messageTimestamp: ts,
      pushName: 'עדי',
    }
    emit('messages.upsert', { type: 'notify', messages: [live] })
    await vi.waitFor(() => {
      const [batch] = drainPersistQueues()
      expect(batch?.messages.map((m) => m.id)).toEqual(['g-live'])
    })

    emit('messaging-history.set', { contacts: [], chats: [], messages: [live] })
    expect(drainPersistQueues()).toEqual([])
  })

  it('drops history older than three days', () => {
    const ts = Math.round(Date.now() / 1000) - 4 * 24 * 60 * 60
    emit('messaging-history.set', {
      contacts: [],
      chats: [],
      messages: [
        {
          key: { id: 'g-ancient', remoteJid: GROUP, participant: PN },
          message: { conversation: 'ארכיון' },
          messageTimestamp: ts,
        },
      ],
    })
    expect(drainPersistQueues()).toEqual([])
    expect(drainDmQueue()).toEqual([])
  })
})
