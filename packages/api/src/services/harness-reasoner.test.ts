import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  commitments,
  financeTransactions,
  harnessInsights,
  meetingPeople,
  meetings,
  people,
  personEmailThreads,
  projects,
  salesDocumentPayments,
  salesDocuments,
  vatEntries,
  whatsappDmMessages,
} from '@ak-system/database'
import { getTestDb, resetDb } from '../test-utils'
import {
  closeInsightsForCommitment,
  dismissInsight,
  formatInsightLines,
  listOpenInsights,
  onePerPerson,
  persistInsights,
  phraseInsights,
  reasonAndPersist,
  runDetectors,
  selectInsightsToPush,
  type HarnessInsightDraft,
} from './harness-reasoner'

const NOW = new Date().toISOString()
const iso = (daysFromNow: number) => new Date(Date.now() + daysFromNow * 86_400_000).toISOString().slice(0, 10)
const isoTs = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString()

/** `resetDb` leaves finance, invoices, and VAT alone — those suites clear their own rows.
 *  Detectors read all three, so this file has to clear them or a previous suite leaves
 *  an insight open and retire-on-miss fails. */
async function resetAll() {
  await resetDb()
  const db = getTestDb()
  await db.delete(salesDocumentPayments)
  await db.delete(salesDocuments)
  await db.delete(financeTransactions)
  await db.delete(vatEntries)
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

async function seedCommitment(id = 'c1', personId = 'p1', createdAt = NOW, owner = 'me', status = 'accepted') {
  await getTestDb().insert(commitments).values({
    id, personId, owner, content: 'לשלוח הצעת מחיר',
    source: 'whatsapp_dm', status, createdAt, updatedAt: createdAt,
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
      { id: '1', kind: 'a', title: 'דחוף', body: 'גוף', severity: 'urgent', score: 1, personId: null, sources: [], generatedAt: NOW, notifiedAt: null },
      { id: '2', kind: 'b', title: 'רגיל', body: 'גוף', severity: 'info', score: 0.1, personId: null, sources: [], generatedAt: NOW, notifiedAt: null },
    ])
    expect(lines).toEqual(['❗ דחוף — גוף', '• רגיל — גוף'])
  })
})

describe('detectors — accepted-only', () => {
  beforeEach(async () => {
    await resetAll()
    await seedPerson()
  })

  it('silent_before_meeting: proposed commitment is not a signal', async () => {
    await seedUpcomingMeeting()
    await seedCommitment('c1', 'p1', NOW, 'me', 'proposed')
    const insights = await runDetectors(getTestDb())
    expect(insights.find((i) => i.kind === 'silent_before_meeting')).toBeUndefined()
  })

  it('stale_commitment: proposed commitment is not a signal', async () => {
    await seedCommitment('c_old', 'p1', isoTs(30), 'me', 'proposed')
    const insights = await runDetectors(getTestDb())
    expect(insights.find((i) => i.kind === 'stale_commitment')).toBeUndefined()
  })

  it('stale_commitment: accepted commitment is a signal', async () => {
    await seedCommitment('c_old', 'p1', isoTs(30), 'me', 'accepted')
    const insights = await runDetectors(getTestDb())
    expect(insights.find((i) => i.kind === 'stale_commitment')).toBeDefined()
  })
})

describe('retire-on-miss', () => {
  beforeEach(resetAll)

  it('retires an open insight whose dedupeKey is not in the current run', async () => {
    const db = getTestDb()
    const draft: HarnessInsightDraft = {
      kind: 'stale_commitment', title: 'ישן', body: 'ב', severity: 'attention',
      score: 0.5, personId: null, sources: [], dedupeKey: 'stale_commitment:c_gone', ttlDays: 14,
    }
    await persistInsights(db, [draft])

    // Second run emits a completely different set — the first insight should be retired.
    const different: HarnessInsightDraft = {
      kind: 'spend_spike_vs_meetings', title: 'חדש', body: 'ב', severity: 'attention',
      score: 0.5, personId: null, sources: [], dedupeKey: 'spend_spike_vs_meetings:2026-10', ttlDays: 7,
    }
    await reasonAndPersist(db)  // no real data so detectors fire nothing; all open insights get retired

    const all = await db.select().from(harnessInsights)
    expect(all.every((r) => r.status === 'retired')).toBe(true)
    expect(await listOpenInsights(db)).toHaveLength(0)
  })
})

