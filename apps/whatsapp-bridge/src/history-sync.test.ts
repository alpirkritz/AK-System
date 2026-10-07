import { describe, expect, it, beforeEach, vi } from 'vitest'

process.env.BRIDGE_SECRET = process.env.BRIDGE_SECRET || 'test'

const { HISTORY_WINDOW_MS, clearCapturedMessageIds, ingestHistoryMessages, noteCapturedMessageId } =
  await import('./history-sync.js')

const GROUP = '120363012345678901@g.us'
const PN = '972501234567@s.whatsapp.net'
const NOW = 1_760_000_000_000

function historyMessage(over: {
  id: string
  remoteJid: string
  text?: string
  timestamp?: number
  participant?: string
  pushName?: string
  fromMe?: boolean
}) {
  return {
    key: { id: over.id, remoteJid: over.remoteJid, participant: over.participant, fromMe: over.fromMe ?? false },
    message: { conversation: over.text ?? 'שלום' },
    messageTimestamp: Math.round((over.timestamp ?? NOW) / 1000),
    pushName: over.pushName,
  }
}

function handlers() {
  return {
    isGroupWatched: (jid: string) => jid === GROUP,
    capturedDm: (jid: string) => (jid === PN ? { jid: PN, altJid: null } : null),
    queueGroupMessage: vi.fn(),
    queueDmMessage: vi.fn(),
    now: () => NOW,
  }
}

describe('ingestHistoryMessages', () => {
  beforeEach(() => {
    clearCapturedMessageIds()
  })

  it('queues watched-group history onto the persist queue', () => {
    const h = handlers()
    const result = ingestHistoryMessages(
      [historyMessage({ id: 'g1', remoteJid: GROUP, participant: PN, pushName: 'עדי', text: 'תתקדם עם זה' })],
      h,
    )
    expect(result.groupMessages).toBe(1)
    expect(h.queueGroupMessage).toHaveBeenCalledWith(GROUP, {
      id: 'g1',
      sender: PN,
      senderName: 'עדי',
      text: 'תתקדם עם זה',
      timestamp: NOW,
      historySync: true,
    })
  })

  it('queues allowlisted private-chat history', () => {
    const h = handlers()
    const result = ingestHistoryMessages([historyMessage({ id: 'd1', remoteJid: PN, fromMe: true })], h)
    expect(result.dmMessages).toBe(1)
    expect(h.queueDmMessage).toHaveBeenCalledWith({
      id: 'd1',
      jid: PN,
      altJid: null,
      fromMe: true,
      text: 'שלום',
      timestamp: NOW,
      historySync: true,
    })
  })

  it('skips a message the live path already captured', () => {
    const h = handlers()
    noteCapturedMessageId('g1')
    const result = ingestHistoryMessages([historyMessage({ id: 'g1', remoteJid: GROUP })], h)
    expect(result).toMatchObject({ groupMessages: 0, duplicates: 1 })
    expect(h.queueGroupMessage).not.toHaveBeenCalled()
  })

  it('writes a repeated history message once', () => {
    const h = handlers()
    const msgs = [historyMessage({ id: 'g1', remoteJid: GROUP })]
    expect(ingestHistoryMessages(msgs, h).groupMessages).toBe(1)
    expect(ingestHistoryMessages(msgs, h)).toMatchObject({ groupMessages: 0, duplicates: 1 })
    expect(h.queueGroupMessage).toHaveBeenCalledTimes(1)
  })

  it('drops anything older than the three-day window and keeps what is inside it', () => {
    const h = handlers()
    const result = ingestHistoryMessages(
      [
        historyMessage({ id: 'old', remoteJid: GROUP, timestamp: NOW - HISTORY_WINDOW_MS - 60_000 }),
        historyMessage({ id: 'fresh', remoteJid: GROUP, timestamp: NOW - HISTORY_WINDOW_MS + 60_000 }),
      ],
      h,
    )
    expect(result).toMatchObject({ groupMessages: 1, outOfWindow: 1 })
    expect(h.queueGroupMessage).toHaveBeenCalledTimes(1)
    expect(h.queueGroupMessage.mock.calls[0][1]).toMatchObject({ id: 'fresh' })
  })

  it('respects the capture lists — unwatched groups and non-allowlisted chats are ignored', () => {
    const h = handlers()
    const result = ingestHistoryMessages(
      [
        historyMessage({ id: 'x1', remoteJid: '999999@g.us' }),
        historyMessage({ id: 'x2', remoteJid: '972509999999@s.whatsapp.net' }),
      ],
      h,
    )
    expect(result).toMatchObject({ groupMessages: 0, dmMessages: 0, ignored: 2 })
    expect(h.queueGroupMessage).not.toHaveBeenCalled()
    expect(h.queueDmMessage).not.toHaveBeenCalled()
  })

  it('ignores messages without text, id, or a usable timestamp', () => {
    const h = handlers()
    const result = ingestHistoryMessages(
      [
        historyMessage({ id: 'e1', remoteJid: GROUP, text: '   ' }),
        { key: { remoteJid: GROUP }, message: { conversation: 'hi' }, messageTimestamp: NOW / 1000 },
        { key: { id: 'e3', remoteJid: GROUP }, message: { conversation: 'hi' }, messageTimestamp: 0 },
      ],
      h,
    )
    expect(result).toMatchObject({ ignored: 3, groupMessages: 0 })
  })
})
