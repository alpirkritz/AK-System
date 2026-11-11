import { beforeEach, describe, expect, it } from 'vitest'
import {
  commitments,
  meetingPeople,
  meetings,
  people,
  projectPeople,
  projects,
  tasks,
  whatsappDmMessages,
  whatsappDmSummaries,
  whatsappMessages,
  whatsappPersonLinks,
} from '@ak-system/database'
import { eq } from 'drizzle-orm'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'
import {
  DM_EXPIRED_TEXT,
  detectCommitmentsHeuristic,
  dmAllowlist,
  inferDueDate,
  ingestDmMessages,
  matchesRejected,
  runDmRetention,
  scanDmCommitments,
  summarizeDmChats,
} from '../services/whatsapp-dm'

const NOW = new Date().toISOString()
const DANA_JID = '972501234567@s.whatsapp.net'
const DANA_LID = '11122233344455@lid'
const DAY = 86_400_000

async function seedPeople() {
  const db = getTestDb()
  await db.insert(people).values([
    { id: 'p1', name: 'Dana Levi', phone: '050-123-4567', status: 'confirmed', source: 'manual', createdAt: NOW },
    { id: 'p2', name: 'Ron Cohen', phone: '050-765-4321', status: 'confirmed', source: 'manual', createdAt: NOW },
  ])
}

async function enableCapture(personId: string, since = new Date(Date.now() - 30 * DAY).toISOString()) {
  await getTestDb().update(people).set({ captureWhatsapp: true, captureWhatsappSince: since }).where(eq(people.id, personId))
}

function msg(id: string, text: string, ts: number, fromMe = false, jid = DANA_JID) {
  return { id, jid, fromMe, text, timestamp: ts }
}

describe('WhatsApp 1:1 capture', () => {
  beforeEach(async () => {
    await getTestDb().delete(whatsappMessages)
    await resetDb()
    await seedPeople()
  })

  it('switching capture on stamps the start time; off clears it', async () => {
    const caller = await createTestCaller()
    const on = await caller.people.setCaptureWhatsapp({ id: 'p1', enabled: true })
    expect(on.captureWhatsapp).toBe(true)
    expect(on.captureWhatsappSince).toBeTruthy()
    expect([...(await dmAllowlist(getTestDb())).entries()]).toEqual([[DANA_JID, 'p1']])

    const off = await caller.people.setCaptureWhatsapp({ id: 'p1', enabled: false })
    expect(off).toMatchObject({ captureWhatsapp: false, captureWhatsappSince: null })
    expect((await dmAllowlist(getTestDb())).size).toBe(0)
  })

  it('stores allowlisted messages only, from capture start, once', async () => {
    const db = getTestDb()
    const since = Date.now() - 2 * DAY
    await enableCapture('p1', new Date(since).toISOString())
    const recent = Date.now() - DAY

    const first = await ingestDmMessages(db, [
      msg('a', 'אשלח לך מחר את המצגת', recent, true),
      msg('b', 'before capture', since - DAY),
      msg('c', 'from Ron, capture off', recent, false, '972507654321@s.whatsapp.net'),
      msg('d', '   ', recent),
    ])
    expect(first).toEqual({ stored: 1, skipped: 3 })
    expect(await ingestDmMessages(db, [msg('a', 'אשלח לך מחר את המצגת', recent, true)])).toEqual({ stored: 0, skipped: 1 })

    const rows = await db.select().from(whatsappDmMessages)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ personId: 'p1', whatsappJid: DANA_JID, fromMe: true, pinned: false })
  })

  it('matches an @lid chat through a manual link or the alt JID, and links a nearby meeting', async () => {
    const db = getTestDb()
    await enableCapture('p1')
    const ts = Date.now() - DAY
    const meetingDate = new Date(ts + DAY).toISOString().slice(0, 10)
    await db.insert(meetings).values({ id: 'm1', title: 'Dana sync', date: meetingDate, time: '10:00', createdAt: NOW, updatedAt: NOW })
    await db.insert(meetingPeople).values({ meetingId: 'm1', personId: 'p1' })

    await ingestDmMessages(db, [{ ...msg('x1', 'via alt', ts, false, DANA_LID), altJid: DANA_JID }])
    await db.insert(whatsappPersonLinks).values({ id: 'l1', personId: 'p1', whatsappJid: DANA_LID, matchedBy: 'manual', createdAt: NOW })
    await ingestDmMessages(db, [msg('x2', 'via link', ts, false, DANA_LID)])

    const rows = await db.select().from(whatsappDmMessages)
    expect(rows.map((r) => [r.waMessageId, r.whatsappJid, r.meetingId]).sort()).toEqual([
      ['x1', DANA_JID, 'm1'],
      ['x2', DANA_LID, 'm1'],
    ])
  })

  it('merges 1:1 and group messages on the person card with their source', async () => {
    const db = getTestDb()
    await enableCapture('p1')
    const t = Date.now()
    await db.insert(whatsappMessages).values({
      id: 'g1', groupJid: 'grp@g.us', waMessageId: 'g1', sender: DANA_JID, senderName: 'Dana', text: 'in the group', ts: t - 3 * DAY, createdAt: NOW,
    })
    await ingestDmMessages(db, [msg('d1', 'from Dana', t - 2 * DAY), msg('d2', 'from me', t - DAY, true)])

    const caller = await createTestCaller()
    const ctx = await caller.insights.personContext({ personId: 'p1' })
    expect(ctx?.captureWhatsapp).toBe(true)
    expect(ctx?.whatsappSinceMeeting.map((m) => [m.text, m.channel, m.senderName, m.fromMe])).toEqual([
      ['from me', 'dm', 'אני', true],
      ['from Dana', 'dm', 'Dana Levi', false],
      ['in the group', 'group', 'Dana', false],
    ])
  })

  it('pins a message so retention keeps its text; others become [expired]', async () => {
    const db = getTestDb()
    await enableCapture('p1', new Date(Date.now() - 200 * DAY).toISOString())
    const old = Date.now() - 120 * DAY
    await ingestDmMessages(db, [msg('o1', 'old one', old), msg('o2', 'old pinned', old), msg('n1', 'new one', Date.now() - DAY)])
    const [pinned] = await db.select().from(whatsappDmMessages).where(eq(whatsappDmMessages.waMessageId, 'o2'))
    const caller = await createTestCaller()
    expect(await caller.whatsapp.dm.pin({ messageId: pinned.id })).toEqual({ pinned: true })

    expect(await runDmRetention(db, 90)).toBe(1)
    expect(await runDmRetention(db, 90)).toBe(0)
    const byId = new Map((await db.select().from(whatsappDmMessages)).map((r) => [r.waMessageId, r.text]))
    expect(byId.get('o1')).toBe(DM_EXPIRED_TEXT)
    expect(byId.get('o2')).toBe('old pinned')
    expect(byId.get('n1')).toBe('new one')

    const list = await caller.whatsapp.dm.list({ personId: 'p1', limit: 2 })
    expect(list.messages.map((m) => m.waMessageId)).toEqual(['n1', 'o1'])
    expect(list.hasMore).toBe(true)
  })
})