describe('closeInsightsForCommitment', () => {
  beforeEach(resetAll)

  it('dismisses open insights whose sources include the given commitment', async () => {
    const db = getTestDb()
    await persistInsights(db, [{
      kind: 'silent_before_meeting', title: 'שתיקה', body: 'ב', severity: 'attention',
      score: 0.6, personId: null,
      sources: [{ nodeId: 'commitment:c_target', kind: 'commitment', label: 'לשלוח' }],
      dedupeKey: 'silent_before_meeting:m1:p1', ttlDays: 7,
    }])

    await closeInsightsForCommitment(db, 'c_target')

    const [row] = await db.select().from(harnessInsights)
    expect(row.status).toBe('dismissed')
  })

  it('leaves insights that do not reference the commitment untouched', async () => {
    const db = getTestDb()
    await persistInsights(db, [{
      kind: 'spend_spike_vs_meetings', title: 'הוצאות', body: 'ב', severity: 'attention',
      score: 0.5, personId: null,
      sources: [{ nodeId: 'month:2026-10', kind: 'financial_event', label: 'הוצאות' }],
      dedupeKey: 'spend_spike:2026-10', ttlDays: 7,
    }])

    await closeInsightsForCommitment(db, 'c_unrelated')

    const [row] = await db.select().from(harnessInsights)
    expect(row.status).toBe('open')
  })
})

async function seedThread(id: string, subject: string, snippet: string, extra: { replyNeed?: string } = {}) {
  await getTestDb().insert(personEmailThreads).values({
    id,
    personId: 'p1',
    gmailThreadId: `me@x.com::${id}`,
    accountEmail: 'me@x.com',
    subject,
    from: 'Dana <dana@x.com>',
    to: 'me@x.com',
    date: isoTs(10),
    snippet,
    messageCount: 1,
    replyNeed: extra.replyNeed ?? null,
    lastSyncedAt: NOW,
    createdAt: NOW,
  })
}

