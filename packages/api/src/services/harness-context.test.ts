import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  commitments,
  financeTransactions,
  harnessEdges,
  harnessNodes,
  meetingPeople,
  meetings,
  people,
  personEmailThreads,
  whatsappDmMessages,
} from '@ak-system/database'
import { getTestDb, resetDb } from '../test-utils'
import { indexHarnessWorld, personSignals, worldStateSummary } from './harness-context'

const NOW = new Date().toISOString()
const iso = (daysFromNow: number) => new Date(Date.now() + daysFromNow * 86_400_000).toISOString().slice(0, 10)

async function seedWorld() {
  const db = getTestDb()
  await db.insert(people).values([
    { id: 'p1', name: 'דנה', role: 'CTO', company: 'Acme', status: 'confirmed', source: 'manual', createdAt: NOW },
    { id: 'p2', name: 'יוסי', status: 'unconfirmed', source: 'manual', createdAt: NOW },
  ])
  await db.insert(meetings).values({
    id: 'm1', title: 'סטטוס שבועי', date: iso(1), time: '10:00', createdAt: NOW, updatedAt: NOW,
  })
  await db.insert(meetingPeople).values({ meetingId: 'm1', personId: 'p1' })
  await db.insert(commitments).values({
    id: 'c1', personId: 'p1', owner: 'me', content: 'לשלוח הצעת מחיר',
    source: 'whatsapp_dm', status: 'proposed', createdAt: NOW, updatedAt: NOW,
  })
  await db.insert(whatsappDmMessages).values({
    id: 'w1', personId: 'p1', whatsappJid: '972500000000@s.whatsapp.net', waMessageId: 'wa1',
    fromMe: false, text: 'מתי נדבר?', ts: Date.now() - 86_400_000, createdAt: NOW,
  })
}

describe('indexHarnessWorld', () => {
  beforeEach(async () => {
    await resetDb()
    await seedWorld()
  })

  it('indexes every domain into nodes and links them with edges', async () => {
    const db = getTestDb()
    const result = await indexHarnessWorld(db)

    expect(result.nodes).toBeGreaterThan(0)
    expect(result.byScope.people).toBe(1) // unconfirmed people stay out
    expect(result.byScope.meetings).toBe(1)
    expect(result.byScope.commitments).toBe(1)

    const nodes = await db.select().from(harnessNodes)
    const kinds = new Set(nodes.map((n) => n.kind))
    expect(kinds).toContain('person')
    expect(kinds).toContain('meeting')
    expect(kinds).toContain('commitment')
    expect(kinds).toContain('whatsapp_signal')

    const edges = await db.select().from(harnessEdges)
    expect(edges.map((e) => e.kind)).toEqual(expect.arrayContaining(['ATTENDED', 'HAS_COMMITMENT', 'MENTIONED_IN']))
  })

  it('upserts on re-index rather than duplicating', async () => {
    const db = getTestDb()
    await indexHarnessWorld(db)
    const firstNodes = (await db.select().from(harnessNodes)).length
    const firstEdges = (await db.select().from(harnessEdges)).length

    await indexHarnessWorld(db)

    expect((await db.select().from(harnessNodes)).length).toBe(firstNodes)
    expect((await db.select().from(harnessEdges)).length).toBe(firstEdges)
  })

  it('refreshes a node label when the source row changes', async () => {
    const db = getTestDb()
    await indexHarnessWorld(db)
    await db.update(people).set({ name: 'דנה כהן' }).where(eq(people.id, 'p1'))
    await indexHarnessWorld(db, { scopes: ['people'] })

    const [node] = await db.select().from(harnessNodes).where(eq(harnessNodes.id, 'person:p1'))
    expect(node.label).toBe('דנה כהן')
  })

  it('honours the requested scopes', async () => {
    const db = getTestDb()
    const result = await indexHarnessWorld(db, { scopes: ['people'] })

    expect(result.byScope).toEqual({ people: 1 })
    const kinds = new Set((await getTestDb().select().from(harnessNodes)).map((n) => n.kind))
    expect(kinds).toEqual(new Set(['person']))
  })
})

