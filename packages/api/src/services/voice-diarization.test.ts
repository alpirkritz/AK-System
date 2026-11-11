import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { voiceRecordingPeople, voiceRecordings } from '@ak-system/database'
import { getTestDb, resetDb } from '../test-utils'
import {
  deleteVoicePrint,
  enrollVoicePrint,
  getVoicePrintStatus,
  listRecordingSpeakers,
  matchSelfVoice,
  notifyUnknownSpeakers,
  runSelfVoiceDetection,
  SELF_MATCH_THRESHOLD,
} from './voice-diarization'
import { saveTranscriptSegments } from './voice'

let fixturesDir = ''
let storageDir = ''

function synthesize(outPath: string, parts: string[]) {
  const inputs = parts.flatMap((p) => ['-f', 'lavfi', '-i', p])
  const n = parts.length
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    ...inputs,
    '-filter_complex', `${parts.map((_, i) => `[${i}:a]`).join('')}concat=n=${n}:v=0:a=1[out]`,
    '-map', '[out]',
    '-ar', '16000', '-ac', '1',
    outPath,
  ])
}

beforeAll(() => {
  fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-voice-diarization-fixtures-'))
  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-voice-diarization-storage-'))
  // Enrollment sample: a continuous "voice" (a steady tone stands in for one speaker's timbre).
  synthesize(path.join(fixturesDir, 'enroll.wav'), ['sine=frequency=220:duration=3:sample_rate=16000'])
  // A "recording" containing the same voice (with a silence gap, like real speech pauses).
  synthesize(path.join(fixturesDir, 'matching-recording.wav'), [
    'sine=frequency=220:duration=2.5:sample_rate=16000',
    'anullsrc=r=16000:cl=mono:d=1',
    'sine=frequency=220:duration=2.5:sample_rate=16000',
  ])
  // A recording with a clearly different voice only.
  synthesize(path.join(fixturesDir, 'non-matching-recording.wav'), [
    'sine=frequency=1600:duration=2.5:sample_rate=16000',
    'anullsrc=r=16000:cl=mono:d=1',
    'sine=frequency=1600:duration=2.5:sample_rate=16000',
  ])
})

afterAll(() => {
  fs.rmSync(fixturesDir, { recursive: true, force: true })
  fs.rmSync(storageDir, { recursive: true, force: true })
})

beforeEach(async () => {
  await resetDb()
})

