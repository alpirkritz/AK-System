import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { meetingAnalyses, notifications, people, voiceRecordings } from '@ak-system/database'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'
import { analyzeTranscript, type AnalysisResult } from './meeting-analysis'
import { processVoiceRecording, saveVoiceUpload } from './voice'
import { identifySpeakers, listRecordingSpeakers } from './voice-diarization'

// Only the refresh after a speaker save goes through this; processing gets its own analyzer.
vi.mock('./meeting-analysis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./meeting-analysis')>()
  return { ...actual, analyzeTranscript: vi.fn() }
})
const mockedAnalyze = vi.mocked(analyzeTranscript)

function analysis(topic = 'שיחה'): AnalysisResult {
  return {
    hatName: 'Hat', topic, mood: '', subtext: '', keyInsight: '', score: 5, scoreRationale: '',
    kaizenKeep: '', kaizenImprove: '', openQuestion: '', participants: [], actionItems: [],
  } as unknown as AnalysisResult
}

const MODEL_JSON = JSON.stringify([
  { speaker: 'דובר 1', start: 0, end: 4.5, text: 'בוקר טוב, נתחיל' },
  { speaker: 'דובר 2', start: 4.5, end: 6, text: 'בוקר' },
  { speaker: 'דובר 3', start: 6, end: 7, text: 'טוב, מה קורה?' },
  { speaker: 'דובר 1', start: 7, end: 10, text: 'אז מה המצב בפרויקט' },
])

let voiceDir = ''
beforeAll(() => {
  voiceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-voice-batch-'))
  process.env.VOICE_STORAGE_DIR = voiceDir
})
afterAll(() => {
  fs.rmSync(voiceDir, { recursive: true, force: true })
  delete process.env.VOICE_STORAGE_DIR
})

beforeEach(async () => {
  await resetDb()
  await getTestDb().delete(notifications)
  mockedAnalyze.mockReset()
  const now = new Date().toISOString()
  for (const [id, name] of [['p_yuval', 'יובל לייקין'], ['p_dana', 'דנה לוי']] as const) {
    await getTestDb().insert(people).values({ id, name, status: 'confirmed', source: 'manual', createdAt: now })
  }
})

/** A processed three-speaker recording with an analysis and a meeting, nobody identified. */
async function recording(): Promise<string> {
  const db = getTestDb()
  const { recordingId } = await saveVoiceUpload(db, {
    audio: Buffer.from('x'),
    mimeType: 'audio/webm',
    durationSeconds: 600,
    consentConfirmed: true,
  })
  await processVoiceRecording(db, recordingId, { transcribe: async () => MODEL_JSON, analyze: async () => analysis('לפני') })
  return recordingId
}

describe('identifySpeakers (service)', () => {
  it('saves every answer, keeps the last one for a repeated label and ignores labels the recording does not have', async () => {
    const db = getTestDb()
    const recordingId = await recording()

    const saved = await identifySpeakers(db, {
      recordingId,
      answers: [
        { speakerLabel: 'דובר 1', personId: 'p_dana' },
        { speakerLabel: 'דובר 1', personId: 'p_yuval' },
        { speakerLabel: 'דובר 3', personId: null },
        { speakerLabel: 'דובר 9', personId: 'p_dana' },
      ],
    })

    expect(saved).toEqual([
      { speakerLabel: 'דובר 1', state: 'identified' },
      { speakerLabel: 'דובר 3', state: 'skipped' },
    ])
    const byLabel = Object.fromEntries((await listRecordingSpeakers(db, recordingId)).map((s) => [s.speakerLabel, s]))
    expect(byLabel['דובר 1']).toMatchObject({ state: 'identified', personId: 'p_yuval' })
    expect(byLabel['דובר 2']).toMatchObject({ state: 'unknown' })
    expect(byLabel['דובר 3']).toMatchObject({ state: 'skipped', personId: null })
  })
})

describe('voice.identifySpeakers (router)', () => {
  it('re-runs the analysis once with the names given, even with a speaker left unknown', async () => {
    const caller = await createTestCaller()
    const recordingId = await recording()
    mockedAnalyze.mockResolvedValue(analysis('אחרי'))

    const result = await caller.voice.identifySpeakers({
      recordingId,
      answers: [
        { speakerLabel: 'דובר 1', personId: 'p_yuval' },
        { speakerLabel: 'דובר 2', personId: 'p_dana' },
      ],
    })

    expect(result).toEqual({
      saved: [
        { speakerLabel: 'דובר 1', state: 'identified' },
        { speakerLabel: 'דובר 2', state: 'identified' },
      ],
      analysisRefreshed: true,
      analysisError: null,
    })
    expect(mockedAnalyze).toHaveBeenCalledTimes(1)
    const text = mockedAnalyze.mock.calls[0]![0].transcriptText
    expect(text).toContain('יובל לייקין: בוקר טוב, נתחיל')
    expect(text).toContain('דנה לוי: בוקר')
    expect(text).toContain('דובר 3: טוב, מה קורה?')

    const db = getTestDb()
    const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    const [stored] = await db.select().from(meetingAnalyses).where(eq(meetingAnalyses.id, rec!.analysisId!))
    expect(stored!.topic).toBe('אחרי')
  })

  it('does not call the model when the answers change no name in the transcript', async () => {
    const caller = await createTestCaller()
    const recordingId = await recording()

    const result = await caller.voice.identifySpeakers({ recordingId, answers: [{ speakerLabel: 'דובר 3', personId: null }] })

    expect(result.analysisRefreshed).toBe(false)
    expect(mockedAnalyze).not.toHaveBeenCalled()
  })

  it('keeps the answers and reports the failure when the analysis fails', async () => {
    const caller = await createTestCaller()
    const recordingId = await recording()
    mockedAnalyze.mockRejectedValue(new Error('503 Service Unavailable'))

    const result = await caller.voice.identifySpeakers({ recordingId, answers: [{ speakerLabel: 'דובר 1', personId: 'p_yuval' }] })

    expect(result).toMatchObject({ analysisRefreshed: false, analysisError: '503 Service Unavailable' })
    const speakers = await listRecordingSpeakers(getTestDb(), recordingId)
    expect(speakers.find((s) => s.speakerLabel === 'דובר 1')).toMatchObject({ state: 'identified', personId: 'p_yuval' })
    const [rec] = await getTestDb().select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    const [stored] = await getTestDb().select().from(meetingAnalyses).where(eq(meetingAnalyses.id, rec!.analysisId!))
    expect(stored!.topic).toBe('לפני')
  })
})
