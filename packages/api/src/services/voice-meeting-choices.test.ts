import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { meetingPeople, meetings, people, projects, voiceRecordingPeople, voiceRecordings } from '@ak-system/database'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb } from '../test-utils'
import {
  getMeetingChoice,
  getVoiceRecording,
  listMeetingChoices,
  localDateTime,
  processVoiceRecording,
  saveVoiceUpload,
} from './voice'
import type { AnalysisResult } from './meeting-analysis'

const NOW = new Date().toISOString()
let voiceDir = ''

beforeAll(() => {
  voiceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-voice-choices-'))
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

/** 10:00 local time today — a fixed "now" so the state buckets are deterministic. */
function nowAt(hhmm: string): number {
  const today = localDateTime(Date.now()).date
  // Walk the day in 5-minute steps until the local clock matches; avoids hardcoding a UTC offset.
  const midnightUtc = Date.parse(`${today}T00:00:00.000Z`)
  for (let offset = -14 * 60; offset <= 14 * 60 + 24 * 60; offset += 5) {
    const candidate = midnightUtc + offset * 60_000
    const local = localDateTime(candidate)
    if (local.date === today && local.time === hhmm) return candidate
  }
  throw new Error(`could not build a local timestamp for ${hhmm}`)
}

async function meeting(
  id: string,
  time: string,
  endTime: string | null,
  extra: { date?: string; source?: string; location?: string | null; projectId?: string | null } = {},
) {
  await getTestDb().insert(meetings).values({
    id,
    title: `Meeting ${id}`,
    date: extra.date ?? localDateTime(Date.now()).date,
    time,
    endTime,
    location: extra.location ?? null,
    projectId: extra.projectId ?? null,
    source: extra.source ?? 'calendar',
    createdAt: NOW,
    updatedAt: NOW,
  })
}

describe('listMeetingChoices', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('buckets meetings into now / upcoming / ended and orders them for tapping', async () => {
    const db = getTestDb()
    await meeting('running', '09:45', '10:30')
    await meeting('soon', '10:20', '11:00')
    await meeting('later', '15:00', '16:00')
    await meeting('over', '08:00', '08:45')

    const choices = await listMeetingChoices(db, { now: nowAt('10:00') })
    expect(choices.map((c) => [c.id, c.state])).toEqual([
      ['running', 'now'],
      ['soon', 'now'],
      ['later', 'upcoming'],
      ['over', 'ended'],
    ])
  })

  it('treats a meeting with no end time as an hour long', async () => {
    const db = getTestDb()
    await meeting('open-ended', '09:30', null)
    const [choice] = await listMeetingChoices(db, { now: nowAt('10:15') })
    expect(choice.state).toBe('now')
    expect((await listMeetingChoices(db, { now: nowAt('11:00') }))[0].state).toBe('ended')
  })

  it('excludes voice placeholder meetings and other days', async () => {
    const db = getTestDb()
    await meeting('placeholder', '10:00', '11:00', { source: 'voice' })
    await meeting('yesterday', '10:00', '11:00', { date: '2020-01-01' })
    await meeting('keep', '10:00', '11:00', { source: 'manual' })
    expect((await listMeetingChoices(db, { now: nowAt('10:30') })).map((c) => c.id)).toEqual(['keep'])
  })

  it('carries attendees, location and project name, skipping ignored people', async () => {
    const db = getTestDb()
    await db.insert(projects).values({ id: 'proj', name: 'Apollo', createdAt: NOW, updatedAt: NOW })
    await db.insert(people).values([
      { id: 'p1', name: 'Dana Levi', status: 'confirmed', source: 'manual', createdAt: NOW },
      { id: 'p2', name: 'Spam Bot', status: 'ignored', source: 'calendar', createdAt: NOW },
    ])
    await meeting('m1', '10:00', '11:00', { location: 'חדר ישיבות', projectId: 'proj' })
    await db.insert(meetingPeople).values([
      { meetingId: 'm1', personId: 'p1' },
      { meetingId: 'm1', personId: 'p2' },
    ])

    const [choice] = await listMeetingChoices(db, { now: nowAt('10:30') })
    expect(choice).toMatchObject({ location: 'חדר ישיבות', projectId: 'proj', projectName: 'Apollo' })
    expect(choice.people).toEqual([{ id: 'p1', name: 'Dana Levi' }])
  })

  it('returns an empty list when the day is clear', async () => {
    expect(await listMeetingChoices(getTestDb(), { now: nowAt('10:00') })).toEqual([])
  })
})

describe('getMeetingChoice', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('resolves a meeting on another day, for the record-this-meeting deep link', async () => {
    const db = getTestDb()
    await meeting('other-day', '09:00', '10:00', { date: '2030-05-04' })
    const choice = await getMeetingChoice(db, 'other-day', { now: nowAt('10:00') })
    expect(choice).toMatchObject({ id: 'other-day', date: '2030-05-04', state: 'upcoming' })
  })

  it('returns null for an unknown id and for a voice placeholder', async () => {
    const db = getTestDb()
    await meeting('placeholder', '10:00', '11:00', { source: 'voice' })
    expect(await getMeetingChoice(db, 'nope')).toBeNull()
    expect(await getMeetingChoice(db, 'placeholder')).toBeNull()
  })
})