async function insertRecording(audioPath: string): Promise<string> {
  const db = getTestDb()
  const id = `vr_test_${Math.random().toString(36).slice(2, 8)}`
  const now = new Date().toISOString()
  await db.insert(voiceRecordings).values({
    id,
    audioPath,
    mimeType: 'audio/wav',
    // The missing-file case deliberately passes a path that does not exist.
    sizeBytes: fs.existsSync(audioPath) ? fs.statSync(audioPath).size : 0,
    duration: 6,
    status: 'uploaded',
    consentConfirmedAt: now,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

describe('voice print enrollment', () => {
  it('starts unenrolled, and reflects enrollment/deletion', async () => {
    const db = getTestDb()
    expect((await getVoicePrintStatus(db)).enrolled).toBe(false)

    await enrollVoicePrint(db, { audio: fs.readFileSync(path.join(fixturesDir, 'enroll.wav')), mimeType: 'audio/wav' }, storageDir)
    expect((await getVoicePrintStatus(db)).enrolled).toBe(true)

    await deleteVoicePrint(db)
    expect((await getVoicePrintStatus(db)).enrolled).toBe(false)
  })

  it('re-enrolling replaces the single stored voiceprint rather than adding a second row', async () => {
    const db = getTestDb()
    const sample = fs.readFileSync(path.join(fixturesDir, 'enroll.wav'))
    const first = await enrollVoicePrint(db, { audio: sample, mimeType: 'audio/wav' }, storageDir)
    const second = await enrollVoicePrint(db, { audio: sample, mimeType: 'audio/wav' }, storageDir)
    expect(second.id).toBe(first.id)
  })
})

describe('matchSelfVoice', () => {
  it('reports no match when nothing is enrolled', async () => {
    const db = getTestDb()
    const result = await matchSelfVoice(db, path.join(fixturesDir, 'matching-recording.wav'))
    expect(result.selfDetected).toBe(false)
  })

  it('detects the enrolled voice in a recording that contains it', async () => {
    const db = getTestDb()
    await enrollVoicePrint(db, { audio: fs.readFileSync(path.join(fixturesDir, 'enroll.wav')), mimeType: 'audio/wav' }, storageDir)
    const result = await matchSelfVoice(db, path.join(fixturesDir, 'matching-recording.wav'))
    expect(result.selfDetected).toBe(true)
    expect(result.confidence).not.toBeNull()
    expect(result.confidence!).toBeGreaterThanOrEqual(SELF_MATCH_THRESHOLD)
    expect(result.selfSpeechMs).toBeGreaterThan(0)
  })

  it('does not detect the enrolled voice in a recording of a different voice', async () => {
    const db = getTestDb()
    await enrollVoicePrint(db, { audio: fs.readFileSync(path.join(fixturesDir, 'enroll.wav')), mimeType: 'audio/wav' }, storageDir)
    const result = await matchSelfVoice(db, path.join(fixturesDir, 'non-matching-recording.wav'))
    expect(result.selfDetected).toBe(false)
  })
})

describe('runSelfVoiceDetection (pipeline integration)', () => {
  it('auto-tags the enrolled person on a matching recording, marking the match as automatic', async () => {
    const db = getTestDb()
    await enrollVoicePrint(db, { audio: fs.readFileSync(path.join(fixturesDir, 'enroll.wav')), mimeType: 'audio/wav' }, storageDir)
    const recordingId = await insertRecording(path.join(fixturesDir, 'matching-recording.wav'))

    await runSelfVoiceDetection(db, recordingId)

    const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    expect(rec.diarizationStatus).toBe('completed')
    expect(rec.diarizationError).toBeNull()

    const links = await db.select().from(voiceRecordingPeople).where(eq(voiceRecordingPeople.recordingId, recordingId))
    expect(links).toHaveLength(1)
    expect(links[0].matchedAutomatically).toBe(true)
    expect(links[0].confidence).not.toBeNull()
  })

  it('leaves the recording untagged when the voice does not match, but still marks diarization completed', async () => {
    const db = getTestDb()
    await enrollVoicePrint(db, { audio: fs.readFileSync(path.join(fixturesDir, 'enroll.wav')), mimeType: 'audio/wav' }, storageDir)
    const recordingId = await insertRecording(path.join(fixturesDir, 'non-matching-recording.wav'))

    await runSelfVoiceDetection(db, recordingId)

    const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    expect(rec.diarizationStatus).toBe('completed')
    const links = await db.select().from(voiceRecordingPeople).where(eq(voiceRecordingPeople.recordingId, recordingId))
    expect(links).toHaveLength(0)
  })

  it('marks the transcript label of the enrolled voice as auto, so it is never asked about', async () => {
    const db = getTestDb()
    await enrollVoicePrint(db, { audio: fs.readFileSync(path.join(fixturesDir, 'enroll.wav')), mimeType: 'audio/wav' }, storageDir)
    const recordingId = await insertRecording(path.join(fixturesDir, 'matching-recording.wav'))
    await saveTranscriptSegments(db, recordingId, [
      { speakerLabel: 'דובר 1', startMs: 0, endMs: 6000, text: 'כל ההקלטה' },
      { speakerLabel: 'דובר 2', startMs: 6000, endMs: 9000, text: 'מישהו אחר' },
    ])

    await runSelfVoiceDetection(db, recordingId)

    const speakers = await listRecordingSpeakers(db, recordingId)
    expect(speakers.find((s) => s.speakerLabel === 'דובר 1')).toMatchObject({ state: 'auto' })
    expect(speakers.find((s) => s.speakerLabel === 'דובר 2')).toMatchObject({ state: 'unknown' })
    expect(await notifyUnknownSpeakers(db, recordingId)).toBe(true)
  })

  it('never throws and marks the recording failed when the audio file does not exist', async () => {
    const db = getTestDb()
    // Needs an enrolled voiceprint: without one the matcher returns before it ever opens the
    // file, so a missing path is a no-op rather than a failure.
    await enrollVoicePrint(db, { audio: fs.readFileSync(path.join(fixturesDir, 'enroll.wav')), mimeType: 'audio/wav' }, storageDir)
    const recordingId = await insertRecording('/nonexistent/path/does-not-exist.wav')
    await expect(runSelfVoiceDetection(db, recordingId)).resolves.toBeUndefined()
    const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    expect(rec.diarizationStatus).toBe('failed')
    expect(rec.diarizationError).toBeTruthy()
  })
})
