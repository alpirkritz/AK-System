import { beforeEach, describe, expect, it } from 'vitest'
import { meetingAnalyses, meetingPeople, meetings, people, personEmailThreads, whatsappDmMessages } from '@ak-system/database'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'
import { addDays, evaluateAttention, otherAttendeeCount, type Interaction } from './relationship-attention'

const TODAY = '2026-11-02'
const NOW = new Date().toISOString()

function meet(daysAgo: number, kind: 'one_on_one' | 'group', score: number | null, id = `m${daysAgo}${kind}`): Interaction {
  const sentiment = score == null ? null : (score - 5.5) / 4.5
  return { date: addDays(TODAY, -daysAgo), kind, channel: 'meeting', meetingId: id, title: id, score, sentiment }
}
function dm(daysAgo: number): Interaction {
  return { date: addDays(TODAY, -daysAgo), kind: 'direct', channel: 'whatsapp' }
}
function evaluate(interactions: Interaction[], extra: Partial<Parameters<typeof evaluateAttention>[0]> = {}) {
  return evaluateAttention({ interactions, today: TODAY, contactFrequencyDays: null, ackAt: null, next1on1Date: null, ...extra })
}

describe('evaluateAttention', () => {
  it('flags a tone drop and recovers as soon as a good 1:1 lands', () => {
    const history = [meet(5, 'one_on_one', 4), meet(12, 'one_on_one', 4), meet(60, 'one_on_one', 9), meet(90, 'one_on_one', 9), meet(120, 'one_on_one', 9)]
    const before = evaluate(history)
    expect(before.status).toBe('needs_1on1')
    expect(before.reasons).toEqual(expect.arrayContaining(['tone_drop', 'low_1on1']))
    expect(before.severity).toBeGreaterThanOrEqual(2)

    const after = evaluate([meet(0, 'one_on_one', 9, 'fresh'), ...history])
    expect(after.reasons).not.toContain('low_1on1')
    expect(after.reasons).not.toContain('tone_drop')
    expect(after.status).not.toBe('needs_1on1')
  })

  it('counts a recent group meeting as contact — no "quiet" flag', () => {
    const groups = [2, 9, 16, 23, 30].map((d) => meet(d, 'group', 8))
    const a = evaluate([...groups, dm(60), dm(67), dm(74)])
    expect(a.reasons).not.toContain('quiet')
    expect(a.status).not.toBe('needs_1on1')
    expect(a.quietDays).toBe(2)
    expect(a.lastContact).toEqual({ date: addDays(TODAY, -2), channel: 'meeting' })
  })

  it('still flags quiet when there was no contact on any channel', () => {
    const a = evaluate([dm(60), dm(67), dm(74), meet(81, 'group', 8)])
    expect(a.status).toBe('needs_1on1')
    expect(a.reasons).toEqual(['quiet'])
    expect(a.quietDays).toBe(60)
  })

  it('counts a WhatsApp group message or a recording as contact', () => {
    const base = [dm(60), dm(67), dm(74)]
    const viaGroup = evaluate([...base, { date: addDays(TODAY, -3), kind: 'group', channel: 'whatsapp_group' }])
    expect(viaGroup.reasons).not.toContain('quiet')
    const viaRecording = evaluate([...base, { date: addDays(TODAY, -3), kind: 'direct', channel: 'recording' }])
    expect(viaRecording.reasons).not.toContain('quiet')
  })

  it('takes the last contact from any channel', () => {
    const a = evaluate([meet(11, 'group', 7), dm(1), meet(40, 'group', 7), meet(70, 'group', 7)])
    expect(a.lastContact).toEqual({ date: addDays(TODAY, -1), channel: 'whatsapp' })
    expect(a.quietDays).toBe(1)
  })

  it('never calls a group-only contact quiet unless a rhythm was set', () => {
    const groups = [40, 60, 80, 100].map((d) => meet(d, 'group', 7))
    expect(evaluate(groups).status).toBe('steady')
    const withRhythm = evaluate(groups, { contactFrequencyDays: 14 })
    expect(withRhythm.reasons).toEqual(['quiet'])
    // …and a rhythm is met by any contact, a group meeting included.
    const recent = evaluate([meet(5, 'group', 7), ...groups], { contactFrequencyDays: 14 })
    expect(recent.reasons).not.toContain('quiet')
  })

  it('leaves thin relationships without a status', () => {
    expect(evaluate([meet(5, 'one_on_one', 3), dm(2)]).status).toBeNull()
  })

  it('hides the flag while a 1:1 is booked within a week', () => {
    const history = [meet(5, 'one_on_one', 3), meet(30, 'one_on_one', 8), meet(60, 'one_on_one', 8), meet(90, 'one_on_one', 8)]
    expect(evaluate(history, { next1on1Date: addDays(TODAY, 3) }).suppressed).toBe('scheduled')
    expect(evaluate(history, { next1on1Date: addDays(TODAY, 20) }).suppressed).toBeNull()
  })

  it('keeps an acknowledged flag hidden until a new meeting or 30 days', () => {
    const history = [meet(5, 'one_on_one', 3), meet(30, 'one_on_one', 8), meet(60, 'one_on_one', 8), meet(90, 'one_on_one', 8)]
    const ackAt = `${addDays(TODAY, -2)}T10:00:00.000Z`
    expect(evaluate([dm(0), ...history], { ackAt }).suppressed).toBe('acknowledged')
    expect(evaluate([meet(0, 'group', 4, 'new'), ...history], { ackAt }).suppressed).toBeNull()
    expect(evaluate(history, { ackAt: `${addDays(TODAY, -31)}T10:00:00.000Z` }).suppressed).toBeNull()
  })
})