describe('indexHarnessWorld — date shapes from real sources', () => {
  beforeEach(async () => {
    await resetDb()
    await getTestDb().delete(financeTransactions)
    await seedWorld()
  })

  /**
   * The bank scrapers write a full ISO timestamp into `transaction_date`, not the
   * `YYYY-MM-DD` the calendar tables use. Appending a time to that produced an invalid
   * date, and the resulting NaN weight hit the NOT NULL column in production.
   */
  it('handles a full ISO timestamp in transaction_date without producing a NaN weight', async () => {
    const db = getTestDb()
    await db.insert(financeTransactions).values({
      id: 't_iso', amount: '250', currency: 'ILS', direction: 'out',
      description: 'ארוחה', transactionDate: `${iso(1)}T14:06:10.000Z`,
      source: 'bank', createdAt: NOW,
    })

    await expect(indexHarnessWorld(db)).resolves.toBeDefined()

    const spendEdges = await db.select().from(harnessEdges).where(eq(harnessEdges.kind, 'TRIGGERED_SPEND'))
    expect(spendEdges.length).toBeGreaterThan(0)
    for (const e of spendEdges) expect(Number.isFinite(e.weight)).toBe(true)

    const [node] = await db.select().from(harnessNodes).where(eq(harnessNodes.id, 'financial_event:t_iso'))
    expect(node.occurredAt).toBe(`${iso(1)}T12:00:00.000Z`)
  })

  it('skips a transaction whose date cannot be parsed instead of failing the run', async () => {
    const db = getTestDb()
    await db.insert(financeTransactions).values({
      id: 't_bad', amount: '250', currency: 'ILS', direction: 'out',
      description: 'פגום', transactionDate: 'not-a-date', source: 'bank', createdAt: NOW,
    })

    await expect(indexHarnessWorld(db)).resolves.toBeDefined()
    const edges = await db.select().from(harnessEdges).where(eq(harnessEdges.toId, 'financial_event:t_bad'))
    expect(edges).toEqual([])
  })

  it('tolerates the far-future sentinel date used by open-ended meetings', async () => {
    const db = getTestDb()
    await db.insert(meetings).values({
      id: 'm_sentinel', title: 'ללא תאריך', date: '9999-12-31', time: '00:00', createdAt: NOW, updatedAt: NOW,
    })
    await expect(indexHarnessWorld(db)).resolves.toBeDefined()
  })
})

describe('worldStateSummary', () => {
  beforeEach(async () => {
    await resetDb()
    await seedWorld()
  })

  it('counts nodes and edges per kind and reports freshness', async () => {
    const db = getTestDb()
    await indexHarnessWorld(db)
    const summary = await worldStateSummary(db)

    expect(summary.nodesByKind.person).toBe(1)
    expect(summary.nodesByKind.meeting).toBe(1)
    expect(summary.edgesByKind.ATTENDED).toBe(1)
    expect(summary.lastIndexedAt).toBeTruthy()
  })

  it('returns empty counts before the first index', async () => {
    const summary = await worldStateSummary(getTestDb())
    expect(summary.nodesByKind).toEqual({})
    expect(summary.lastIndexedAt).toBeNull()
  })
})

describe('personSignals', () => {
  beforeEach(async () => {
    await resetDb()
    await seedWorld()
  })

  it('gathers every domain reachable from one person', async () => {
    const db = getTestDb()
    await indexHarnessWorld(db)
    const signals = await personSignals(db, 'p1')

    expect(signals?.person.name).toBe('דנה')
    expect(signals?.meetings).toHaveLength(1)
    expect(signals?.commitments).toHaveLength(1)
    expect(signals?.commitments[0].owner).toBe('me')
    expect(signals?.whatsapp).toHaveLength(1)
    expect(signals?.lastSignalAt).toBeTruthy()
  })

  it('returns null for an unknown person', async () => {
    expect(await personSignals(getTestDb(), 'nope')).toBeNull()
  })

  it('returns empty lists for a person with no indexed edges', async () => {
    const db = getTestDb()
    await db.insert(people).values({ id: 'p3', name: 'אורח', status: 'confirmed', source: 'manual', createdAt: NOW })
    await indexHarnessWorld(db)
    const signals = await personSignals(db, 'p3')

    expect(signals?.meetings).toEqual([])
    expect(signals?.lastSignalAt).toBeNull()
  })
})