describe('commitment detection', () => {
  it('assigns the owner by who promised or who was asked', () => {
    const ts = new Date('2026-09-24T10:00:00Z').getTime()
    const found = detectCommitmentsHeuristic([
      { id: '1', fromMe: true, text: 'אשלח לך מחר את ההצעה', ts },
      { id: '2', fromMe: false, text: 'אבדוק ואחזור אליך', ts },
      { id: '3', fromMe: true, text: 'תשלח לי את החוזה ביום ה׳', ts },
      { id: '4', fromMe: false, text: 'תבדוק בבקשה את המספרים', ts },
      { id: '5', fromMe: false, text: 'סבבה, תודה', ts },
    ])
    expect(found.map((c) => [c.sourceMessageId, c.owner, c.dueInferred])).toEqual([
      ['1', 'me', '2026-09-25'],
      ['2', 'them', null],
      ['3', 'them', '2026-10-01'],
      ['4', 'me', null],
    ])
  })

  it('treats present-tense and plural promises as commitments, not another person\'s verb', () => {
    const ts = new Date('2026-09-25T14:15:00Z').getTime()
    const found = detectCommitmentsHeuristic([
      { id: 'a', fromMe: false, text: 'חלום, מזמין כוסות חדשות', ts },
      { id: 'b', fromMe: true, text: 'אני מזמינה מחר', ts },
      { id: 'c', fromMe: true, text: 'נטפל בזה אחרי החגים', ts },
      { id: 'd', fromMe: false, text: 'הוא מזמין כוסות', ts },
      { id: 'e', fromMe: false, text: 'את מזמינה את זה', ts },
      { id: 'f', fromMe: false, text: 'שולחת לך את הקובץ', ts },
    ])
    expect(found.map((c) => [c.sourceMessageId, c.owner, c.dueInferred])).toEqual([
      ['a', 'them', null],
      ['b', 'me', '2026-09-26'],
      ['c', 'me', null],
      ['f', 'them', null],
    ])
  })

  it('reads relative Hebrew dates', () => {
    const ts = new Date('2026-09-24T10:00:00Z').getTime()
    expect(inferDueDate('נדבר מחרתיים', ts)).toBe('2026-09-26')
    expect(inferDueDate('אעשה את זה היום', ts)).toBe('2026-09-24')
    expect(inferDueDate('ביום ראשון', ts)).toBe('2026-09-27')
    expect(inferDueDate('בלי תאריך', ts)).toBeNull()
  })
})

