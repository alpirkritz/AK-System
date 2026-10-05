import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { meetingAnalyses, meetings, meetingSeries, people, seriesRoster } from '@ak-system/database'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'
import { analysisSentiment, compareTrend, personInProjectCopy, projectMoodCopy, projectScoreCopy } from '../services/warmth'

const NOW = new Date().toISOString()

async function seedSeries(participants: { name: string; email: string | null }[][]) {
  const db = getTestDb()
  await db.insert(meetingSeries).values({
    id: 'ms1', title: 'Algo 4.0', cadence: 'weekly', recurrenceDay: 'Monday', rollingNotes: null, createdAt: NOW, updatedAt: NOW,
  })
  let i = 0
  for (const list of participants) {
    i++
    await db.insert(meetings).values({
      id: `m${i}`,
      title: 'Algo 4.0',
      date: `2020-01-${String(i).padStart(2, '0')}`,
      time: '10:00',
      seriesId: 'ms1',
      calendarParticipants: JSON.stringify(list.map((p) => ({ ...p, source: 'description' }))),
      createdAt: NOW,
      updatedAt: NOW,
    })
  }
}

describe('circles router', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('shows no roster and no recommendation until saved from the calendar', async () => {
    await seedSeries([[{ name: 'Dana', email: 'dana@dt.com' }, { name: 'Ron', email: null }]])
    const caller = await createTestCaller()
    const circle = await caller.circles.get({ seriesId: 'ms1' })
    expect(circle.rosterCount).toBe(0)
    expect(circle.recommendation).toBeNull()
    expect(circle.calendarParticipants).toHaveLength(2)
  })

  it('saves the roster once and links known people by email without creating CRM people', async () => {
    const db = getTestDb()
    await db.insert(people).values({ id: 'p_dana', name: 'Dana Levi', email: 'dana@dt.com', status: 'confirmed', source: 'manual', createdAt: NOW })
    await seedSeries([[{ name: 'Dana', email: 'dana@dt.com' }, { name: 'Ron', email: null }]])
    const caller = await createTestCaller()

    expect(await caller.circles.saveFromCalendar({ seriesId: 'ms1' })).toEqual({ added: 2 })
    const circle = await caller.circles.get({ seriesId: 'ms1' })
    expect(circle.rosterCount).toBe(2)
    expect(circle.roster.find((r) => r.email === 'dana@dt.com')?.personId).toBe('p_dana')
    expect(circle.diff).toBeNull()
    expect(circle.recommendation).toBeTruthy()
    expect(await db.select().from(people)).toHaveLength(1)
  })

  it('surfaces a calendar diff, can dismiss it, and applies it', async () => {
    await seedSeries([
      [{ name: 'Dana', email: 'dana@dt.com' }, { name: 'Ron', email: null }],
    ])
    const caller = await createTestCaller()
    await caller.circles.saveFromCalendar({ seriesId: 'ms1' })

    const db = getTestDb()
    await db.insert(meetings).values({
      id: 'm_next', title: 'Algo 4.0', date: '2099-02-01', time: '10:00', seriesId: 'ms1',
      calendarParticipants: JSON.stringify([
        { name: 'Dana', email: 'dana@dt.com', source: 'description' },
        { name: 'Noa', email: 'noa@dt.com', source: 'description' },
      ]),
      createdAt: NOW, updatedAt: NOW,
    })

    const withDiff = await caller.circles.get({ seriesId: 'ms1' })
    expect(withDiff.diff?.newInCalendar.map((p) => p.name)).toEqual(['Noa'])
    expect(withDiff.diff?.missingFromCalendar.map((r) => r.displayName)).toEqual(['Ron'])

    await caller.circles.dismissCalendarDiff({ seriesId: 'ms1' })
    expect((await caller.circles.get({ seriesId: 'ms1' })).diff).toBeNull()

    expect(await caller.circles.applyCalendarDiff({ seriesId: 'ms1' })).toEqual({ added: 1, retired: 1 })
    const after = await caller.circles.get({ seriesId: 'ms1' })
    expect(after.roster.map((r) => r.displayName).sort()).toEqual(['Dana', 'Noa'])
    expect(after.diff).toBeNull()
  })

  it('tracks absences and guests per occurrence', async () => {
    await seedSeries([[{ name: 'Dana', email: 'dana@dt.com' }, { name: 'Ron', email: null }]])
    const caller = await createTestCaller()
    await caller.circles.saveFromCalendar({ seriesId: 'ms1' })
    const [ron] = (await caller.circles.get({ seriesId: 'ms1' })).roster.filter((r) => r.displayName === 'Ron')

    await caller.circles.markAbsent({ meetingId: 'm1', rosterId: ron.id })
    await caller.circles.markAbsent({ meetingId: 'm1', rosterId: ron.id })
    await caller.circles.addGuest({ meetingId: 'm1', name: 'Guest', email: null })

    const attendance = await caller.circles.attendance({ meetingId: 'm1' })
    expect(attendance?.absent).toHaveLength(1)
    expect(attendance?.guests.map((g) => g.displayName)).toEqual(['Guest'])
    expect(attendance?.expectedCount).toBe(2)

    await caller.circles.removeException({ exceptionId: attendance!.absent[0].id })
    expect((await caller.circles.attendance({ meetingId: 'm1' }))?.expectedCount).toBe(3)
  })

  it('follow promotes a roster row to one confirmed person and reuses it', async () => {
    await seedSeries([[{ name: 'Ron', email: 'ron@dt.com' }]])
    const caller = await createTestCaller()
    await caller.circles.saveFromCalendar({ seriesId: 'ms1' })
    const [row] = (await caller.circles.get({ seriesId: 'ms1' })).roster

    const first = await caller.circles.follow({ rosterId: row.id })
    expect(first.created).toBe(true)
    const second = await caller.circles.follow({ rosterId: row.id })
    expect(second).toEqual({ personId: first.personId, created: false })

    const db = getTestDb()
    const [person] = await db.select().from(people).where(eq(people.id, first.personId))
    expect(person.status).toBe('confirmed')
    const ctx = await caller.insights.personContext({ personId: first.personId })
    expect(ctx?.circles.map((c) => c.seriesTitle)).toEqual(['Algo 4.0'])
  })

  it('removeMember retires the row from the roster count', async () => {
    await seedSeries([[{ name: 'Dana', email: null }, { name: 'Ron', email: null }]])
    const caller = await createTestCaller()
    await caller.circles.saveFromCalendar({ seriesId: 'ms1' })
    const [first] = (await caller.circles.get({ seriesId: 'ms1' })).roster
    await caller.circles.removeMember({ rosterId: first.id })
    expect((await caller.circles.get({ seriesId: 'ms1' })).rosterCount).toBe(1)
    expect(await getTestDb().select().from(seriesRoster)).toHaveLength(2)
  })

  it('series warmth flags a cooling circle after six analysed instances', async () => {
    const db = getTestDb()
    await db.insert(meetingSeries).values({
      id: 'ms1', title: 'Algo 4.0', cadence: 'weekly', recurrenceDay: 'Monday', rollingNotes: null, createdAt: NOW, updatedAt: NOW,
    })
    const scores = [3, 3, 4, 8, 9, 8]
    for (let i = 0; i < scores.length; i++) {
      const id = `mw${i}`
      await db.insert(meetings).values({
        id, title: 'Algo 4.0', date: `2020-01-${String(10 - i).padStart(2, '0')}`, time: '10:00', seriesId: 'ms1', createdAt: NOW, updatedAt: NOW,
      })
      await db.insert(meetingAnalyses).values({
        id: `a${i}`, meetingId: id, source: 'transcript', score: scores[i], mood: null, subtext: null, status: 'completed', createdAt: NOW, updatedAt: NOW,
      })
    }
    const caller = await createTestCaller()
    const circle = await caller.circles.get({ seriesId: 'ms1' })
    expect(circle.warmth.trend).toBe('cooling')
    expect(circle.warmth.count).toBe(6)
  })
})

