import { beforeEach, describe, expect, it } from 'vitest'
import {
  meetingAnalyses,
  meetingNotes,
  meetingPeople,
  meetings,
  people,
  whatsappMessages,
  whatsappPersonLinks,
} from '@ak-system/database'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'
import { personRecommendation } from '../services/person-context'

const NOW = new Date().toISOString()

async function seedPersonWithMeeting() {
  const db = getTestDb()
  await db.insert(people).values({ id: 'p1', name: 'Dana Levi', phone: '050-123-4567', status: 'confirmed', source: 'manual', createdAt: NOW })
  await db.insert(meetings).values({ id: 'm1', title: 'Dana 1:1', date: '2026-01-10', time: '10:00', createdAt: NOW, updatedAt: NOW })
  await db.insert(meetingPeople).values({ meetingId: 'm1', personId: 'p1' })
  await db.insert(meetingNotes).values({ id: 'n1', title: 'Dana 1:1', date: '2026-01-10', meetingId: 'm1', source: 'notion', createdAt: NOW, updatedAt: NOW })
  await db.insert(meetingAnalyses).values({
    id: 'a1', meetingId: 'm1', source: 'transcript', status: 'completed',
    actionItemsJson: JSON.stringify([
      { content: 'Send the deck', owner: 'Dana' },
      { content: 'Book venue', owner: 'Ron' },
    ]),
    createdAt: NOW, updatedAt: NOW,
  })
}

describe('insights.personContext hierarchy', () => {
  beforeEach(async () => {
    const db = getTestDb()
    await db.delete(whatsappMessages)
    await resetDb()
  })

  it('splits WhatsApp around the last Notion meeting and recommends the newer source', async () => {
    await seedPersonWithMeeting()
    const db = getTestDb()
    await db.insert(whatsappMessages).values([
      { id: 'w_old', groupJid: 'g@g.us', waMessageId: '1', sender: '972501234567@s.whatsapp.net', senderName: 'Dana', text: 'old news', ts: new Date('2026-01-05').getTime(), createdAt: NOW },
      { id: 'w_new', groupJid: 'g@g.us', waMessageId: '2', sender: '972501234567@s.whatsapp.net', senderName: 'Dana', text: 'moved the date to Sunday', ts: new Date('2026-01-12').getTime(), createdAt: NOW },
      { id: 'w_other', groupJid: 'g@g.us', waMessageId: '3', sender: '972509999999@s.whatsapp.net', senderName: 'Other', text: 'noise', ts: new Date('2026-01-12').getTime(), createdAt: NOW },
    ])
    const caller = await createTestCaller()
    const ctx = await caller.insights.personContext({ personId: 'p1' })
    expect(ctx?.lastNotionMeetingDate).toBe('2026-01-10')
    expect(ctx?.whatsappSinceMeeting.map((m) => m.id)).toEqual(['w_new'])
    expect(ctx?.olderWhatsapp.map((m) => m.id)).toEqual(['w_old'])
    expect(ctx?.openLoopsForPerson.map((l) => l.content)).toEqual(['Send the deck'])
    expect(ctx?.recommendation).toContain('הוואטסאפ חדש יותר')
    expect(ctx?.whatsappSenders).toEqual([{ jid: '972501234567@s.whatsapp.net', matchedBy: 'phone' }])
  })

  it('links a LID sender manually and lists only unlinked senders', async () => {
    await seedPersonWithMeeting()
    const db = getTestDb()
    await db.insert(whatsappMessages).values({
      id: 'w_lid', groupJid: 'g@g.us', waMessageId: '9', sender: '1234@lid', senderName: 'Dana L', text: 'hi', ts: new Date('2026-01-15').getTime(), createdAt: NOW,
    })
    const caller = await createTestCaller()
    expect((await caller.insights.whatsappSenders({})).map((s) => s.jid)).toContain('1234@lid')

    await caller.insights.linkWhatsappSender({ personId: 'p1', jid: '1234@lid' })
    expect((await caller.insights.whatsappSenders({})).map((s) => s.jid)).not.toContain('1234@lid')
    const ctx = await caller.insights.personContext({ personId: 'p1' })
    expect(ctx?.whatsappSinceMeeting.map((m) => m.id)).toEqual(['w_lid'])

    await caller.insights.unlinkWhatsappSender({ personId: 'p1', jid: '1234@lid' })
    expect(await db.select().from(whatsappPersonLinks)).toHaveLength(0)
  })

  it('has no WhatsApp sections and a Notion-only recommendation without chat', async () => {
    await seedPersonWithMeeting()
    const caller = await createTestCaller()
    const ctx = await caller.insights.personContext({ personId: 'p1' })
    expect(ctx?.whatsappSinceMeeting).toEqual([])
    expect(ctx?.recommendation).toContain('עדיין העדכני ביותר')
    expect(ctx?.warmth.trend).toBeNull()
  })
})

describe('personRecommendation', () => {
  it('uses the chat when there is no documented meeting', () => {
    const text = personRecommendation({
      lastNotionMeetingDate: null,
      latestWhatsapp: { id: 'w', groupJid: 'g', groupName: null, senderName: 'D', text: 'hello there', ts: 1 },
      whatsappSinceCount: 1,
      openLoopCount: 0,
      trend: 'cooling',
    })
    expect(text).toContain('התחל מהוואטסאפ')
    expect(text).toContain('פחות חמות')
  })

  it('returns null with no signal at all', () => {
    expect(personRecommendation({ lastNotionMeetingDate: null, latestWhatsapp: null, whatsappSinceCount: 0, openLoopCount: 0, trend: null })).toBeNull()
  })
})