describe('indexHarnessWorld — email scope', () => {
  const THREAD_KEY = 'alpirkritz@gmail.com::thr_abc'

  beforeEach(async () => {
    await resetDb()
    await seedWorld()
    const db = getTestDb()
    await db.insert(personEmailThreads).values({
      id: 'pet1',
      personId: 'p1',
      gmailThreadId: THREAD_KEY,
      accountEmail: 'alpirkritz@gmail.com',
      subject: 'הצעה להרצאת אורח לסטודנטים',
      from: 'Dana <dana@acme.com>',
      to: 'alpirkritz@gmail.com',
      date: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      snippet: 'שמח לשמוע, נתקדם',
      messageCount: 3,
      lastSyncedAt: NOW,
      createdAt: NOW,
    })
  })

  it('indexes a thread as a node and links the person to it', async () => {
    const db = getTestDb()
    const result = await indexHarnessWorld(db)

    expect(result.byScope.email).toBe(1)

    const [node] = await db.select().from(harnessNodes).where(eq(harnessNodes.kind, 'email_thread'))
    expect(node.label).toBe('הצעה להרצאת אורח לסטודנטים')
    expect(node.summary).toBe('שמח לשמוע, נתקדם')

    const attrs = JSON.parse(node.attrs!) as { gmailUrl: string; messageCount: number }
    expect(attrs.messageCount).toBe(3)
    expect(attrs.gmailUrl).toContain('mail.google.com')
    expect(attrs.gmailUrl).toContain('thr_abc')

    const edges = await db.select().from(harnessEdges).where(eq(harnessEdges.toId, 'email_thread:pet1'))
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ fromId: 'person:p1', kind: 'MENTIONED_IN' })
  })

  it('never puts a message body in the node — only subject and snippet exist to index', async () => {
    const db = getTestDb()
    await indexHarnessWorld(db)
    const [node] = await db.select().from(harnessNodes).where(eq(harnessNodes.kind, 'email_thread'))
    const columns = Object.values(node).join(' ')
    expect(columns).not.toContain('dana@acme.com')
  })

  it('joins an email-sourced commitment back to the thread that produced it', async () => {
    const db = getTestDb()
    await db.insert(commitments).values({
      id: 'c_email', personId: 'p1', owner: 'me', content: 'לשלוח מבנה להרצאה',
      source: 'email', sourceId: THREAD_KEY, status: 'proposed', createdAt: NOW, updatedAt: NOW,
    })

    await indexHarnessWorld(db)

    const edges = await db.select().from(harnessEdges).where(eq(harnessEdges.kind, 'RELATED_TO'))
    const link = edges.find((e) => e.toId === 'commitment:c_email')
    expect(link).toMatchObject({ fromId: 'email_thread:pet1', kind: 'RELATED_TO' })
    expect(link!.weight).toBe(1)
  })

  it('does not link a commitment whose source is a different channel', async () => {
    const db = getTestDb()
    await db.insert(commitments).values({
      id: 'c_wa', personId: 'p1', owner: 'me', content: 'מוואטסאפ',
      source: 'whatsapp_dm', sourceId: THREAD_KEY, status: 'proposed', createdAt: NOW, updatedAt: NOW,
    })

    await indexHarnessWorld(db)

    const edges = await db.select().from(harnessEdges).where(eq(harnessEdges.kind, 'RELATED_TO'))
    expect(edges.some((e) => e.toId === 'commitment:c_wa')).toBe(false)
  })

  it('surfaces the thread with its Gmail link in personSignals', async () => {
    const db = getTestDb()
    await indexHarnessWorld(db)

    const signals = await personSignals(db, 'p1')
    expect(signals!.emails).toHaveLength(1)
    expect(signals!.emails[0]).toMatchObject({
      subject: 'הצעה להרצאת אורח לסטודנטים',
      messageCount: 3,
    })
    expect(signals!.emails[0].gmailUrl).toContain('thr_abc')
  })

  it('leaves gmailUrl null for a malformed thread key rather than building a broken link', async () => {
    const db = getTestDb()
    await db.update(personEmailThreads).set({ gmailThreadId: 'no-separator' }).where(eq(personEmailThreads.id, 'pet1'))

    await indexHarnessWorld(db)

    const signals = await personSignals(db, 'p1')
    expect(signals!.emails[0].gmailUrl).toBeNull()
  })

  it('skips the scope entirely when it is not requested', async () => {
    const db = getTestDb()
    const result = await indexHarnessWorld(db, { scopes: ['people'] })
    expect(result.byScope.email).toBeUndefined()
    const nodes = await db.select().from(harnessNodes).where(eq(harnessNodes.kind, 'email_thread'))
    expect(nodes).toHaveLength(0)
  })
})