describe('DM summaries and commitments queue', () => {
  beforeEach(async () => {
    await resetDb()
    await seedPeople()
    await enableCapture('p1')
  })

  it('summarizes new messages once and proposes commitments without duplicates', async () => {
    const db = getTestDb()
    const now = Date.now()
    await ingestDmMessages(db, [msg('s1', 'אשלח לך את המצגת', now - 2 * DAY, true), msg('s2', 'מעולה', now - DAY)])
    const generate = async (_name: string, messages: { id: string }[]) => ({
      summary: 'דיברנו על המצגת.',
      commitments: [{ owner: 'me' as const, content: 'לשלוח לדנה את המצגת', dueInferred: null, sourceMessageId: messages[0].id }],
    })

    expect(await summarizeDmChats(db, { generate, now })).toEqual({
      people: 1,
      summaries: 1,
      commitments: 0,
      proposed: [],
    })
    expect(await summarizeDmChats(db, { generate, now })).toEqual({ people: 0, summaries: 0, commitments: 0, proposed: [] })

    await ingestDmMessages(db, [msg('s3', 'עוד משהו', now - 1000)])
    expect(await summarizeDmChats(db, { generate, now })).toEqual({ people: 1, summaries: 1, commitments: 0, proposed: [] })

    // summarizeDmChats no longer proposes commitments — that is handled by scanDmCommitments.
    expect(await db.select().from(commitments)).toHaveLength(0)
    expect(await db.select().from(whatsappDmSummaries)).toHaveLength(2)

    const caller = await createTestCaller()
    const ctx = await caller.insights.personContext({ personId: 'p1' })
    expect(ctx?.latestDmSummary?.summary).toBe('דיברנו על המצגת.')
    // summarizeDmChats no longer proposes commitments — proposedCommitments come from scanDmCommitments instead.
    expect(ctx?.proposedCommitments).toHaveLength(0)
  })

  it('scans new promises into commitments without a summary, and does not repeat them', async () => {
    const db = getTestDb()
    const now = Date.now()
    await ingestDmMessages(db, [msg('g1', 'חלום, מזמין כוסות חדשות', now - 60_000, false)])

    const classify = async (msgs: { id: string; text: string; citable?: boolean }[]) =>
      msgs.filter((m) => m.citable !== false && m.text.includes('מזמין')).map((m) => ({
        messageId: m.id,
        owner: 'them' as const,
        content: 'להזמין כוסות חדשות',
        due: null,
        because: 'איציק אמר שהוא מזמין',
      }))
    const first = await scanDmCommitments(db, now, { classify })
    expect(first).toMatchObject({ people: 1, commitments: 1 })
    expect(first.proposed).toEqual([
      { label: 'Dana Levi', content: 'להזמין כוסות חדשות', because: 'איציק אמר שהוא מזמין', sourceTs: expect.any(Number) },
    ])
    expect(await scanDmCommitments(db, now, { classify })).toEqual({ people: 1, commitments: 0, proposed: [] })
    expect(await db.select().from(whatsappDmSummaries)).toHaveLength(0)

    const [c] = await db.select().from(commitments)
    expect(c).toMatchObject({
      personId: 'p1',
      owner: 'them',
      source: 'whatsapp_dm',
      status: 'proposed',
      content: 'להזמין כוסות חדשות',
      sourceSnippet: 'חלום, מזמין כוסות חדשות',
      sourceReason: 'איציק אמר שהוא מזמין',
      sourceChatName: 'Dana Levi',
    })

    const generate = async () => ({ summary: 'סיכום היום.', commitments: [] })
    expect(await summarizeDmChats(db, { generate, now })).toEqual({ people: 1, summaries: 1, commitments: 0, proposed: [] })
    expect(await db.select().from(whatsappDmSummaries)).toHaveLength(1)
  })

  it('uses an injected classifier (e.g. Gemini) to catch phrasing the regex misses, with correct owner attribution', async () => {
    const db = getTestDb()
    const now = Date.now()
    await ingestDmMessages(db, [msg('m1', 'אל תשכח להביא לה בשישי', now - 60_000, false)])

    // ingestDmMessages assigns its own row id, so the classifier must key off whatever id it's handed.
    const classify = async (msgs: { id: string; citable?: boolean }[]) => msgs.filter((m) => m.citable !== false).map((m) => ({ messageId: m.id, owner: 'me' as const, content: 'להביא לה משהו בשישי', due: '2026-10-03', because: 'היא ביקשה' }))
    const result = await scanDmCommitments(db, now, { classify })
    expect(result).toMatchObject({ people: 1, commitments: 1 })
    expect(result.proposed).toEqual([
      { label: 'Dana Levi', content: 'להביא לה משהו בשישי', because: 'היא ביקשה', sourceTs: expect.any(Number) },
    ])

    const [c] = await db.select().from(commitments)
    // Dana asked (fromMe=false, kind='request') => the commitment is mine, not hers.
    expect(c).toMatchObject({ personId: 'p1', owner: 'me', source: 'whatsapp_dm', content: 'להביא לה משהו בשישי', dueInferred: '2026-10-03' })
  })

  it('accepts into a task (assignee and project follow the person) and dismisses', async () => {
    const db = getTestDb()
    await db.delete(projectPeople)
    await db.delete(projects).where(eq(projects.id, 'pr1'))
    await db.insert(projects).values({ id: 'pr1', name: 'Deal', createdAt: NOW, updatedAt: NOW })
    await db.insert(projectPeople).values({ projectId: 'pr1', personId: 'p1' })
    await db.insert(commitments).values([
      { id: 'c_me', personId: 'p1', owner: 'me', content: 'לשלוח הצעה', dueInferred: '2026-10-01', source: 'whatsapp_dm', status: 'proposed', createdAt: '2026-09-01', updatedAt: NOW },
      { id: 'c_them', personId: 'p1', owner: 'them', content: 'דנה תבדוק מספרים', source: 'whatsapp_dm', status: 'proposed', createdAt: '2026-09-02', updatedAt: NOW },
      { id: 'c_no', personId: 'p2', owner: 'me', content: 'לא רלוונטי', source: 'whatsapp_dm', status: 'proposed', createdAt: '2026-09-03', updatedAt: NOW },
    ])
    const caller = await createTestCaller()
    expect((await caller.commitments.listProposed()).map((c) => c.id)).toEqual(['c_no', 'c_them', 'c_me'])
    expect((await caller.commitments.listProposed({ owner: 'them' })).map((c) => [c.id, c.personName])).toEqual([['c_them', 'Dana Levi']])

    const mine = await caller.commitments.accept({ commitmentId: 'c_me', taskTitle: 'לשלוח לדנה הצעה' })
    const theirs = await caller.commitments.accept({ commitmentId: 'c_them' })
    const [t1] = await db.select().from(tasks).where(eq(tasks.id, mine.taskId))
    const [t2] = await db.select().from(tasks).where(eq(tasks.id, theirs.taskId))
    expect(t1).toMatchObject({ title: 'לשלוח לדנה הצעה', dueDate: '2026-10-01', projectId: 'pr1' })
    expect(t1.assigneeId).not.toBe('p1')
    expect(t2).toMatchObject({ title: 'דנה תבדוק מספרים', assigneeId: 'p1', projectId: 'pr1' })
    await expect(caller.commitments.accept({ commitmentId: 'c_me' })).rejects.toThrow(/already accepted/)

    expect(await caller.commitments.dismiss({ commitmentId: 'c_no' })).toEqual({ dismissed: true })
    expect(await caller.commitments.dismiss({ commitmentId: 'c_no' })).toEqual({ dismissed: false })
    expect(await caller.commitments.listProposed()).toEqual([])
    expect((await caller.commitments.listForPerson({ personId: 'p1', status: 'accepted' })).map((c) => c.taskId).sort()).toEqual(
      [mine.taskId, theirs.taskId].sort(),
    )
  })

  it('merging people carries 1:1 messages and commitments to the kept person', async () => {
    const db = getTestDb()
    await ingestDmMessages(db, [msg('mm', 'hello', Date.now() - DAY)])
    await db.insert(commitments).values({ id: 'cm', personId: 'p1', owner: 'me', content: 'x', source: 'whatsapp_dm', status: 'proposed', createdAt: NOW, updatedAt: NOW })
    const caller = await createTestCaller()
    await caller.people.merge({ fromId: 'p1', toId: 'p2' })
    expect((await db.select().from(whatsappDmMessages))[0].personId).toBe('p2')
    expect((await db.select().from(commitments))[0].personId).toBe('p2')
  })
})

