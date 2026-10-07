import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  commitments,
  financeTransactions,
  harnessInsights,
  meetingPeople,
  meetings,
  people,
  whatsappDmMessages,
} from '@ak-system/database'
import { getTestDb, resetDb } from '../test-utils'
import {
  dismissInsight,
  formatInsightLines,
  listOpenInsights,
  persistInsights,
  phraseInsights,
  reasonAndPersist,
  runDetectors,
  type HarnessInsightDraft,
} from './harness-reasoner'

const NOW = new Date().toISOString()
const iso = (daysFromNow: number) => new Date(Date.now() + daysFromNow * 86_400_000).toISOString().slice(0, 10)
const isoTs = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString()

/** `resetDb` leaves finance alone, as the finance suites clear it themselves. */
async function resetAll() {
  await resetDb()
  await getTestDb().delete(financeTransactions)
}

async function seedPerson(id = 'p1', name = 'דנה') {
  await getTestDb().insert(people).values({ id, name, status: 'confirmed', source: 'manual', createdAt: NOW })
}

async function seedUpcomingMeeting(personId = 'p1') {
  const db = getTestDb()
  await db.insert(meetings).values({
    id: 'm1', title: 'סטטוס שבועי', date: iso(2), time: '10:00', createdAt: NOW, updatedAt: NOW,
  })
  await db.insert(meetingPeople).values({ meetingId: 'm1', personId })
}

async function seedCommitment(id = 'c1', personId = 'p1', createdAt = NOW, owner = 'me') {
  await getTestDb().insert(commitments).values({
    id, personId, owner, content: 'לשלוח הצעת מחיר',
    source: 'whatsapp_dm', status: 'proposed', createdAt, updatedAt: createdAt,
  })
}

describe('detector: silent_before_meeting', () => {
  beforeEach(async () => {
    await resetAll()
    await seedPerson()
  })

  it('fires when an attendee with an open commitment has gone quiet', async () => {
    await seedUpcomingMeeting()
    await seedCommitment()
    const insights = await runDetectors(getTestDb())

    const hit = insights.find((i) => i.kind === 'silent_before_meeting')
    expect(hit).toBeDefined()
    expect(hit?.severity).toBe('urgent') // owner is 'me'
    expect(hit?.personId).toBe('p1')
    expect(hit?.sources.map((s) => s.kind)).toEqual(expect.arrayContaining(['person', 'meeting', 'commitment']))
  })

  it('stays quiet when the person messaged recently', async () => {
    await seedUpcomingMeeting()
    await seedCommitment()
    await getTestDb().insert(whatsappDmMessages).values({
      id: 'w1', personId: 'p1', whatsappJid: '972500000000@s.whatsapp.net', waMessageId: 'wa1',
      fromMe: false, text: 'מתי נדבר?', ts: Date.now() - 86_400_000, createdAt: NOW,
    })

    const insights = await runDetectors(getTestDb())
    expect(insights.find((i) => i.kind === 'silent_before_meeting')).toBeUndefined()
  })

  it('stays quiet with no open commitment — silence alone is not a signal', async () => {
    await seedUpcomingMeeting()
    const insights = await runDetectors(getTestDb())
    expect(insights.find((i) => i.kind === 'silent_before_meeting')).toBeUndefined()
  })
})

describe('detector: stale_commitment', () => {
  beforeEach(async () => {
    await resetAll()
    await seedPerson()
  })

  it('fires on a commitment nobody closed for three weeks', async () => {
    await seedCommitment('c_old', 'p1', isoTs(30))
    const insights = await runDetectors(getTestDb())

    const hit = insights.find((i) => i.kind === 'stale_commitment')
    expect(hit).toBeDefined()
    expect(hit?.body).toContain('לשלוח הצעת מחיר')
  })

  it('leaves a fresh commitment alone', async () => {
    await seedCommitment('c_new', 'p1', NOW)
    const insights = await runDetectors(getTestDb())
    expect(insights.find((i) => i.kind === 'stale_commitment')).toBeUndefined()
  })
})

describe('detector: spend_spike_vs_meetings', () => {
  beforeEach(resetAll)

  it('fires when the month runs well above the trailing average', async () => {
    const db = getTestDb()
    const monthStart = `${new Date().toISOString().slice(0, 7)}-01`
    const rows = [
      { id: 't_now', amount: '9000', transactionDate: monthStart },
      { id: 't_old1', amount: '1000', transactionDate: iso(-40) },
      { id: 't_old2', amount: '1000', transactionDate: iso(-70) },
    ]
    await db.insert(financeTransactions).values(
      rows.map((r) => ({ ...r, currency: 'ILS', direction: 'out', source: 'bank', createdAt: NOW })),
    )

    const insights = await runDetectors(db)
    expect(insights.find((i) => i.kind === 'spend_spike_vs_meetings')).toBeDefined()
  })

  it('stays quiet with no trailing history to compare against', async () => {
    const db = getTestDb()
    await db.insert(financeTransactions).values({
      id: 't_only', amount: '9000', currency: 'ILS', direction: 'out',
      transactionDate: `${new Date().toISOString().slice(0, 7)}-01`, source: 'bank', createdAt: NOW,
    })
    const insights = await runDetectors(db)
    expect(insights.find((i) => i.kind === 'spend_spike_vs_meetings')).toBeUndefined()
  })
})

