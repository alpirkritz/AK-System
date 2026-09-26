import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { meetingAnalyses, meetingPeople, meetings, people, personTraits } from '@ak-system/database'
import { getTestDb, resetDb } from '../test-utils'
import {
  buildTraitLine,
  classifyTraits,
  readPersonTraitDetail,
  readPersonTraits,
  traitsAreStale,
  writePersonTraits,
  type PortraitModel,
} from './person-portrait'

const NOW = '2026-09-01T10:00:00.000Z'

function model(log: { extract: number }, failCluster = false): PortraitModel {
  return {
    async extract(artifacts) {
      log.extract += 1
      return artifacts.map((a) => ({ sourceId: a.sourceId, claim: 'בודק כל פרט', quote: a.text.slice(0, 12) }))
    },
    async cluster({ observations, excludedLabels }) {
      if (failCluster) throw new Error('down')
      if (excludedLabels.includes('יסודי')) {
        return [{ label: 'שקט', clause: 'מדבר מעט', reasoning: 'שתי שיחות שקטות.', observationIds: observations.map((o) => o.id) }]
      }
      return [{ label: 'יסודי', clause: 'בודק כל פרט לפני שמתחייב', reasoning: 'חזר על בדיקה בשתי שיחות.', observationIds: observations.map((o) => o.id) }]
    },
  }
}

async function seedTwoMeetings() {
  const db = getTestDb()
  await db.insert(people).values({ id: 'p_traits', name: 'דנה', status: 'confirmed', source: 'manual', createdAt: NOW })
  await db.insert(meetings).values([
    { id: 'm_t1', title: 'שיחה אחת', date: '2026-08-01', time: '10:00', createdAt: NOW, updatedAt: NOW },
    { id: 'm_t2', title: 'שיחה שתיים', date: '2026-08-20', time: '10:00', createdAt: NOW, updatedAt: NOW },
  ])
  await db.insert(meetingPeople).values([{ meetingId: 'm_t1', personId: 'p_traits' }, { meetingId: 'm_t2', personId: 'p_traits' }])
  await db.insert(meetingAnalyses).values([
    { id: 'a_t1', meetingId: 'm_t1', source: 'transcript', status: 'completed', mood: 'מדויק', createdAt: NOW, updatedAt: '2026-08-01T10:00:00.000Z' },
    { id: 'a_t2', meetingId: 'm_t2', source: 'transcript', status: 'completed', mood: 'מדויק', createdAt: NOW, updatedAt: '2026-08-20T10:00:00.000Z' },
  ])
}

describe('person traits', () => {
  beforeEach(async () => { await resetDb() })

  it('orders by support and keeps a single source out of the default list', () => {
    const obs = [
      { id: '1', sourceId: 'a', sourceDate: '2026-01-01' },
      { id: '2', sourceId: 'b', sourceDate: '2026-02-01' },
      { id: '3', sourceId: 'c', sourceDate: '2026-03-01' },
    ]
    const ranked = classifyTraits([
      { label: 'ישיר', clause: 'אומר מה הוא רוצה', reasoning: 'שלוש שיחות.', observationIds: ['1', '2', '3'] },
      { label: 'יסודי', clause: 'בודק', reasoning: 'שתיים.', observationIds: ['1', '2'] },
      { label: 'שקט', clause: 'מדבר מעט', reasoning: 'פעם אחת.', observationIds: ['3'] },
      { label: 'יסודי', clause: 'לא', reasoning: 'חסום.', observationIds: ['1'] },
    ], obs, ['יסודי'])
    expect(ranked.map((t) => t.label)).toEqual(['ישיר', 'שקט'])
    expect(ranked[0]).toMatchObject({ status: 'shown', supportCount: 3 })
    expect(ranked[1]).toMatchObject({ status: 'once', supportCount: 1 })
  })

  it('keeps the trait line within 90 characters', () => {
    expect(buildTraitLine('יסודי', 'ב'.repeat(200)).length).toBeLessThanOrEqual(90)
    expect(traitsAreStale('2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z')).toBe(true)
    expect(traitsAreStale(null, '2026-09-02T00:00:00.000Z')).toBe(false)
  })

  it('writes shown traits from two meetings and does not resend an unchanged analysis', async () => {
    await seedTwoMeetings()
    const db = getTestDb()
    const log = { extract: 0 }
    const first = await writePersonTraits(db, 'p_traits', model(log))
    expect(first.traits.map((t) => t.label)).toEqual(['יסודי'])
    expect(first.traits[0]?.supportCount).toBe(2)
    expect(first.stale).toBe(false)
    expect(log.extract).toBe(1)

    await writePersonTraits(db, 'p_traits', model(log))
    expect(log.extract).toBe(1)

    const detail = await readPersonTraitDetail(db, 'p_traits')
    expect(detail.shown[0]?.evidence).toHaveLength(2)
    expect(detail.shown[0]?.evidence[0]?.href).toBe('/meetings/m_t2')
  })

  it('hides a single meeting from the default list', async () => {
    const db = getTestDb()
    await db.insert(people).values({ id: 'p_one', name: 'רון', status: 'confirmed', source: 'manual', createdAt: NOW })
    await db.insert(meetings).values({ id: 'm_one', title: 'אחת', date: '2026-08-01', time: '10:00', createdAt: NOW, updatedAt: NOW })
    await db.insert(meetingPeople).values({ meetingId: 'm_one', personId: 'p_one' })
    await db.insert(meetingAnalyses).values({ id: 'a_one', meetingId: 'm_one', source: 'transcript', status: 'completed', mood: 'שקט', createdAt: NOW, updatedAt: NOW })
    const summary = await writePersonTraits(db, 'p_one', model({ extract: 0 }))
    expect(summary.traits).toEqual([])
    const detail = await readPersonTraitDetail(db, 'p_one')
    expect(detail.once).toHaveLength(1)
  })

  it('keeps the previous traits when clustering fails and drops a dismissed label', async () => {
    await seedTwoMeetings()
    const db = getTestDb()
    const log = { extract: 0 }
    await writePersonTraits(db, 'p_traits', model(log))
    await expect(writePersonTraits(db, 'p_traits', model(log, true))).rejects.toThrow(/התכונות הקודמות נשמרו/)
    const kept = await readPersonTraits(db, 'p_traits')
    expect(kept.traits.map((t) => t.label)).toEqual(['יסודי'])

    const [trait] = await db.select().from(personTraits)
    await db.update(personTraits).set({ status: 'dismissed' }).where(eq(personTraits.id, trait!.id))
    const again = await writePersonTraits(db, 'p_traits', model(log))
    expect(again.traits.map((t) => t.label)).not.toContain('יסודי')
  })

  it('marks the portrait stale after a newer analysis', async () => {
    await seedTwoMeetings()
    const db = getTestDb()
    await writePersonTraits(db, 'p_traits', model({ extract: 0 }))
    await db.update(meetingAnalyses).set({ updatedAt: '2099-01-01T00:00:00.000Z' }).where(eq(meetingAnalyses.id, 'a_t2'))
    const summary = await readPersonTraits(db, 'p_traits')
    expect(summary.stale).toBe(true)
    expect(summary.hasSources).toBe(true)
  })
})
