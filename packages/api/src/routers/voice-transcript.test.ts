import { beforeEach, describe, expect, it } from 'vitest'
import {
  meetings,
  people,
  voiceRecordings,
  voiceSpeakerIdentities,
  voiceTranscriptSegments,
} from '@ak-system/database'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'

// docs/specs/meeting-full-transcript-view.md
const NOW = new Date().toISOString()

async function seedRecording(id: string, extra: Partial<typeof voiceRecordings.$inferInsert> = {}) {
  await getTestDb().insert(voiceRecordings).values({
    id,
    audioPath: `/tmp/${id}.webm`,
    mimeType: 'audio/webm',
    sizeBytes: 10,
    duration: 60,
    status: 'completed',
    consentConfirmedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  })
}

async function seedSegments(recordingId: string, rows: { label: string; startMs: number; endMs: number; text: string }[]) {
  await getTestDb().insert(voiceTranscriptSegments).values(
    rows.map((r, i) => ({
      id: `${recordingId}_${i}`,
      recordingId,
      speakerLabel: r.label,
      startMs: r.startMs,
      endMs: r.endMs,
      text: r.text,
      createdAt: NOW,
    })),
  )
}

describe('voice.transcript', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('returns segments ordered by start time with the stored fallback text', async () => {
    await seedRecording('r1', { transcriptText: 'דובר 1: שלום\nדובר 2: היי' })
    await seedSegments('r1', [
      { label: 'דובר 2', startMs: 2000, endMs: 3000, text: 'היי' },
      { label: 'דובר 1', startMs: 0, endMs: 1500, text: 'שלום' },
    ])
    const caller = await createTestCaller()
    const t = await caller.voice.transcript({ recordingId: 'r1' })
    expect(t.status).toBe('completed')
    expect(t.text).toBe('דובר 1: שלום\nדובר 2: היי')
    expect(t.segments.map((s) => [s.speakerKey, s.text])).toEqual([
      ['דובר 1', 'שלום'],
      ['דובר 2', 'היי'],
    ])
    expect(t.segments.every((s) => s.speakerName === null)).toBe(true)
  })

  it('resolves identified speakers to the person name, but keeps skipped speakers anonymous', async () => {
    await getTestDb().insert(people).values([
      { id: 'p1', name: 'ליאור מוזס', email: null, status: 'confirmed', source: 'manual', createdAt: NOW },
    ])
    await seedRecording('r1', { transcriptText: 'x' })
    await seedSegments('r1', [
      { label: 'דובר 1', startMs: 0, endMs: 1000, text: 'א' },
      { label: 'דובר 2', startMs: 1000, endMs: 2000, text: 'ב' },
    ])
    await getTestDb().insert(voiceSpeakerIdentities).values([
      { id: 'i1', recordingId: 'r1', speakerLabel: 'דובר 1', personId: 'p1', state: 'identified', createdAt: NOW },
      { id: 'i2', recordingId: 'r1', speakerLabel: 'דובר 2', personId: 'p1', state: 'skipped', createdAt: NOW },
    ])
    const caller = await createTestCaller()
    const t = await caller.voice.transcript({ recordingId: 'r1' })
    expect(t.segments.map((s) => s.speakerName)).toEqual(['ליאור מוזס', null])
  })

  it('still returns the plain transcript when diarization failed and there are no segments', async () => {
    await seedRecording('r1', {
      transcriptText: 'דובר 1: שלום',
      diarizationStatus: 'failed',
      diarizationError: 'Maximum call stack size exceeded',
    })
    const caller = await createTestCaller()
    const t = await caller.voice.transcript({ recordingId: 'r1' })
    expect(t.segments).toEqual([])
    expect(t.text).toBe('דובר 1: שלום')
    expect(t.diarizationStatus).toBe('failed')
  })

  it('exposes processing and failed state so the UI can explain an empty transcript', async () => {
    await seedRecording('proc', { status: 'processing', transcriptText: null })
    await seedRecording('bad', { status: 'failed', error: 'boom', transcriptText: null })
    const caller = await createTestCaller()
    expect((await caller.voice.transcript({ recordingId: 'proc' })).status).toBe('processing')
    const failed = await caller.voice.transcript({ recordingId: 'bad' })
    expect(failed.status).toBe('failed')
    expect(failed.error).toBe('boom')
  })

  it('throws NOT_FOUND for an unknown recording', async () => {
    const caller = await createTestCaller()
    await expect(caller.voice.transcript({ recordingId: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('voice.recordingsForMeeting', () => {
  beforeEach(async () => {
    await resetDb()
    await getTestDb().insert(meetings).values({
      id: 'mtg', title: 'התייעצות', date: '2026-11-16', time: '18:00', source: 'manual', createdAt: NOW, updatedAt: NOW,
    })
  })

  it('matches both attached (meeting_id) and created (created_meeting_id) recordings, newest first', async () => {
    await seedRecording('attached', { meetingId: 'mtg', createdAt: '2026-11-16T10:00:00.000Z' })
    await seedRecording('created', { createdMeetingId: 'mtg', createdAt: '2026-11-16T12:00:00.000Z' })
    await seedRecording('other', { createdAt: '2026-11-16T13:00:00.000Z' })
    const caller = await createTestCaller()
    const list = await caller.voice.recordingsForMeeting({ meetingId: 'mtg' })
    expect(list.map((r) => r.id)).toEqual(['created', 'attached'])
  })

  it('returns an empty list for a meeting without recordings', async () => {
    const caller = await createTestCaller()
    expect(await caller.voice.recordingsForMeeting({ meetingId: 'mtg' })).toEqual([])
  })
})
