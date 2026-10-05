import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { meetingAnalyses, meetingNotes, meetingPeople, meetings, people } from '@ak-system/database'
import { getTestDb, resetDb } from '../test-utils'
import { analysisBacklogSummary, listAnalysisBacklog, runAnalysisBacklog } from './analysis-backlog'
import type { AnalysisResult } from './meeting-analysis'

const NOW = new Date().toISOString()
const today = new Date()
const iso = (daysAgo: number) => new Date(today.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10)
const BODY = 'סיכום פגישה. '.repeat(20)

async function seedMeeting(id: string, daysAgo: number, body: string | null, opts: { person?: boolean } = {}) {
  const db = getTestDb()
  await db.insert(meetings).values({ id, title: `Meeting ${id}`, date: iso(daysAgo), time: '10:00', createdAt: NOW, updatedAt: NOW })
  if (body != null) {
    await db.insert(meetingNotes).values({
      id: `n_${id}`, title: `Meeting ${id}`, date: iso(daysAgo), meetingId: id, bodyText: body, source: 'notion', sourceKind: 'meeting_page_summary', createdAt: NOW, updatedAt: NOW,
    })
  }
  if (opts.person) await db.insert(meetingPeople).values({ meetingId: id, personId: 'p1' })
}

const RESULT: AnalysisResult = {
  hatName: 'Coach', topic: 'סטטוס', mood: 'חיובית', subtext: '', keyInsight: 'יש התקדמות', score: 8, scoreRationale: 'שיחה זורמת',
  kaizenKeep: '', kaizenImprove: '', openQuestion: '', participants: [], actionItems: [],
}

describe('analysis backlog', () => {
  beforeEach(async () => {
    await resetDb()
    await getTestDb().insert(people).values({ id: 'p1', name: 'Dana', status: 'confirmed', source: 'manual', createdAt: NOW })
  })

  it('lists only meetings with a real body, inside the window, without a live analysis', async () => {
    const db = getTestDb()
    await seedMeeting('linked', 20, BODY, { person: true })
    await seedMeeting('newer', 5, BODY)
    await seedMeeting('short', 10, 'קצר מדי')
    await seedMeeting('nobody', 10, null)
    await seedMeeting('old', 200, BODY)
    await seedMeeting('future', -3, BODY)
    await seedMeeting('done', 15, BODY)
    await db.insert(meetingAnalyses).values({ id: 'a_done', meetingId: 'done', source: 'transcript', score: 7, status: 'completed', createdAt: NOW, updatedAt: NOW })
    await seedMeeting('pending', 15, BODY)
    await db.insert(meetingAnalyses).values({ id: 'a_pending', meetingId: 'pending', source: 'transcript', status: 'pending', createdAt: NOW, updatedAt: NOW })
    await seedMeeting('freshFail', 15, BODY)
    await db.insert(meetingAnalyses).values({ id: 'a_ff', meetingId: 'freshFail', source: 'transcript', status: 'failed', createdAt: NOW, updatedAt: NOW })
    await seedMeeting('oldFail', 30, BODY)
    const twoHoursAgo = new Date(today.getTime() - 2 * 3_600_000).toISOString()
    await db.insert(meetingAnalyses).values({ id: 'a_of', meetingId: 'oldFail', source: 'transcript', status: 'failed', createdAt: twoHoursAgo, updatedAt: twoHoursAgo })

    const backlog = await listAnalysisBacklog(db)
    expect(backlog.map((m) => m.meetingId)).toEqual(['linked', 'newer', 'oldFail'])
    expect(backlog[0]?.hasPeople).toBe(true)

    const summary = await analysisBacklogSummary(db)
    expect(summary).toMatchObject({ pending: 3, analysed: 1 })
    expect(await listAnalysisBacklog(db, { limit: 1 })).toHaveLength(1)
  })

  it('stores completed and failed rows and reports the counts', async () => {
    const db = getTestDb()
    await seedMeeting('ok1', 5, BODY, { person: true })
    await seedMeeting('bad', 6, BODY)
    await seedMeeting('ok2', 7, BODY)
    await seedMeeting('later', 8, BODY)

    const calls: string[] = []
    const analyze = async (opts: { meetingTitle: string }) => {
      calls.push(opts.meetingTitle)
      if (opts.meetingTitle === 'Meeting bad') throw new Error('quota')
      return RESULT
    }
    const r = await runAnalysisBacklog(db, { limit: 3, analyze })
    expect(calls).toEqual(['Meeting ok1', 'Meeting bad', 'Meeting ok2'])
    expect(r).toMatchObject({ analysed: 2, failed: 1, remaining: 2 })

    const ok = await db.select().from(meetingAnalyses).where(eq(meetingAnalyses.meetingId, 'ok1'))
    expect(ok[0]).toMatchObject({ status: 'completed', source: 'backfill', score: 8, mood: 'חיובית', meetingNoteId: 'n_ok1' })
    const bad = await db.select().from(meetingAnalyses).where(eq(meetingAnalyses.meetingId, 'bad'))
    expect(bad[0]).toMatchObject({ status: 'failed', error: 'quota' })

    // The fresh failure is skipped; only the untouched meeting is left.
    expect((await listAnalysisBacklog(db)).map((m) => m.meetingId)).toEqual(['later'])
  })
})
