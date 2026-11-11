import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { meetingPeople, meetings, people, voiceRecordings } from '@ak-system/database'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb } from '../test-utils'
import { getAgentCalendarIds, setAgentCalendarIds } from './agent-calendar-scope'
import { findAutoMatchMeeting, localDateTime, processVoiceRecording, saveVoiceUpload } from './voice'
import type { AnalysisResult } from './meeting-analysis'

const NOW = new Date().toISOString()
let voiceDir = ''

beforeAll(() => {
  voiceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-voice-automatch-'))
  process.env.VOICE_STORAGE_DIR = voiceDir
})

afterAll(() => {
  fs.rmSync(voiceDir, { recursive: true, force: true })
  delete process.env.VOICE_STORAGE_DIR
})

function analysis(): AnalysisResult {
  return {
    hatName: 'Hat',
    topic: 'שיחה',
    mood: '',
    subtext: '',
    keyInsight: '',
    score: 5,
    scoreRationale: '',
    kaizenKeep: '',
    kaizenImprove: '',
    openQuestion: '',
    participants: [],
    actionItems: [],
  } as unknown as AnalysisResult
}

/** A recording that just ended `endedMinutesAgo` minutes ago, lasting `durationMinutes`. */
async function uploadEndingAt(endedMinutesAgo: number, durationMinutes = 30) {
  const now = Date.now() - endedMinutesAgo * 60_000
  return saveVoiceUpload(getTestDb(), {
    audio: Buffer.from('x'),
    mimeType: 'audio/webm',
    durationSeconds: durationMinutes * 60,
    consentConfirmed: true,
    personIds: [],
    now,
  })
}

async function calendarMeeting(id: string, date: string, time: string, endTime: string, calendarId: string | null = null) {
  await getTestDb().insert(meetings).values({ id, title: `Meeting ${id}`, date, time, endTime, source: 'calendar', calendarId, createdAt: NOW, updatedAt: NOW })
}

describe('findAutoMatchMeeting', () => {
  beforeEach(async () => {
    await resetDb()
  })
  afterEach(async () => {
    await setAgentCalendarIds(null)
  })

  it('returns null when no calendar meeting overlaps', async () => {
    const db = getTestDb()
    const { recordingId } = await uploadEndingAt(5)
    const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    expect(await findAutoMatchMeeting(db, rec)).toBeNull()
  })

  it('matches the sole overlapping calendar meeting', async () => {
    const db = getTestDb()
    const { recordingId } = await uploadEndingAt(5, 30)
    const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    await calendarMeeting('mtg', localDateTime(Date.parse(rec.createdAt)).date, '00:00', '23:59')
    const match = await findAutoMatchMeeting(db, rec)
    expect(match).toEqual({ id: 'mtg' })
  })

  it('does not guess when several calendar meetings overlap', async () => {
    const db = getTestDb()
    const { recordingId } = await uploadEndingAt(5, 30)
    const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    const date = localDateTime(Date.parse(rec.createdAt)).date
    await calendarMeeting('mtg1', date, '00:00', '23:59')
    await calendarMeeting('mtg2', date, '00:00', '23:59')
    expect(await findAutoMatchMeeting(db, rec)).toBeNull()
  })

  it('ignores meetings whose source is not calendar (e.g. voice placeholders)', async () => {
    const db = getTestDb()
    const { recordingId } = await uploadEndingAt(5, 30)
    const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    const date = localDateTime(Date.parse(rec.createdAt)).date
    await db.insert(meetings).values({ id: 'voice-mtg', title: 'שיחה מוקלטת', date, time: '00:00', endTime: '23:59', source: 'voice', createdAt: NOW, updatedAt: NOW })
    expect(await findAutoMatchMeeting(db, rec)).toBeNull()
  })

  it('excludes calendars outside the agentCalendarIds scope, includes calendars inside it', async () => {
    const db = getTestDb()
    const { recordingId } = await uploadEndingAt(5, 30)
    const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    const date = localDateTime(Date.parse(rec.createdAt)).date
    await calendarMeeting('mtg-out', date, '00:00', '23:59', 'cal-other@x.com')
    await setAgentCalendarIds(['cal-mine@x.com'])
    expect(await findAutoMatchMeeting(db, rec)).toBeNull()

    await db.delete(meetings).where(eq(meetings.id, 'mtg-out'))
    await calendarMeeting('mtg-in', date, '00:00', '23:59', 'cal-mine@x.com')
    expect(await findAutoMatchMeeting(db, rec)).toEqual({ id: 'mtg-in' })
  })

  it('treats a null calendarId (not yet resynced) as in-scope even when scope is narrowed', async () => {
    const db = getTestDb()
    const { recordingId } = await uploadEndingAt(5, 30)
    const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    const date = localDateTime(Date.parse(rec.createdAt)).date
    await calendarMeeting('legacy', date, '00:00', '23:59', null)
    await setAgentCalendarIds(['cal-mine@x.com'])
    expect(await findAutoMatchMeeting(db, rec)).toEqual({ id: 'legacy' })
  })

  it('scope defaults to null (all calendars) when never configured', async () => {
    expect(await getAgentCalendarIds()).toBeNull()
  })
})

describe('processVoiceRecording auto-match integration', () => {
  beforeEach(async () => {
    await resetDb()
    await getTestDb().insert(people).values({ id: 'p1', name: 'Dana Levi', email: 'dana@acme.com', status: 'confirmed', source: 'manual', createdAt: NOW })
  })
  afterEach(async () => {
    await setAgentCalendarIds(null)
  })

  it('auto-attaches to the sole overlapping calendar meeting instead of creating a placeholder', async () => {
    const db = getTestDb()
    const { recordingId } = await uploadEndingAt(5, 30)
    const [pre] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    const date = localDateTime(Date.parse(pre.createdAt)).date
    await calendarMeeting('mtg', date, '00:00', '23:59')
    await db.insert(meetingPeople).values({ meetingId: 'mtg', personId: 'p1' })

    const rec = await processVoiceRecording(db, recordingId, { transcribe: async () => 'שיחה', analyze: async () => analysis() })
    expect(rec).toMatchObject({ meetingId: 'mtg', createdMeetingId: null, matchedAutomatically: true })
    expect(await db.select().from(meetings)).toHaveLength(1)
    expect((await db.select().from(meetingPeople).where(eq(meetingPeople.meetingId, 'mtg'))).map((r) => r.personId)).toEqual(['p1'])
  })

  it('falls back to a placeholder meeting when no calendar meeting overlaps, and marks it not automatic', async () => {
    const db = getTestDb()
    const { recordingId } = await uploadEndingAt(5, 30)
    const rec = await processVoiceRecording(db, recordingId, { transcribe: async () => 'שיחה', analyze: async () => analysis() })
    expect(rec.matchedAutomatically).toBe(false)
    expect(rec.meetingId).toBe(rec.createdMeetingId)
    const [meeting] = await db.select().from(meetings).where(eq(meetings.id, rec.meetingId!))
    expect(meeting.source).toBe('voice')
  })
})