describe('insights.meetingPrepContext', () => {
  beforeEach(async () => {
    const db = getTestDb()
    await db.delete(whatsappMessages)
    await resetDb()
  })

  it('gives per-person lines without raw WhatsApp text', async () => {
    await seedPersonWithMeeting()
    const db = getTestDb()
    await db.insert(meetings).values({ id: 'm_next', title: 'Dana 1:1', date: '2026-02-01', time: '10:00', createdAt: NOW, updatedAt: NOW })
    await db.insert(meetingPeople).values({ meetingId: 'm_next', personId: 'p1' })
    await db.insert(whatsappMessages).values({
      id: 'w_new', groupJid: 'g@g.us', waMessageId: '2', sender: '972501234567@s.whatsapp.net', senderName: 'Dana', text: 'SECRET chat text', ts: new Date('2026-01-12').getTime(), createdAt: NOW,
    })
    const caller = await createTestCaller()
    const prep = await caller.insights.meetingPrepContext({ meetingId: 'm_next' })
    expect(prep.kind).toBe('people')
    expect(prep.lines.join('\n')).toContain('Dana Levi')
    expect(prep.lines.join('\n')).not.toContain('SECRET')
  })

  it('uses the circle instead of people for a rostered series', async () => {
    const db = getTestDb()
    const { meetingSeries } = await import('@ak-system/database')
    await db.insert(meetingSeries).values({ id: 'ms1', title: 'Algo 4.0', cadence: 'weekly', recurrenceDay: null, rollingNotes: null, createdAt: NOW, updatedAt: NOW })
    await db.insert(meetings).values({
      id: 'mc', title: 'Algo 4.0', date: '2026-02-01', time: '10:00', seriesId: 'ms1',
      calendarParticipants: JSON.stringify([{ name: 'A', email: null, source: 'description' }, { name: 'B', email: null, source: 'description' }]),
      createdAt: NOW, updatedAt: NOW,
    })
    const caller = await createTestCaller()
    await caller.circles.saveFromCalendar({ seriesId: 'ms1' })
    const prep = await caller.insights.meetingPrepContext({ meetingId: 'mc' })
    expect(prep).toMatchObject({ kind: 'circle', circleTitle: 'Algo 4.0', rosterCount: 2 })
    expect(prep.lines[0]).toContain('המלצה לחוג')
  })
})

describe('WhatsApp phone match rejection', () => {
  beforeEach(async () => {
    const db = getTestDb()
    await db.delete(whatsappMessages)
    await resetDb()
  })

  it('stops matching a sender by phone once rejected, and frees it for the picker', async () => {
    await seedPersonWithMeeting()
    const db = getTestDb()
    const jid = '972501234567@s.whatsapp.net'
    await db.insert(whatsappMessages).values({
      id: 'w1', groupJid: 'g@g.us', waMessageId: '1', sender: jid, senderName: 'Someone', text: 'x', ts: new Date('2026-01-12').getTime(), createdAt: NOW,
    })
    const caller = await createTestCaller()
    expect((await caller.insights.personContext({ personId: 'p1' }))?.whatsappSenders).toHaveLength(1)

    await caller.insights.unlinkWhatsappSender({ personId: 'p1', jid })
    const ctx = await caller.insights.personContext({ personId: 'p1' })
    expect(ctx?.whatsappSenders).toEqual([])
    expect(ctx?.whatsappSinceMeeting).toEqual([])
    expect((await caller.insights.whatsappSenders({})).map((s) => s.jid)).toContain(jid)

    await caller.insights.linkWhatsappSender({ personId: 'p1', jid })
    expect((await caller.insights.personContext({ personId: 'p1' }))?.whatsappSenders).toEqual([{ jid, matchedBy: 'manual' }])
  })
})

describe('insights.coolingForDate', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('flags meetings with a cooling followed person', async () => {
    const db = getTestDb()
    const today = new Date()
    const iso = (daysAgo: number) => new Date(today.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10)
    await db.insert(people).values({ id: 'pc', name: 'Cool Person', status: 'confirmed', source: 'manual', createdAt: NOW })
    const history: [number, number][] = [[10, 3], [20, 3], [120, 9], [150, 9]]
    for (const [i, [daysAgo, score]] of history.entries()) {
      await db.insert(meetings).values({ id: `h${i}`, title: 'Past', date: iso(daysAgo), time: '10:00', createdAt: NOW, updatedAt: NOW })
      await db.insert(meetingPeople).values({ meetingId: `h${i}`, personId: 'pc' })
      await db.insert(meetingAnalyses).values({ id: `ha${i}`, meetingId: `h${i}`, source: 'transcript', score, status: 'completed', createdAt: NOW, updatedAt: NOW })
    }
    await db.insert(meetings).values({ id: 'today', title: 'Today sync', date: iso(0), time: '12:00', calendarEventId: 'ev1', createdAt: NOW, updatedAt: NOW })
    await db.insert(meetingPeople).values({ meetingId: 'today', personId: 'pc' })

    const caller = await createTestCaller()
    const flags = await caller.insights.coolingForDate({ date: iso(0) })
    expect(flags).toEqual([
      { meetingId: 'today', calendarEventId: 'ev1', title: 'Today sync', coolingPeople: ['Cool Person'], circleCooling: false },
    ])
  })
})