describe('situation detectors', () => {
  beforeEach(async () => {
    await resetAll()
    await seedPerson()
  })

  it('flags a recent meeting that had an attendee and produced nothing', async () => {
    const db = getTestDb()
    await db.insert(meetings).values({
      id: 'm_old', title: 'סיכום לקוח', date: iso(-1), time: '10:00', createdAt: NOW, updatedAt: NOW,
    })
    await db.insert(meetingPeople).values({ meetingId: 'm_old', personId: 'p1' })

    const hit = (await runDetectors(db)).find((i) => i.kind === 'meeting_no_followthrough')
    expect(hit?.personId).toBeNull()
    expect(hit?.title).toContain('סיכום לקוח')
  })

  it('stays quiet when the meeting already has notes', async () => {
    const db = getTestDb()
    await db.insert(meetings).values({
      id: 'm_old', title: 'סיכום לקוח', date: iso(-1), time: '10:00', notes: 'דיברנו', createdAt: NOW, updatedAt: NOW,
    })
    await db.insert(meetingPeople).values({ meetingId: 'm_old', personId: 'p1' })
    expect((await runDetectors(db)).find((i) => i.kind === 'meeting_no_followthrough')).toBeUndefined()
  })

  it('flags overlapping meetings today as urgent', async () => {
    const db = getTestDb()
    await db.insert(meetings).values([
      { id: 'a', title: 'א', date: iso(0), time: '10:00', endTime: '11:00', createdAt: NOW, updatedAt: NOW },
      { id: 'b', title: 'ב', date: iso(0), time: '10:30', endTime: '11:30', createdAt: NOW, updatedAt: NOW },
    ])
    const hit = (await runDetectors(db)).find((i) => i.kind === 'calendar_overload')
    expect(hit?.severity).toBe('urgent')
    expect(hit?.personId).toBeNull()
  })

  it('turns a due promise with no task into one card and keeps it out of stale', async () => {
    const db = getTestDb()
    await db.insert(commitments).values({
      id: 'c_due', personId: 'p1', owner: 'me', content: 'לשלוח הצעה',
      source: 'whatsapp_dm', status: 'accepted', dueInferred: iso(-1),
      createdAt: isoTs(30), updatedAt: isoTs(30),
    })
    const insights = await runDetectors(db)
    expect(insights.find((i) => i.kind === 'commitment_due_no_task')?.severity).toBe('urgent')
    expect(insights.find((i) => i.kind === 'stale_commitment')).toBeUndefined()
  })

  it('piles proposed commitments that are not already due', async () => {
    const db = getTestDb()
    await db.insert(commitments).values([1, 2, 3].map((n) => ({
      id: `c_p${n}`, personId: 'p1', owner: 'them', content: `הבטחה ${n}`,
      source: 'whatsapp_dm', status: 'proposed', createdAt: isoTs(5), updatedAt: isoTs(5),
    })))
    const hit = (await runDetectors(db)).find((i) => i.kind === 'proposed_commitment_pile')
    expect(hit?.title).toContain('3')
    expect(hit?.personId).toBeNull()
  })

  it('flags an issued invoice past its due date', async () => {
    const db = getTestDb()
    await db.delete(salesDocumentPayments)
    await db.delete(salesDocuments)
    await db.insert(salesDocuments).values({
      id: 'inv1', docType: 'tax_invoice', status: 'issued', issueDate: iso(-40), dueDate: iso(-20),
      clientName: 'דגימה', total: '1000', createdAt: NOW, updatedAt: NOW,
    })
    const hit = (await runDetectors(db)).find((i) => i.kind === 'unpaid_invoice')
    expect(hit?.severity).toBe('urgent')
    expect(hit?.personId).toBeNull()
  })

  it('flags a project that moved and then stopped', async () => {
    const db = getTestDb()
    await db.insert(projects).values({ id: 'pr1', name: 'אלגו', source: 'manual', createdAt: NOW, updatedAt: NOW })
    await db.insert(meetings).values({
      id: 'm_p', title: 'סטטוס', date: iso(-40), time: '09:00', projectId: 'pr1', createdAt: NOW, updatedAt: NOW,
    })
    const hit = (await runDetectors(db)).find((i) => i.kind === 'project_gone_quiet')
    expect(hit?.body).toContain('אלגו')
    expect(hit?.personId).toBeNull()
  })

  it('counts ask-emails and ignores FYI, as one card', async () => {
    await seedThread('t1', 'תקציב', 'אפשר לשלוח את הקובץ')
    await seedThread('t2', 'הצעה', 'תוכל לאשר')
    await seedThread('t3', 'שאלה', 'מתי?')
    await seedThread('t4', 'לידיעה', 'תוכל להתעלם')

    const db = getTestDb()
    const hit = (await runDetectors(db)).find((i) => i.kind === 'reply_backlog')
    expect(hit?.title).toContain('3')
    expect(hit?.personId).toBeNull()
    const [fyi] = await db.select().from(personEmailThreads).where(eq(personEmailThreads.id, 't4'))
    expect(fyi.replyNeed).toBe('fyi')
  })

  it('does not treat an FYI thread as unanswered before a meeting', async () => {
    await seedUpcomingMeeting()
    await seedThread('t_fyi', 'לידיעה', 'מצורף לעיון')
    const insights = await runDetectors(getTestDb())
    expect(insights.find((i) => i.kind === 'unanswered_thread')).toBeUndefined()
  })

  it('does treat an ask as unanswered before a meeting', async () => {
    await seedUpcomingMeeting()
    await seedThread('t_ask', 'תקציב', 'אפשר לשלוח')
    const hit = (await runDetectors(getTestDb())).find((i) => i.kind === 'unanswered_thread')
    expect(hit?.personId).toBe('p1')
  })

  it('opens the VAT window in the first days of a filing month', async () => {
    const hit = (await runDetectors(getTestDb(), new Date('2026-11-05T12:00:00.000Z')))
      .find((i) => i.kind === 'vat_filing_window')
    expect(hit?.severity).toBe('attention')
    expect(hit?.dedupeKey).toBe('vat_filing_window:2026:5')
    expect(hit?.personId).toBeNull()
  })

  it('stays quiet on VAT outside a filing month', async () => {
    const hit = (await runDetectors(getTestDb(), new Date('2026-10-12T12:00:00.000Z')))
      .find((i) => i.kind === 'vat_filing_window')
    expect(hit).toBeUndefined()
  })
})