describe('otherAttendeeCount', () => {
  it('ignores the owner and meeting rooms', () => {
    const invite = JSON.stringify([
      { name: 'Alpir Kritzler', email: 'a@x.com' },
      { name: 'Nevo Peled', email: 'nevo@x.com' },
      { name: 'DragonTail-CR-Cave-MTR', email: 'room@x.com' },
    ])
    expect(otherAttendeeCount(['Nevo Peled'], invite)).toBe(1)
    expect(otherAttendeeCount(['Nevo Peled', 'Jordan'], null)).toBe(2)
  })
})

describe('relationship attention over the API', () => {
  beforeEach(async () => {
    await resetDb()
    const db = getTestDb()
    await db.delete(whatsappDmMessages)
    await db.delete(personEmailThreads)
  })

  const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)

  it('shows a WhatsApp-only relationship with the real last contact, and acknowledges a flag', async () => {
    const db = getTestDb()
    await db.insert(people).values([
      { id: 'jordan', name: 'Jordan', status: 'confirmed', source: 'manual', createdAt: NOW },
      { id: 'nevo', name: 'Nevo Peled', status: 'confirmed', source: 'manual', createdAt: NOW },
    ])
    // Jordan: one old meeting, then weekly WhatsApp.
    await db.insert(meetings).values({ id: 'j0', title: 'Jordan sync', date: iso(40), time: '10:00', createdAt: NOW, updatedAt: NOW })
    await db.insert(meetingPeople).values({ meetingId: 'j0', personId: 'jordan' })
    for (const d of [1, 8, 15, 22]) {
      await db.insert(whatsappDmMessages).values({
        id: `w${d}`, personId: 'jordan', whatsappJid: '972500000000@s.whatsapp.net', waMessageId: `w${d}`, fromMe: d % 2 === 0,
        text: 'hi', ts: Date.now() - d * 86_400_000, createdAt: NOW,
      })
    }
    // Nevo: 1:1s that went from 9 to 3.
    for (const [i, [d, score]] of ([[5, 3], [20, 3], [80, 9], [110, 9]] as const).entries()) {
      await db.insert(meetings).values({ id: `n${i}`, title: 'Nevo 1:1', date: iso(d), time: '10:00', createdAt: NOW, updatedAt: NOW })
      await db.insert(meetingPeople).values({ meetingId: `n${i}`, personId: 'nevo' })
      await db.insert(meetingAnalyses).values({ id: `na${i}`, meetingId: `n${i}`, source: 'transcript', score, status: 'completed', createdAt: NOW, updatedAt: NOW })
    }

    const caller = await createTestCaller()
    const board = await caller.insights.relationshipBoard()
    const jordan = board.people.find((p) => p.id === 'jordan')!
    expect(jordan.attention?.lastContact).toEqual({ date: iso(1), channel: 'whatsapp' })
    expect(jordan.attention?.status).toBe('steady')
    expect(board.people[0]?.id).toBe('nevo')
    expect(board.people[0]?.attention?.status).toBe('needs_1on1')
    expect(board.summary.needs1on1).toBe(1)

    const ctx = await caller.insights.personContext({ personId: 'jordan' })
    expect(ctx?.lastContactAt).toBe(iso(1))
    expect(ctx?.lastContactChannel).toBe('whatsapp')

    expect((await caller.insights.relationshipFlags()).needs1on1.map((f) => f.personId)).toEqual(['nevo'])
    await caller.insights.acknowledgeAttention({ personId: 'nevo', ack: true })
    expect((await caller.insights.relationshipFlags()).needs1on1).toEqual([])
    const acked = (await caller.insights.relationshipBoard()).people.find((p) => p.id === 'nevo')
    expect(acked?.attention?.suppressed).toBe('acknowledged')

    await caller.insights.acknowledgeAttention({ personId: 'nevo', ack: false })
    expect((await caller.insights.relationshipFlags()).needs1on1.map((f) => f.personId)).toEqual(['nevo'])
  })
})