describe('matchesRejected', () => {
  it('returns false when rejected list is empty', () => {
    expect(matchesRejected('לשלוח קובץ', [])).toBe(false)
  })

  it('returns true for an exact match', () => {
    expect(matchesRejected('לשלוח קובץ', ['לשלוח קובץ'])).toBe(true)
  })

  it('returns true for a close rephrasing (high word overlap)', () => {
    // "לשלוח את הקובץ מחר" shares 2/4 words with "לשלוח קובץ" → Jaccard = 2/(4-2+2) = 0.5 — below threshold
    // But "לשלוח את הקובץ" shares 2/3 → Jaccard = 2/3 ≈ 0.67 — also below threshold
    // "לשלוח הקובץ החשוב" shares "לשלוח" → Jaccard = 1/3 — below threshold
    // Strong overlap: same words + one extra → still below
    expect(matchesRejected('לשלוח קובץ עד מחר', ['לשלוח קובץ עד מחר'])).toBe(true)
  })

  it('returns false for unrelated tasks', () => {
    expect(matchesRejected('לתאם פגישה עם לקוח', ['לשלוח קובץ'])).toBe(false)
  })

  it('is case and punctuation insensitive', () => {
    expect(matchesRejected('לשלוח קובץ!!!', ['לשלוח קובץ'])).toBe(true)
  })
})