describe('selectInsightsToPush', () => {
  const row = (kind: string, severity: string, notifiedAt: string | null = null) =>
    ({ kind, severity, notifiedAt })

  it('pushes urgent cards and up to three situation attention cards', () => {
    const picked = selectInsightsToPush([
      row('silent_before_meeting', 'urgent'),
      row('silent_before_meeting', 'attention'),
      row('meeting_no_followthrough', 'attention'),
      row('reply_backlog', 'attention'),
      row('unpaid_invoice', 'attention', NOW),
      row('project_gone_quiet', 'attention'),
      row('vat_filing_window', 'attention'),
    ])
    expect(picked.map((i) => i.kind)).toEqual([
      'silent_before_meeting',
      'meeting_no_followthrough',
      'reply_backlog',
      'project_gone_quiet',
    ])
  })
})

describe('owner is never the subject', () => {
  beforeEach(async () => {
    await resetAll()
  })

  it('silent_before_meeting and stale_commitment ignore the owner\'s own contact row', async () => {
    await seedPerson('p_me', 'Alpir Kritzler')
    await seedUpcomingMeeting('p_me')
    await seedCommitment('c_me', 'p_me', isoTs(40))
    const insights = await runDetectors(getTestDb())
    expect(insights.filter((i) => i.personId === 'p_me')).toEqual([])
  })

  it('matches the Hebrew alias too', async () => {
    await seedPerson('p_me2', 'אלפיר קריצלר')
    await seedUpcomingMeeting('p_me2')
    await seedCommitment('c_me2', 'p_me2', isoTs(40))
    const insights = await runDetectors(getTestDb())
    expect(insights.filter((i) => i.personId === 'p_me2')).toEqual([])
  })

  it('still reports someone else', async () => {
    await seedPerson('p_me', 'Alpir Kritzler')
    await seedPerson('p1', 'דנה')
    await seedUpcomingMeeting('p1')
    await seedCommitment('c1', 'p1')
    const insights = await runDetectors(getTestDb())
    expect(insights.some((i) => i.personId === 'p1')).toBe(true)
  })
})

describe('onePerPerson', () => {
  const draft = (dedupeKey: string, personId: string | null, score: number): HarnessInsightDraft => ({
    kind: 'x', title: dedupeKey, body: '', severity: 'attention', score, personId, sources: [], dedupeKey, ttlDays: 1,
  })

  it('keeps the strongest card per person and leaves person-less cards alone', () => {
    const out = onePerPerson([
      draft('a', 'p1', 0.5), draft('b', 'p1', 0.9), draft('c', 'p2', 0.4), draft('d', null, 0.1), draft('e', null, 0.2),
    ])
    expect(out.map((d) => d.dedupeKey)).toEqual(['b', 'c', 'd', 'e'])
  })

  it('collapses a person who trips two detectors into one card end to end', async () => {
    await resetAll()
    await seedPerson()
    await seedUpcomingMeeting()
    await seedCommitment('c1', 'p1', isoTs(40))
    const insights = await runDetectors(getTestDb())
    expect(insights.filter((i) => i.personId === 'p1')).toHaveLength(1)
  })
})