describe('saveVoiceUpload with a chosen meeting', () => {
  beforeEach(async () => {
    await resetDb()
    const db = getTestDb()
    await db.insert(projects).values({ id: 'proj', name: 'Apollo', createdAt: NOW, updatedAt: NOW })
    await db.insert(people).values([
      { id: 'p1', name: 'Dana Levi', status: 'confirmed', source: 'calendar', createdAt: NOW },
      { id: 'p2', name: 'Noa Barak', status: 'confirmed', source: 'calendar', createdAt: NOW },
      { id: 'p3', name: 'Spam Bot', status: 'ignored', source: 'calendar', createdAt: NOW },
    ])
    await meeting('m1', '10:00', '11:00', { projectId: 'proj' })
    await db.insert(meetingPeople).values([
      { meetingId: 'm1', personId: 'p1' },
      { meetingId: 'm1', personId: 'p3' },
    ])
  })

  const upload = (input: Partial<Parameters<typeof saveVoiceUpload>[1]> = {}) =>
    saveVoiceUpload(getTestDb(), {
      audio: Buffer.from('x'),
      mimeType: 'audio/webm',
      durationSeconds: 600,
      consentConfirmed: true,
      personIds: [],
      meetingId: 'm1',
      ...input,
    })

  it('seeds the meeting attendees and inherits its project, skipping ignored people', async () => {
    const db = getTestDb()
    const { recordingId } = await upload()
    const linked = (await db.select().from(voiceRecordingPeople).where(eq(voiceRecordingPeople.recordingId, recordingId))).map((r) => r.personId)
    expect(linked.sort()).toEqual(['p1'])
    const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    expect(rec).toMatchObject({ meetingId: 'm1', projectId: 'proj' })
  })

  it('unions the attendees with people the client sent and keeps an explicit project', async () => {
    const db = getTestDb()
    await db.insert(projects).values({ id: 'other', name: 'Zeus', createdAt: NOW, updatedAt: NOW })
    const { recordingId } = await upload({ personIds: ['p2'], projectId: 'other' })
    const linked = (await db.select().from(voiceRecordingPeople).where(eq(voiceRecordingPeople.recordingId, recordingId))).map((r) => r.personId)
    expect(linked.sort()).toEqual(['p1', 'p2'])
    const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    expect(rec.projectId).toBe('other')
  })

  it('rejects a meeting that does not exist', async () => {
    await expect(upload({ meetingId: 'ghost' })).rejects.toThrow('הפגישה לא נמצאה')
  })
})

describe('meetingLink on the recording summary', () => {
  beforeEach(async () => {
    await resetDb()
    await meeting('m1', '10:00', '11:00')
  })

  const process = (recordingId: string) =>
    processVoiceRecording(getTestDb(), recordingId, { transcribe: async () => 'שיחה', analyze: async () => analysis() })

  it('reports a meeting picked before recording as chosen, without an automatic match', async () => {
    const db = getTestDb()
    const { recordingId } = await saveVoiceUpload(db, {
      audio: Buffer.from('x'),
      mimeType: 'audio/webm',
      durationSeconds: 600,
      consentConfirmed: true,
      meetingId: 'm1',
    })
    const rec = await process(recordingId)
    expect(rec).toMatchObject({ meetingId: 'm1', createdMeetingId: null, matchedAutomatically: false })
    expect((await getVoiceRecording(db, recordingId))?.meetingLink).toBe('chosen')
  })

  it('reports a placeholder meeting as standalone', async () => {
    const db = getTestDb()
    await db.delete(meetings).where(eq(meetings.id, 'm1'))
    const { recordingId } = await saveVoiceUpload(db, {
      audio: Buffer.from('x'),
      mimeType: 'audio/webm',
      durationSeconds: 600,
      consentConfirmed: true,
    })
    await process(recordingId)
    expect((await getVoiceRecording(db, recordingId))?.meetingLink).toBe('standalone')
  })

  it('reports an automatically matched meeting as auto', async () => {
    const db = getTestDb()
    const { recordingId } = await saveVoiceUpload(db, {
      audio: Buffer.from('x'),
      mimeType: 'audio/webm',
      durationSeconds: 600,
      consentConfirmed: true,
    })
    // The sole calendar meeting of the day spans it entirely, so auto-match is unambiguous.
    await db.update(meetings).set({ time: '00:00', endTime: '23:59' }).where(eq(meetings.id, 'm1'))
    await process(recordingId)
    expect((await getVoiceRecording(db, recordingId))?.meetingLink).toBe('auto')
  })

  it('reports no link when the recording has no meeting at all', async () => {
    const db = getTestDb()
    const { recordingId } = await saveVoiceUpload(db, {
      audio: Buffer.from('x'),
      mimeType: 'audio/webm',
      durationSeconds: 600,
      consentConfirmed: true,
    })
    expect((await getVoiceRecording(db, recordingId))?.meetingLink).toBeNull()
  })
})