describe('warmth helpers', () => {
  it('maps score and mood into [-1, 1]', () => {
    expect(analysisSentiment({ score: 10, mood: 'focused and collaborative', subtext: null })).toBeGreaterThan(0.8)
    expect(analysisSentiment({ score: 1, mood: 'tense with urgency', subtext: null })).toBeLessThan(-0.8)
  })

  it('describes a person from the meetings they sat in', () => {
    expect(personInProjectCopy('דנה', [0.5], [-0.4], 4).text).toBe('הקשר עם דנה מתחמם.')
    expect(personInProjectCopy('דנה', [], [], 0).text).toBe('רשום בפרויקט, עוד לא בשיחה מנותחת.')
    expect(personInProjectCopy('דנה', [0], [], 2).text).toBe('2 שיחות בפרויקט. מגמה אחרי 4.')
  })

  it('reads room mood without treating a missing signal as calm', () => {
    expect(projectMoodCopy([0.4], [-0.4], 4)).toEqual({ trend: 'warming', text: 'האווירה בחדר מתחממת.' })
    expect(projectMoodCopy([0, 0], [0, 0], 4)).toEqual({ trend: null, text: '' })
    expect(projectMoodCopy([1], [], 2).text).toBe('אחרי 4 שיחות אפשר לראות אם האווירה זזה.')
  })

  it('describes a project score change out of 10, without mood text', () => {
    expect(projectScoreCopy([6, 6], [8, 7], 4)).toBe('הציון ירד מ־7.5 ל־6 מתוך 10.')
    expect(projectScoreCopy([8], [6], 4)).toBe('הציון עלה מ־6 ל־8 מתוך 10.')
    expect(projectScoreCopy([6], [], 2)).toBe('נותחו 2 שיחות. המגמה תופיע אחרי 4.')
  })

  it('needs a 0.2 shift to call a trend', () => {
    expect(compareTrend([0.5], [0.4])).toBe('stable')
    expect(compareTrend([0.7], [0.4])).toBe('warming')
    expect(compareTrend([0.1], [0.4])).toBe('cooling')
    expect(compareTrend([], [0.4])).toBeNull()
  })
})
