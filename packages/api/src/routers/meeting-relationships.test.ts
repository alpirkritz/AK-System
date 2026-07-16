import { describe, it, expect, beforeEach } from 'vitest'
import { createTestCaller, resetDb, getTestDb } from '../test-utils'
import { people } from '@ak-system/database'

describe('meeting types', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('creates, lists, updates and deletes a type', async () => {
    const caller = await createTestCaller()
    const created = await caller.meetingTypes.create({ name: '1:1', color: '#8b5cf6' })
    expect(created.name).toBe('1:1')

    const list = await caller.meetingTypes.list()
    expect(list).toHaveLength(1)

    const updated = await caller.meetingTypes.update({ id: created.id, name: 'אחד על אחד' })
    expect(updated!.name).toBe('אחד על אחד')

    await caller.meetingTypes.delete({ id: created.id })
    expect(await caller.meetingTypes.list()).toHaveLength(0)
  })

  it('delete nulls typeId on meetings that used it', async () => {
    const caller = await createTestCaller()
    const type = await caller.meetingTypes.create({ name: 'strategy' })
    const meeting = await caller.meetings.create({ title: 'Strategy sync', date: '2026-07-20', typeId: type.id })
    expect((meeting as { typeId?: string }).typeId).toBe(type.id)

    await caller.meetingTypes.delete({ id: type.id })
    const after = await caller.meetings.getById({ id: meeting.id })
    expect((after as { typeId?: string | null })?.typeId ?? null).toBeNull()
  })
})

describe('meeting series (manual recurring)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('groups manual weekly meetings with same title + day into one series', async () => {
    const caller = await createTestCaller()
    const a = await caller.meetings.create({ title: 'Weekly standup', date: '2026-07-06', recurring: 'weekly', recurrenceDay: 'Monday' })
    const b = await caller.meetings.create({ title: 'Weekly standup', date: '2026-07-13', recurring: 'weekly', recurrenceDay: 'Monday' })

    const aRow = await caller.meetings.getById({ id: a.id })
    const bRow = await caller.meetings.getById({ id: b.id })
    const aSeries = (aRow as { seriesId?: string | null })?.seriesId
    const bSeries = (bRow as { seriesId?: string | null })?.seriesId
    expect(aSeries).toBeTruthy()
    expect(aSeries).toBe(bSeries)

    const series = await caller.meetings.listSeries()
    expect(series).toHaveLength(1)
    expect(series[0].instanceCount).toBe(2)
  })

  it('non-recurring meeting has no series', async () => {
    const caller = await createTestCaller()
    const m = await caller.meetings.create({ title: 'One-off', date: '2026-07-20' })
    const row = await caller.meetings.getById({ id: m.id })
    expect((row as { seriesId?: string | null })?.seriesId ?? null).toBeNull()
    expect(await caller.meetings.listSeries()).toHaveLength(0)
  })

  it('updateSeriesNotes persists rolling notes', async () => {
    const caller = await createTestCaller()
    await caller.meetings.create({ title: 'Ops weekly', date: '2026-07-06', recurring: 'weekly', recurrenceDay: 'Monday' })
    const [series] = await caller.meetings.listSeries()
    const updated = await caller.meetings.updateSeriesNotes({ id: series.id, rollingNotes: 'agenda: budget' })
    expect(updated!.rollingNotes).toBe('agenda: budget')

    const detail = await caller.meetings.getSeries({ id: series.id })
    expect(detail!.rollingNotes).toBe('agenda: budget')
    expect(detail!.instances.length).toBe(1)
  })
})

describe('people review queue', () => {
  beforeEach(async () => {
    await resetDb()
  })

  async function insertUnconfirmed(id: string, name: string, email?: string) {
    const db = getTestDb()
    await db.insert(people).values({
      id,
      name,
      email: email ?? null,
      status: 'unconfirmed',
      source: 'calendar',
      createdAt: new Date().toISOString(),
    })
  }

  it('excludes unconfirmed people from the main list but shows them in the queue', async () => {
    const caller = await createTestCaller()
    await caller.people.create({ name: 'Known Person' })
    await insertUnconfirmed('u1', 'unknown@corp.com', 'unknown@corp.com')

    const list = await caller.people.list()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Known Person')

    const queue = await caller.people.reviewQueue()
    expect(queue).toHaveLength(1)
    expect(queue[0].id).toBe('u1')
  })

  it('confirm moves a person into the main list', async () => {
    const caller = await createTestCaller()
    await insertUnconfirmed('u2', 'someone@corp.com', 'someone@corp.com')
    await caller.people.confirm({ id: 'u2' })
    expect(await caller.people.reviewQueue()).toHaveLength(0)
    const list = await caller.people.list()
    expect(list.map((p) => p.id)).toContain('u2')
  })

  it('ignore hides a person from list and queue', async () => {
    const caller = await createTestCaller()
    await insertUnconfirmed('u3', 'spam@corp.com', 'spam@corp.com')
    await caller.people.ignore({ id: 'u3' })
    expect(await caller.people.reviewQueue()).toHaveLength(0)
    expect((await caller.people.list()).map((p) => p.id)).not.toContain('u3')
  })

  it('merge repoints meeting links and deletes the source', async () => {
    const caller = await createTestCaller()
    const target = await caller.people.create({ name: 'Real Contact' })
    await insertUnconfirmed('u4', 'dup@corp.com', 'dup@corp.com')
    const meeting = await caller.meetings.create({ title: 'Intro', date: '2026-07-21', peopleIds: ['u4'] })

    await caller.people.merge({ fromId: 'u4', toId: target!.id })

    expect(await caller.people.getById({ id: 'u4' })).toBeNull()
    const related = await caller.people.getRelated({ id: target!.id })
    expect(related.meetings.map((m) => m.id)).toContain(meeting.id)
  })
})

describe('person cadence', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('flags a recurring relationship in getRelated cadence', async () => {
    const caller = await createTestCaller()
    const person = await caller.people.create({ name: 'Weekly Partner' })
    await caller.meetings.create({
      title: 'Sync',
      date: '2026-07-06',
      recurring: 'weekly',
      recurrenceDay: 'Monday',
      peopleIds: [person!.id],
    })
    const related = await caller.people.getRelated({ id: person!.id })
    expect(related.cadence.isRecurring).toBe(true)
    expect(related.cadence.totalMeetings).toBe(1)
  })
})
