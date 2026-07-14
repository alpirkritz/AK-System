import { describe, it, expect, beforeEach } from 'vitest'
import { getDb, whatsappGroups, whatsappMessages, whatsappLabels, chatMessages } from '@ak-system/database'
import { eq } from 'drizzle-orm'
import { createTestCaller } from '../test-utils'

async function seedMessages(groupJid: string, entries: { text: string; ts: number; id?: string }[]) {
  const db = getDb()
  const now = new Date().toISOString()
  await db.insert(whatsappMessages).values(
    entries.map((e, i) => ({
      id: `wm_test_${i}_${Math.random().toString(36).slice(2, 7)}`,
      groupJid,
      waMessageId: e.id ?? `msg_${i}_${Math.random().toString(36).slice(2, 6)}`,
      sender: 'sender@s.whatsapp.net',
      senderName: 'Tester',
      text: e.text,
      ts: e.ts,
      createdAt: now,
    })),
  )
}

describe('whatsapp router — messages & insights', () => {
  beforeEach(async () => {
    const db = getDb()
    await db.delete(whatsappMessages)
    await db.delete(whatsappGroups)
    await db.delete(whatsappLabels)
    await db.delete(chatMessages)
  })

  it('groups.upsert stores priority and groups.list returns it', async () => {
    const caller = await createTestCaller()
    await caller.whatsapp.groups.upsert({
      jid: '123@g.us',
      name: 'Family',
      enabled: true,
      priority: 2,
    })
    const list = await caller.whatsapp.groups.list()
    expect(list).toHaveLength(1)
    expect(list[0].priority).toBe(2)
  })

  it('messages.listByGroup returns messages in the time window ordered by ts', async () => {
    const caller = await createTestCaller()
    await caller.whatsapp.groups.upsert({ jid: 'g1@g.us', name: 'G1', enabled: true })
    const base = Date.now()
    await seedMessages('g1@g.us', [
      { text: 'old', ts: base - 100_000 },
      { text: 'newer', ts: base - 1_000 },
      { text: 'newest', ts: base },
    ])

    const all = await caller.whatsapp.messages.listByGroup({ groupJid: 'g1@g.us' })
    expect(all.map((m) => m.text)).toEqual(['old', 'newer', 'newest'])

    const windowed = await caller.whatsapp.messages.listByGroup({
      groupJid: 'g1@g.us',
      sinceMs: base - 5_000,
    })
    expect(windowed.map((m) => m.text)).toEqual(['newer', 'newest'])
  })

  it('messages.stats returns count and date range per group', async () => {
    const caller = await createTestCaller()
    await caller.whatsapp.groups.upsert({ jid: 'g2@g.us', name: 'G2', enabled: true })
    const base = Date.now()
    await seedMessages('g2@g.us', [
      { text: 'a', ts: base - 10_000 },
      { text: 'b', ts: base },
    ])
    const stats = await caller.whatsapp.messages.stats()
    const row = stats.find((s) => s.groupJid === 'g2@g.us')
    expect(row).toBeDefined()
    expect(row!.count).toBe(2)
    expect(row!.name).toBe('G2')
    expect(row!.earliestTs).toBe(base - 10_000)
    expect(row!.latestTs).toBe(base)
  })

  it('groups.delete cascades to stored messages', async () => {
    const caller = await createTestCaller()
    const { id } = await caller.whatsapp.groups.upsert({ jid: 'g3@g.us', name: 'G3', enabled: true })
    await seedMessages('g3@g.us', [{ text: 'x', ts: Date.now() }])
    await caller.whatsapp.groups.delete({ id })

    const rows = await getDb().select().from(whatsappMessages).where(eq(whatsappMessages.groupJid, 'g3@g.us'))
    expect(rows).toHaveLength(0)
  })

  it('insights.forGroup returns a no-messages result without calling the model', async () => {
    const caller = await createTestCaller()
    await caller.whatsapp.groups.upsert({ jid: 'g4@g.us', name: 'G4', enabled: true })
    const res = await caller.whatsapp.insights.forGroup({ groupJid: 'g4@g.us', window: '7d', mode: 'summary' })
    expect(res.messageCount).toBe(0)
    expect(res.text).toContain('אין הודעות')
  })

  it('insights.digest returns an empty briefing when no groups are enabled', async () => {
    const caller = await createTestCaller()
    const res = await caller.whatsapp.insights.digest({ window: '24h' })
    expect(res.items).toEqual([])
    expect(res.text).toContain('אין קבוצות')
  })

  it('insights.digest reports no activity when enabled groups have no recent messages', async () => {
    const caller = await createTestCaller()
    await caller.whatsapp.groups.upsert({ jid: 'g5@g.us', name: 'G5', enabled: true })
    const res = await caller.whatsapp.insights.digest({ window: '24h' })
    expect(res.items).toEqual([])
    expect(res.text).toContain('אין פעילות')
  })
})