describe('phraseInsights', () => {
  const draft: HarnessInsightDraft = {
    kind: 'stale_commitment', title: 'כותרת', body: 'גוף', severity: 'attention',
    score: 0.5, personId: 'p1', sources: [], dedupeKey: 'k1', ttlDays: 7,
  }

  it('returns the deterministic Hebrew text when no Gemini key is configured', async () => {
    const previous = process.env.GEMINI_API_KEY
    delete process.env.GEMINI_API_KEY
    try {
      const result = await phraseInsights([draft])
      expect(result.model).toBeNull()
      expect(result.insights[0].title).toBe('כותרת')
    } finally {
      if (previous) process.env.GEMINI_API_KEY = previous
    }
  })

  it('short-circuits on an empty list', async () => {
    expect(await phraseInsights([])).toEqual({ insights: [], model: null })
  })
})

describe('persistInsights', () => {
  const draft: HarnessInsightDraft = {
    kind: 'stale_commitment', title: 'כותרת', body: 'גוף', severity: 'attention',
    score: 0.5, personId: null, sources: [{ nodeId: 'commitment:c1', kind: 'commitment', label: 'הצעה' }],
    dedupeKey: 'stale_commitment:c1', ttlDays: 7,
  }

  beforeEach(resetAll)

  it('creates once and updates on re-fire', async () => {
    const db = getTestDb()
    expect(await persistInsights(db, [draft])).toEqual({ created: 1, updated: 0 })
    expect(await persistInsights(db, [{ ...draft, title: 'כותרת חדשה' }])).toEqual({ created: 0, updated: 1 })

    const rows = await db.select().from(harnessInsights)
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('כותרת חדשה')
  })

  it('keeps a dismissed insight dismissed when the detector fires again', async () => {
    const db = getTestDb()
    await persistInsights(db, [draft])
    const [row] = await db.select().from(harnessInsights)
    await dismissInsight(db, row.id)

    await persistInsights(db, [draft])

    const [after] = await db.select().from(harnessInsights).where(eq(harnessInsights.id, row.id))
    expect(after.status).toBe('dismissed')
    expect(await listOpenInsights(db)).toHaveLength(0)
  })
})

describe('listOpenInsights', () => {
  beforeEach(resetAll)

  it('orders by score, filters by severity, and hides expired rows', async () => {
    const db = getTestDb()
    await persistInsights(db, [
      { kind: 'a', title: 'low', body: 'b', severity: 'info', score: 0.2, personId: null, sources: [], dedupeKey: 'a', ttlDays: 7 },
      { kind: 'b', title: 'high', body: 'b', severity: 'urgent', score: 0.9, personId: null, sources: [], dedupeKey: 'b', ttlDays: 7 },
      { kind: 'c', title: 'gone', body: 'b', severity: 'urgent', score: 1, personId: null, sources: [], dedupeKey: 'c', ttlDays: -1 },
    ])

    const all = await listOpenInsights(db)
    expect(all.map((i) => i.title)).toEqual(['high', 'low'])
    expect(await listOpenInsights(db, { severity: 'urgent' })).toHaveLength(1)
    expect(await listOpenInsights(db, { limit: 1 })).toHaveLength(1)
  })

  it('parses source attribution back into objects', async () => {
    const db = getTestDb()
    await persistInsights(db, [{
      kind: 'a', title: 't', body: 'b', severity: 'info', score: 0.5, personId: null,
      sources: [{ nodeId: 'person:p1', kind: 'person', label: 'דנה' }], dedupeKey: 'a', ttlDays: 7,
    }])

    const [insight] = await listOpenInsights(db)
    expect(insight.sources).toEqual([{ nodeId: 'person:p1', kind: 'person', label: 'דנה' }])
  })
})

describe('reasonAndPersist', () => {
  beforeEach(async () => {
    await resetAll()
    await seedPerson()
  })

  it('runs end to end without a Gemini key', async () => {
    const previous = process.env.GEMINI_API_KEY
    delete process.env.GEMINI_API_KEY
    try {
      await seedUpcomingMeeting()
      await seedCommitment()
      const result = await reasonAndPersist(getTestDb())

      expect(result.model).toBeNull()
      expect(result.created).toBeGreaterThan(0)
      expect(result.insights.every((i) => i.title.length > 0)).toBe(true)
      expect(result.insights.every((i) => i.sources.length > 0)).toBe(true)
    } finally {
      if (previous) process.env.GEMINI_API_KEY = previous
    }
  })
})

describe('formatInsightLines', () => {
  it('marks urgent lines and leaves the rest with a bullet', () => {
    const lines = formatInsightLines([
      { id: '1', kind: 'a', title: 'דחוף', body: 'גוף', severity: 'urgent', score: 1, personId: null, sources: [], generatedAt: NOW },
      { id: '2', kind: 'b', title: 'רגיל', body: 'גוף', severity: 'info', score: 0.1, personId: null, sources: [], generatedAt: NOW },
    ])
    expect(lines).toEqual(['❗ דחוף — גוף', '• רגיל — גוף'])
  })
})
