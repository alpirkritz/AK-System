/**
 * Tests for docs/specs/recording-context-before-upload.md
 *
 * Covers:
 *  - Meeting title renamed from analysis.topic for voice-created placeholder meetings
 *  - Calendar-meeting titles are NOT overwritten
 *  - Gemini analysis receives projectName + knownPeople context
 *  - Empty personIds list (confirmed with no attendees) is accepted by saveVoiceUpload
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  meetingAnalyses,
  meetingPeople,
  meetings,
  people,
  projects,
  voiceRecordingPeople,
  voiceRecordings,
} from '@ak-system/database'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb } from '../test-utils'
import { localDateTime, processVoiceRecording, saveVoiceUpload, VOICE_PLACEHOLDER_TITLE } from '../services/voice'
import type { AnalysisResult, AnalyzeTranscriptOptions } from '../services/meeting-analysis'

const NOW = new Date().toISOString()

let voiceDir = ''

beforeAll(() => {
  voiceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-voice-ctx-'))
  process.env.VOICE_STORAGE_DIR = voiceDir
})

afterAll(() => {
  fs.rmSync(voiceDir, { recursive: true, force: true })
  delete process.env.VOICE_STORAGE_DIR
})

function stubAnalysis(topic = 'דיון אסטרטגי'): AnalysisResult {
  return {
    hatName: 'Default',
    topic,
    mood: 'focused',
    subtext: '',
    keyInsight: 'summary',
    score: 7,
    scoreRationale: '',
    kaizenKeep: '',
    kaizenImprove: '',
    openQuestion: '',
    participants: [],
    actionItems: [],
  } as unknown as AnalysisResult
}

async function seedBase() {
  const db = getTestDb()
  await db.insert(people).values([
    { id: 'p1', name: 'Dana Levi', email: 'dana@acme.com', role: 'VP Sales', company: 'Acme', status: 'confirmed', source: 'manual', createdAt: NOW },
    { id: 'p2', name: 'Ron Cohen', email: null, role: null, company: null, status: 'confirmed', source: 'manual', createdAt: NOW },
  ])
  await db.insert(projects).values({ id: 'prj1', name: 'Helm Launch', source: 'manual', createdAt: NOW, updatedAt: NOW })
}

describe('recording-context-before-upload', () => {
  beforeEach(async () => {
    await resetDb()
    await seedBase()
  })

  // -----------------------------------------------------------------------
  // Title update policy
  // -----------------------------------------------------------------------

  it('renames a placeholder meeting title from analysis.topic after processing', async () => {
    const db = getTestDb()
    const { recordingId } = await saveVoiceUpload(db, {
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm',
      durationSeconds: 60,
      consentConfirmed: true,
      personIds: ['p1'],
    })

    const rec = await processVoiceRecording(db, recordingId, {
      transcribe: async () => 'דובר 1: שלום',
      analyze: async () => stubAnalysis('תכנון Q4'),
    })

    const [m] = await db.select().from(meetings).where(eq(meetings.id, rec.meetingId!))
    expect(m.title).toBe('תכנון Q4')
    expect(m.source).toBe('voice')
  })

  it('does NOT rename a calendar meeting title even when recording attaches to it', async () => {
    const db = getTestDb()
    const local = localDateTime(Date.now() - 5 * 60_000)
    await db.insert(meetings).values({
      id: 'cal_mtg',
      title: 'Weekly Sync',
      date: local.date,
      time: '00:00',
      endTime: '23:59',
      source: 'calendar',
      createdAt: NOW,
      updatedAt: NOW,
    })
    const { recordingId } = await saveVoiceUpload(db, {
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm',
      durationSeconds: 60,
      consentConfirmed: true,
    })
    const rec = await processVoiceRecording(db, recordingId, {
      transcribe: async () => 'שיחה',
      analyze: async () => stubAnalysis('משהו אחר לגמרי'),
    })

    const [m] = await db.select().from(meetings).where(eq(meetings.id, rec.meetingId!))
    // Auto-matched to calendar meeting — title must not change.
    expect(m.title).toBe('Weekly Sync')
  })

  it('does NOT rename a voice meeting whose title was manually edited (does not start with placeholder)', async () => {
    const db = getTestDb()
    const { recordingId } = await saveVoiceUpload(db, {
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm',
      durationSeconds: 60,
      consentConfirmed: true,
    })
    // Manually force a custom title onto the placeholder before processing runs.
    const rec0 = await saveVoiceUpload(db, {
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm',
      durationSeconds: 60,
      consentConfirmed: true,
    })
    // process with default stub so placeholder meeting is created.
    const first = await processVoiceRecording(db, rec0.recordingId, {
      transcribe: async () => 'שיחה',
      analyze: async () => stubAnalysis('נושא ראשוני'),
    })
    // Manually rename the meeting.
    await db.update(meetings).set({ title: 'שם שנערך ידנית', updatedAt: NOW }).where(eq(meetings.id, first.meetingId!))

    // Process a second recording and attach it to the same meeting — should not override.
    await db.update(voiceRecordings).set({ meetingId: first.meetingId }).where(eq(voiceRecordings.id, recordingId))
    const rec = await processVoiceRecording(db, recordingId, {
      transcribe: async () => 'שיחה',
      analyze: async () => stubAnalysis('ניסיון לשנות שם'),
    })

    const [m] = await db.select().from(meetings).where(eq(meetings.id, rec.meetingId!))
    // The recording is not the one that created this meeting, so title stays.
    expect(m.title).toBe('שם שנערך ידנית')
  })

  it('truncates an extremely long topic to 120 chars', async () => {
    const db = getTestDb()
    const { recordingId } = await saveVoiceUpload(db, {
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm',
      durationSeconds: 60,
      consentConfirmed: true,
    })
    const longTopic = 'א'.repeat(200)
    const rec = await processVoiceRecording(db, recordingId, {
      transcribe: async () => 'שיחה',
      analyze: async () => stubAnalysis(longTopic),
    })
    const [m] = await db.select().from(meetings).where(eq(meetings.id, rec.meetingId!))
    expect(m.title.length).toBeLessThanOrEqual(120)
  })

  // -----------------------------------------------------------------------
  // Gemini context enrichment
  // -----------------------------------------------------------------------

  it('passes projectName and knownPeople profiles to analyzeTranscript', async () => {
    const db = getTestDb()
    const { recordingId } = await saveVoiceUpload(db, {
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm',
      durationSeconds: 60,
      consentConfirmed: true,
      personIds: ['p1'],
      projectId: 'prj1',
    })
    const capturedOptions: AnalyzeTranscriptOptions[] = []
    const analyze = async (opts: AnalyzeTranscriptOptions): Promise<AnalysisResult> => {
      capturedOptions.push(opts)
      return stubAnalysis()
    }
    await processVoiceRecording(db, recordingId, {
      transcribe: async () => 'דובר 1: שלום',
      analyze,
    })
    expect(capturedOptions).toHaveLength(1)
    const opts = capturedOptions[0]
    expect(opts.projectName).toBe('Helm Launch')
    expect(opts.knownPeople).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Dana Levi', role: 'VP Sales', company: 'Acme' }),
    ]))
  })

  it('passes no projectName when no project is attached', async () => {
    const db = getTestDb()
    const { recordingId } = await saveVoiceUpload(db, {
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm',
      durationSeconds: 60,
      consentConfirmed: true,
      personIds: ['p2'], // Ron has no role/company
    })
    const capturedOptions: AnalyzeTranscriptOptions[] = []
    await processVoiceRecording(db, recordingId, {
      transcribe: async () => 'דובר 1: שלום',
      analyze: async (opts) => { capturedOptions.push(opts); return stubAnalysis() },
    })
    expect(capturedOptions[0].projectName).toBeUndefined()
    // People with no role/company still appear in knownPeople list.
    expect(capturedOptions[0].knownPeople).toEqual([{ name: 'Ron Cohen' }])
  })

  // -----------------------------------------------------------------------
  // Empty personIds (review confirmed with no attendees)
  // -----------------------------------------------------------------------

  it('keeps a reviewed attendee list and does not merge calendar invitees', async () => {
    const db = getTestDb()
    await db.insert(meetings).values({
      id: 'cal_mtg',
      title: 'Weekly Sync',
      date: '2026-10-13',
      time: '10:00',
      source: 'calendar',
      projectId: 'prj1',
      createdAt: NOW,
      updatedAt: NOW,
    })
    await db.insert(meetingPeople).values([
      { meetingId: 'cal_mtg', personId: 'p1' },
      { meetingId: 'cal_mtg', personId: 'p2' },
    ])
    const { recordingId } = await saveVoiceUpload(db, {
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm',
      durationSeconds: 60,
      consentConfirmed: true,
      meetingId: 'cal_mtg',
      personIds: ['p1'],
      projectId: null,
      contextConfirmed: true,
    })
    const linked = await db.select().from(voiceRecordingPeople).where(eq(voiceRecordingPeople.recordingId, recordingId))
    expect(linked.map((r) => r.personId)).toEqual(['p1'])
    expect((await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId)))[0].projectId).toBeNull()

    const captured: AnalyzeTranscriptOptions[] = []
    await processVoiceRecording(db, recordingId, {
      transcribe: async () => 'דובר 1: שלום',
      analyze: async (opts) => { captured.push(opts); return stubAnalysis() },
    })
    expect(captured[0].knownPeople?.map((p) => p.name)).toEqual(['Dana Levi'])
    expect(captured[0].projectName).toBeUndefined()
  })

  it('old clients still inherit calendar attendees when context was not confirmed', async () => {
    const db = getTestDb()
    await db.insert(meetings).values({
      id: 'cal_mtg',
      title: 'Weekly Sync',
      date: '2026-10-13',
      time: '10:00',
      source: 'calendar',
      createdAt: NOW,
      updatedAt: NOW,
    })
    await db.insert(meetingPeople).values({ meetingId: 'cal_mtg', personId: 'p2' })
    const { recordingId } = await saveVoiceUpload(db, {
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm',
      durationSeconds: 60,
      consentConfirmed: true,
      meetingId: 'cal_mtg',
      personIds: ['p1'],
    })
    const linked = (await db.select().from(voiceRecordingPeople).where(eq(voiceRecordingPeople.recordingId, recordingId)))
      .map((r) => r.personId)
      .sort()
    expect(linked).toEqual(['p1', 'p2'])
  })

  it('accepts upload with empty personIds and creates no voice_recording_people rows', async () => {
    const db = getTestDb()
    const { recordingId } = await saveVoiceUpload(db, {
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm',
      durationSeconds: 60,
      consentConfirmed: true,
      personIds: [], // user confirmed with no attendees
    })
    const rows = await db.select().from(voiceRecordingPeople).where(eq(voiceRecordingPeople.recordingId, recordingId))
    expect(rows).toHaveLength(0)
    // Should still process successfully.
    const rec = await processVoiceRecording(db, recordingId, {
      transcribe: async () => 'שיחה',
      analyze: async () => stubAnalysis('שיחה ללא משתתפים'),
    })
    expect(rec.status).toBe('completed')
    const [m] = await db.select().from(meetings).where(eq(meetings.id, rec.meetingId!))
    expect(m.title).toBe('שיחה ללא משתתפים')
  })
})
