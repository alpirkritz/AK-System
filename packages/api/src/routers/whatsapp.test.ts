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

describe('whatsapp router — label cluster parameter', () => {
  beforeEach(async () => {
    const db = getDb()
    await db.delete(whatsappMessages)
    await db.delete(whatsappGroups)
    await db.delete(whatsappLabels)
    await db.delete(chatMessages)
  })

  it('labels.upsert stores aggregateSummaries and defaults it to false', async () => {
    const caller = await createTestCaller()
    const created = await caller.whatsapp.labels.upsert({ name: 'חדשה', summaryTimes: ['20:00'] })
    expect(created.aggregateSummaries).toBe(false)

    const listed = await caller.whatsapp.labels.list()
    expect(listed).toHaveLength(1)
    expect(listed[0].aggregateSummaries).toBe(false)

    const updated = await caller.whatsapp.labels.upsert({
      id: created.id,
      name: 'חדשה',
      summaryTimes: ['20:00'],
      aggregateSummaries: true,
    })
    expect(updated.aggregateSummaries).toBe(true)
    const again = await caller.whatsapp.labels.list()
    expect(again[0].aggregateSummaries).toBe(true)
  })

  it('labels.delete still unassigns groups', async () => {
    const caller = await createTestCaller()
    const label = await caller.whatsapp.labels.upsert({
      name: 'למחיקה',
      summaryTimes: ['20:00'],
      aggregateSummaries: true,
    })
    await caller.whatsapp.groups.upsert({
      jid: 'del@g.us',
      name: 'G',
      enabled: true,
      labelId: label.id,
    })
    await caller.whatsapp.labels.delete({ id: label.id })
    const groups = await caller.whatsapp.groups.list()
    expect(groups[0].labelId).toBeNull()
    expect(await caller.whatsapp.labels.list()).toEqual([])
  })

  it('groupsDueForSummary clusters by the stored flag, not by label name', async () => {
    const caller = await createTestCaller()
    const clustered = await caller.whatsapp.labels.upsert({
      name: 'כל שם שהוא',
      summaryTimes: ['20:00'],
      aggregateSummaries: true,
    })
    const plain = await caller.whatsapp.labels.upsert({
      name: 'גם שם אחר',
      summaryTimes: ['20:00'],
      aggregateSummaries: false,
    })
    await caller.whatsapp.groups.upsert({
      jid: 'c1@g.us',
      name: 'C1',
      enabled: true,
      labelId: clustered.id,
    })
    await caller.whatsapp.groups.upsert({
      jid: 'c2@g.us',
      name: 'C2',
      enabled: true,
      labelId: clustered.id,
    })
    await caller.whatsapp.groups.upsert({
      jid: 'p1@g.us',
      name: 'P1',
      enabled: true,
      labelId: plain.id,
    })

    const due = await caller.whatsapp.groupsDueForSummary({ time: '20:00' })
    expect(due.clusters).toHaveLength(1)
    expect(due.clusters[0].labelId).toBe(clustered.id)
    expect(due.clusters[0].groups).toHaveLength(2)
    expect(due.singles.map((s) => s.jid)).toEqual(['p1@g.us'])
  })

  it('summaries.trigger rejects groupJid and labelId together', async () => {
    const caller = await createTestCaller()
    await expect(
      caller.whatsapp.summaries.trigger({ groupJid: 'a@g.us', labelId: 'wl1' }),
    ).rejects.toThrow(/mutually exclusive/)
  })

  it('summaries.trigger on a clustered label with no stored messages delivers a quiet-day briefing', async () => {
    const caller = await createTestCaller()
    const label = await caller.whatsapp.labels.upsert({
      name: 'עומרי',
      summaryTimes: ['20:00'],
      aggregateSummaries: true,
    })
    await caller.whatsapp.groups.upsert({
      jid: 'welcome@g.us',
      name: 'ברוכים הבאים',
      enabled: true,
      labelId: label.id,
    })
    await caller.whatsapp.groups.upsert({
      jid: 'tzaharon@g.us',
      name: 'צהרון',
      enabled: true,
      labelId: label.id,
    })

    const res = await caller.whatsapp.summaries.trigger({ labelId: label.id })
    expect(res.okCount).toBe(1)
    expect(res.results[0]?.ok).toBe(true)
    expect(res.results[0]?.text).toContain('📋 סיכום — עומרי')
    expect(res.results[0]?.text).toContain('היום לא קרה כלום.')
    const chats = await getDb().select().from(chatMessages)
    expect(chats.some((c) => c.content.includes('היום לא קרה כלום.'))).toBe(true)
  })
})
