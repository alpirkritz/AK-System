import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { meetingPeople, meetings, meetingSeries, people, seriesRoster, whatsappPersonLinks } from '@ak-system/database'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'
import { scorePair } from '../services/people-duplicates'

const NOW = new Date().toISOString()

function person(id: string, name: string, extra: Partial<typeof people.$inferInsert> = {}) {
  return { id, name, status: 'confirmed', source: 'manual', createdAt: NOW, ...extra }
}

describe('people duplicates', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('ranks email > phone > similar name and skips unrelated people', async () => {
    const db = getTestDb()
    await db.insert(people).values([
      person('p1', 'Dana Levi', { email: 'dana@dt.com' }),
      person('p2', 'D. Levi', { email: 'DANA@dt.com' }),
      person('p3', 'Ron Cohen', { phone: '050-123-4567' }),
      person('p4', 'רון', { phone: '+972501234567' }),
      person('p5', 'Yossi Mizrahi'),
      person('p6', 'Yosi Mizrahi'),
      person('p7', 'Completely Different'),
    ])
    const caller = await createTestCaller()
    const { pairs } = await caller.people.findDuplicates()
    const ids = pairs.map((p) => [p.personA.id, p.personB.id].sort().join('+'))
    expect(ids).toEqual(['p1+p2', 'p3+p4', 'p5+p6'])
    expect(pairs.map((p) => p.confidence)).toEqual([1, 0.95, 0.7])
  })

  it('never suggests a pair marked not-duplicate again', async () => {
    const db = getTestDb()
    await db.insert(people).values([person('p1', 'Dana Levi'), person('p2', 'Dana Levi')])
    const caller = await createTestCaller()
    expect((await caller.people.findDuplicates()).pairs).toHaveLength(1)
    await caller.people.markNotDuplicate({ personIdA: 'p2', personIdB: 'p1' })
    await caller.people.markNotDuplicate({ personIdA: 'p1', personIdB: 'p2' })
    expect((await caller.people.findDuplicates()).pairs).toHaveLength(0)
  })

  it('compares footprints side by side', async () => {
    const db = getTestDb()
    await db.insert(people).values([person('p1', 'Dana Levi', { email: 'dana@dt.com' }), person('p2', 'Dana Levi')])
    await db.insert(meetings).values({ id: 'm1', title: 'Sync', date: '2026-01-01', time: '10:00', createdAt: NOW, updatedAt: NOW })
    await db.insert(meetingPeople).values({ meetingId: 'm1', personId: 'p1' })
    const caller = await createTestCaller()
    const cmp = await caller.people.compareDuplicates({ personIdA: 'p1', personIdB: 'p2' })
    expect(cmp?.a.meetingCount).toBe(1)
    expect(cmp?.b.meetingCount).toBe(0)
    expect(cmp?.reasons).toContain('אותו שם')
  })

  it('merge keeps circle membership, WhatsApp links and fills missing fields', async () => {
    const db = getTestDb()
    await db.insert(people).values([
      person('from', 'Dana', { email: 'dana@dt.com', phone: '0501234567' }),
      person('to', 'Dana Levi'),
    ])
    await db.insert(meetingSeries).values({ id: 'ms1', title: 'Algo', cadence: 'weekly', recurrenceDay: null, rollingNotes: null, createdAt: NOW, updatedAt: NOW })
    await db.insert(seriesRoster).values({ id: 'sr1', seriesId: 'ms1', displayName: 'Dana', email: null, source: 'manual', personId: 'from', inactive: false, createdAt: NOW, updatedAt: NOW })
    await db.insert(whatsappPersonLinks).values({ id: 'w1', personId: 'from', whatsappJid: 'x@lid', matchedBy: 'manual', createdAt: NOW })

    const caller = await createTestCaller()
    await caller.people.merge({ fromId: 'from', toId: 'to' })

    const [kept] = await db.select().from(people).where(eq(people.id, 'to'))
    expect(kept.name).toBe('Dana Levi')
    expect(kept.email).toBe('dana@dt.com')
    expect(kept.phone).toBe('0501234567')
    expect((await db.select().from(seriesRoster))[0].personId).toBe('to')
    expect((await db.select().from(whatsappPersonLinks))[0].personId).toBe('to')
  })
})

describe('scorePair', () => {
  it('treats swapped name order as the same name', () => {
    const base = { email: null, phone: null, company: null, role: null, status: 'confirmed', source: 'manual' }
    expect(scorePair({ ...base, id: 'a', name: 'Alpir Kritzler' }, { ...base, id: 'b', name: 'Kritzler Alpir' })?.confidence).toBe(0.85)
  })
})

describe('people.notifyNewDuplicates', () => {
  beforeEach(async () => {
    await resetDb()
    const { userSettings, notifications } = await import('@ak-system/database')
    await getTestDb().delete(userSettings)
    await getTestDb().delete(notifications)
  })

  it('notifies once per new pair', async () => {
    const db = getTestDb()
    const { notifications } = await import('@ak-system/database')
    await db.insert(people).values([person('p1', 'Dana Levi'), person('p2', 'Dana Levi')])
    const caller = await createTestCaller()

    expect(await caller.people.notifyNewDuplicates()).toEqual({ total: 1, fresh: 1 })
    expect(await caller.people.notifyNewDuplicates()).toEqual({ total: 1, fresh: 0 })
    const rows = await db.select().from(notifications)
    expect(rows).toHaveLength(1)
    expect(rows[0].url).toBe('/people/duplicates')

    await db.insert(people).values(person('p3', 'Ron Cohen', { email: 'r@x.com' }))
    await db.insert(people).values(person('p4', 'R Cohen', { email: 'r@x.com' }))
    expect(await caller.people.notifyNewDuplicates()).toEqual({ total: 2, fresh: 1 })
  })
})