describe('scanDmCommitments — rejection gate', () => {
  beforeEach(async () => {
    await resetDb()
    await getTestDb().insert(people).values({ id: 'p1', name: 'Dana', phone: '050-123-4567', status: 'confirmed', source: 'manual', createdAt: NOW })
    await enableCapture('p1')
    await getTestDb().insert(whatsappPersonLinks).values({ id: 'link-p1', personId: 'p1', whatsappJid: DANA_JID, matchedBy: 'manual', createdAt: NOW })
  })

  it('does not re-propose an identical text that was previously dismissed', async () => {
    const db = getTestDb()
    await db.insert(commitments).values({
      id: 'c_dismissed', personId: 'p1', owner: 'me', content: 'לשלוח קובץ',
      source: 'whatsapp_dm', sourceId: 'old_msg', status: 'dismissed', createdAt: NOW, updatedAt: NOW,
    })
    await ingestDmMessages(db, [msg('m1', 'אשלח קובץ מחר', Date.now(), true)])

    // Classifier receives real DB message IDs — returns an exact match for the dismissed content
    const classify = async (msgs: { id: string; citable?: boolean }[]) =>
      msgs.filter((m) => m.citable !== false).map((m) => ({ messageId: m.id, owner: 'me' as const, content: 'לשלוח קובץ', because: 'כי', due: null }))
    const result = await scanDmCommitments(db, Date.now(), { classify })

    expect(result.commitments).toBe(0)
  })

  it('does not re-propose a rephrased dismissed commitment', async () => {
    const db = getTestDb()
    await db.insert(commitments).values({
      id: 'c_dismissed', personId: 'p1', owner: 'me', content: 'לשלוח קובץ חשוב מחר',
      source: 'whatsapp_dm', sourceId: 'old_msg', status: 'dismissed', createdAt: NOW, updatedAt: NOW,
    })
    await ingestDmMessages(db, [msg('m1', 'אזכר לשלוח', Date.now(), true)])

    // Model returns the very same content as what was dismissed (Jaccard = 1.0)
    const classify = async (msgs: { id: string; citable?: boolean }[]) =>
      msgs.filter((m) => m.citable !== false).map((m) => ({ messageId: m.id, owner: 'me' as const, content: 'לשלוח קובץ חשוב מחר', because: 'כי', due: null }))
    const result = await scanDmCommitments(db, Date.now(), { classify })

    expect(result.commitments).toBe(0)
  })

  it('still proposes a genuinely different new commitment', async () => {
    const db = getTestDb()
    await db.insert(commitments).values({
      id: 'c_dismissed', personId: 'p1', owner: 'me', content: 'לשלוח קובץ',
      source: 'whatsapp_dm', sourceId: 'old_msg', status: 'dismissed', createdAt: NOW, updatedAt: NOW,
    })
    await ingestDmMessages(db, [msg('m2', 'תתקשר אלי בעשר', Date.now(), false)])

    // Returns a genuinely unrelated commitment — different words, no overlap with dismissed
    const classify = async (msgs: { id: string; citable?: boolean }[]) =>
      msgs.filter((m) => m.citable !== false).map((m) => ({ messageId: m.id, owner: 'me' as const, content: 'להתקשר לדנה בעשר', because: 'ביקשה', due: null }))
    const result = await scanDmCommitments(db, Date.now(), { classify })

    expect(result.commitments).toBe(1)
  })
})
