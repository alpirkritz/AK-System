import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getDb, whatsappGroups, whatsappMessages, whatsappLabels, chatMessages } from '@ak-system/database'
import { createTestCaller } from '../test-utils'
import { localMidnightToUtc, localTodayIso } from '../lib/calendar-dates'

// Stub the Gemini-backed insight generation so we can assert exactly which
// messages the time range let through.
const insights = vi.hoisted(() => ({
  generateGroupInsight: vi.fn(
    async (
      _name: string,
      messages: { text: string }[],
      mode: string,
      rangeLabel?: string,
    ) => `MOCK/${mode}/${rangeLabel ?? '-'}/${messages.map((m) => m.text).join(',')}`,
  ),
  generateCrossGroupDigest: vi.fn(
    async (groups: { name: string; messages: { text: string }[] }[], rangeLabel?: string) => ({
      text: `MOCK-DIGEST/${rangeLabel ?? '-'}/${groups
        .flatMap((g) => g.messages.map((m) => m.text))
        .join(',')}`,
      items: groups.map((g) => ({
        groupJid: 'x',
        name: g.name,
        priority: 0,
        score: 1,
        messageCount: g.messages.length,
        topic: null,
      })),
    }),
  ),
}))

vi.mock('../services/whatsapp-insights', () => insights)

const HOUR = 60 * 60 * 1000
const TZ = 'Asia/Jerusalem'

function dayStartMs(offsetDays: number): number {
  const todayIso = localTodayIso(TZ)
  const [y, m, d] = todayIso.split('-').map(Number)
  const shifted = new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10)
  return localMidnightToUtc(shifted, TZ).getTime()
}

async function seed(groupJid: string, entries: { text: string; ts: number }[]) {
  const db = getDb()
  const now = new Date().toISOString()
  await db.insert(whatsappMessages).values(
    entries.map((e, i) => ({
      id: `wm_tw_${i}_${Math.random().toString(36).slice(2, 8)}`,
      groupJid,
      waMessageId: `tw_${i}_${Math.random().toString(36).slice(2, 8)}`,
      sender: 'sender@s.whatsapp.net',
      senderName: 'Tester',
      text: e.text,
      ts: e.ts,
      createdAt: now,
    })),
  )
}

describe('whatsapp insights — calendar day and hour ranges', () => {
  beforeEach(async () => {
    const db = getDb()
    await db.delete(whatsappMessages)
    await db.delete(whatsappGroups)
    await db.delete(whatsappLabels)
    await db.delete(chatMessages)
    vi.clearAllMocks()
  })

  it('window=today covers only messages since local midnight', async () => {
    const caller = await createTestCaller()
    await caller.whatsapp.groups.upsert({ jid: 't1@g.us', name: 'T1', enabled: true })
    await seed('t1@g.us', [
      { text: 'yesterday-evening', ts: dayStartMs(-1) + 23 * HOUR },
      { text: 'earlier-today', ts: Date.now() - 1000 },
    ])

    const res = await caller.whatsapp.insights.forGroup({ groupJid: 't1@g.us', window: 'today' })

    expect(res.messageCount).toBe(1)
    expect(res.rangeLabel).toBe('היום')
    expect(res.text).toContain('earlier-today')
    expect(res.text).not.toContain('yesterday-evening')
  })

  it('window=yesterday excludes messages from today', async () => {
    const caller = await createTestCaller()
    await caller.whatsapp.groups.upsert({ jid: 't2@g.us', name: 'T2', enabled: true })
    await seed('t2@g.us', [
      { text: 'yesterday-noon', ts: dayStartMs(-1) + 12 * HOUR },
      { text: 'earlier-today', ts: Date.now() - 1000 },
    ])

    const res = await caller.whatsapp.insights.forGroup({ groupJid: 't2@g.us', window: 'yesterday' })

    expect(res.messageCount).toBe(1)
    expect(res.rangeLabel).toBe('אתמול')
    expect(res.text).toContain('yesterday-noon')
    expect(res.text).not.toContain('earlier-today')
  })

  it('sinceHour/untilHour restrict to that local hour range', async () => {
    const caller = await createTestCaller()
    await caller.whatsapp.groups.upsert({ jid: 't3@g.us', name: 'T3', enabled: true })
    const yesterday = dayStartMs(-1)
    await seed('t3@g.us', [
      { text: 'at-09-30', ts: yesterday + 9 * HOUR + 30 * 60_000 },
      { text: 'at-14-30', ts: yesterday + 14 * HOUR + 30 * 60_000 },
      { text: 'at-16-30', ts: yesterday + 16 * HOUR + 30 * 60_000 },
    ])

    const res = await caller.whatsapp.insights.forGroup({
      groupJid: 't3@g.us',
      window: 'yesterday',
      sinceHour: 14,
      untilHour: 16,
    })

    expect(res.messageCount).toBe(1)
    expect(res.rangeLabel).toBe('אתמול 14:00–16:00')
    expect(res.text).toContain('at-14-30')
    expect(res.text).not.toContain('at-09-30')
    expect(res.text).not.toContain('at-16-30')
  })

  it('rolling 24h still anchors to now, not to local midnight', async () => {
    const caller = await createTestCaller()
    await caller.whatsapp.groups.upsert({ jid: 't4@g.us', name: 'T4', enabled: true })
    await seed('t4@g.us', [
      { text: 'two-hours-ago', ts: Date.now() - 2 * HOUR },
      { text: 'three-days-ago', ts: Date.now() - 3 * 24 * HOUR },
    ])

    const res = await caller.whatsapp.insights.forGroup({ groupJid: 't4@g.us', window: '24h' })

    expect(res.messageCount).toBe(1)
    expect(res.rangeLabel).toBe('24 השעות האחרונות')
    expect(res.text).toContain('two-hours-ago')
  })

  it('digest honors window=yesterday and reports the range', async () => {
    const caller = await createTestCaller()
    await caller.whatsapp.groups.upsert({ jid: 't5@g.us', name: 'T5', enabled: true })
    await seed('t5@g.us', [
      { text: 'yesterday-msg', ts: dayStartMs(-1) + 10 * HOUR },
      { text: 'today-msg', ts: Date.now() - 1000 },
    ])

    const res = await caller.whatsapp.insights.digest({ window: 'yesterday' })

    expect(res.rangeLabel).toBe('אתמול')
    expect(res.text).toContain('yesterday-msg')
    expect(res.text).not.toContain('today-msg')
    expect(res.items[0]?.messageCount).toBe(1)
  })

  it('digest reports the range in its empty state', async () => {
    const caller = await createTestCaller()
    await caller.whatsapp.groups.upsert({ jid: 't6@g.us', name: 'T6', enabled: true })

    const res = await caller.whatsapp.insights.digest({ window: 'today' })

    expect(res.items).toEqual([])
    expect(res.text).toContain('היום')
    expect(insights.generateCrossGroupDigest).not.toHaveBeenCalled()
  })

  it('passes the range label to the model so it cannot overstate the period', async () => {
    const caller = await createTestCaller()
    await caller.whatsapp.groups.upsert({ jid: 't7@g.us', name: 'T7', enabled: true })
    await seed('t7@g.us', [{ text: 'msg', ts: Date.now() - 1000 }])

    await caller.whatsapp.insights.forGroup({ groupJid: 't7@g.us', window: 'today', mode: 'topics' })

    expect(insights.generateGroupInsight).toHaveBeenCalledWith(
      'T7',
      expect.any(Array),
      'topics',
      'היום',
    )
  })
})
