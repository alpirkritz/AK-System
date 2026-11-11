import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import {
  meetingAnalyses,
  notifications,
  people,
  voicePrints,
  voiceRecordingPeople,
  voiceRecordings,
  voiceSpeakerIdentities,
  voiceTranscriptSegments,
} from '@ak-system/database'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'
import {
  parseTranscription,
  processVoiceRecording,
  refreshVoiceAnalysisAfterSpeakerResolution,
  saveVoiceUpload,
  type TranscriptResult,
} from './voice'
import {
  attributedTranscript,
  autoIdentifyTwoPersonConversation,
  identifySpeaker,
  listRecordingSpeakers,
  notifyUnknownSpeakers,
  resolveSelfSpeakerLabel,
} from './voice-diarization'
import type { AnalysisResult } from './meeting-analysis'
import { ensureSelfPerson } from './self-person'

let voiceDir = ''

beforeAll(() => {
  voiceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-voice-speakers-'))
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

const MODEL_JSON = JSON.stringify([
  { speaker: 'דובר 1', start: 0, end: 4.5, text: 'בוקר טוב, נתחיל' },
  { speaker: 'דובר 2', start: 4.5, end: 6, text: 'בוקר' },
  { speaker: 'דובר 1', start: 6, end: 9, text: 'אז מה המצב בפרויקט' },
])

async function upload(): Promise<string> {
  const { recordingId } = await saveVoiceUpload(getTestDb(), {
    audio: Buffer.from('x'),
    mimeType: 'audio/webm',
    durationSeconds: 600,
    consentConfirmed: true,
  })
  return recordingId
}

const runProcessing = (recordingId: string, transcribe: () => Promise<string | TranscriptResult>) =>
  processVoiceRecording(getTestDb(), recordingId, { transcribe, analyze: async () => analysis() })

beforeEach(async () => {
  await resetDb()
  await getTestDb().delete(notifications)
})

describe('parseTranscription', () => {
  it('turns the model JSON into timed segments and a plain speaker-labelled transcript', () => {
    const result = parseTranscription(MODEL_JSON)
    expect(result.segments).toEqual([
      { speakerLabel: 'דובר 1', startMs: 0, endMs: 4500, text: 'בוקר טוב, נתחיל' },
      { speakerLabel: 'דובר 2', startMs: 4500, endMs: 6000, text: 'בוקר' },
      { speakerLabel: 'דובר 1', startMs: 6000, endMs: 9000, text: 'אז מה המצב בפרויקט' },
    ])
    expect(result.text).toBe('דובר 1: בוקר טוב, נתחיל\nדובר 2: בוקר\nדובר 1: אז מה המצב בפרויקט')
  })

  it('accepts a markdown-fenced response, a { segments } wrapper and mm:ss timecodes', () => {
    const raw = '```json\n' + JSON.stringify({ segments: [{ speaker: 'דובר 1', start: '00:10', end: '1:00.5', text: 'כן' }] }) + '\n```'
    expect(parseTranscription(raw).segments).toEqual([
      { speakerLabel: 'דובר 1', startMs: 10_000, endMs: 60_500, text: 'כן' },
    ])
  })

  it('keeps a plain-text answer as the transcript with no segments', () => {
    expect(parseTranscription('דובר 1: שלום\nדובר 2: היי')).toEqual({
      text: 'דובר 1: שלום\nדובר 2: היי',
      segments: [],
    })
  })

  it('keeps the words of a turn the model timed badly, and never leaves raw JSON as the transcript', () => {
    const raw = JSON.stringify([
      { speaker: 'דובר 1', start: 5, end: 5, text: 'אפס אורך' },
      { speaker: 'דובר 2', start: 'מתישהו', end: 9, text: 'בלי זמן' },
      { speaker: '', start: 1, end: 2, text: 'בלי תווית' },
    ])
    // Timings only drive the voice sample; the transcript is what the user reads.
    expect(parseTranscription(raw)).toEqual({
      text: 'דובר 1: אפס אורך\nדובר 2: בלי זמן',
      segments: [],
    })
  })

  it('keeps a well-timed turn as a segment while still transcribing its badly-timed neighbour', () => {
    const raw = JSON.stringify([
      { speaker: 'דובר 1', start: 0, end: 2, text: 'תקין' },
      { speaker: 'דובר 2', start: 9, end: 9, text: 'פסול' },
    ])
    expect(parseTranscription(raw)).toEqual({
      text: 'דובר 1: תקין\nדובר 2: פסול',
      segments: [{ speakerLabel: 'דובר 1', startMs: 0, endMs: 2000, text: 'תקין' }],
    })
  })
})

describe('processVoiceRecording with timed segments', () => {
  it('stores the segments and keeps transcript_text in the plain speaker-line format', async () => {
    const db = getTestDb()
    const recordingId = await upload()
    await runProcessing(recordingId, async () => MODEL_JSON)

    const segments = await db.select().from(voiceTranscriptSegments).where(eq(voiceTranscriptSegments.recordingId, recordingId))
    expect(segments).toHaveLength(3)
    const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    expect(rec.status).toBe('completed')
    expect(rec.transcriptText).toBe('דובר 1: בוקר טוב, נתחיל\nדובר 2: בוקר\nדובר 1: אז מה המצב בפרויקט')
  })

  it('completes with no segments and asks nothing when the model returns no timings', async () => {
    const db = getTestDb()
    const recordingId = await upload()
    await runProcessing(recordingId, async () => 'דובר 1: שלום')

    const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    expect(rec.status).toBe('completed')
    expect(rec.transcriptText).toBe('דובר 1: שלום')
    expect(rec.speakerPromptSentAt).toBeNull()
    expect(await db.select().from(voiceTranscriptSegments)).toHaveLength(0)
    expect(await listRecordingSpeakers(db, recordingId)).toEqual([])
  })

  it('notifies once about unidentified speakers, and not again on a re-run', async () => {
    const db = getTestDb()
    const recordingId = await upload()
    await runProcessing(recordingId, async () => MODEL_JSON)

    const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    expect(rec.speakerPromptSentAt).toBeTruthy()
    expect(await db.select().from(notifications)).toHaveLength(1)

    expect(await notifyUnknownSpeakers(db, recordingId)).toBe(false)
    expect(await db.select().from(notifications)).toHaveLength(1)
  })
})

describe('listRecordingSpeakers', () => {
  /** A processed recording with two speakers, none of them identified yet. */
  async function recording(): Promise<string> {
    const recordingId = await upload()
    await runProcessing(recordingId, async () => MODEL_JSON)
    return recordingId
  }

  async function addPerson(id: string, name = 'דנה לוי') {
    await getTestDb().insert(people).values({ id, name, status: 'confirmed', source: 'manual', createdAt: new Date().toISOString() })
  }

  it('offers the longest turn of each speaker as the sample', async () => {
    const speakers = await listRecordingSpeakers(getTestDb(), await recording())
    expect(speakers).toEqual([
      {
        speakerLabel: 'דובר 1',
        state: 'unknown',
        personId: null,
        personName: null,
        sampleStartMs: 0,
        sampleEndMs: 4500,
        sampleText: 'בוקר טוב, נתחיל',
        segmentCount: 2,
      },
      {
        speakerLabel: 'דובר 2',
        state: 'unknown',
        personId: null,
        personName: null,
        sampleStartMs: 4500,
        sampleEndMs: 6000,
        sampleText: 'בוקר',
        segmentCount: 1,
      },
    ])
  })

  it('an identified speaker links the person to the recording and stops being asked about', async () => {
    const db = getTestDb()
    const recordingId = await recording()
    await addPerson('p1')

    expect(await identifySpeaker(db, { recordingId, speakerLabel: 'דובר 2', personId: 'p1' })).toEqual({ state: 'identified' })

    const speakers = await listRecordingSpeakers(db, recordingId)
    expect(speakers.find((s) => s.speakerLabel === 'דובר 2')).toMatchObject({ state: 'identified', personId: 'p1' })
    const links = await db
      .select()
      .from(voiceRecordingPeople)
      .where(and(eq(voiceRecordingPeople.recordingId, recordingId), eq(voiceRecordingPeople.personId, 'p1')))
    expect(links).toHaveLength(1)
  })

  it('a skipped speaker is remembered and never asked about again', async () => {
    const db = getTestDb()
    const recordingId = await recording()
    expect(await identifySpeaker(db, { recordingId, speakerLabel: 'דובר 1', personId: null })).toEqual({ state: 'skipped' })

    const speakers = await listRecordingSpeakers(db, recordingId)
    expect(speakers.find((s) => s.speakerLabel === 'דובר 1')).toMatchObject({ state: 'skipped', personId: null })
    expect(await db.select().from(voiceRecordingPeople).where(eq(voiceRecordingPeople.recordingId, recordingId))).toHaveLength(0)
  })

  it('answering the same speaker twice replaces the previous answer', async () => {
    const db = getTestDb()
    const recordingId = await recording()
    await addPerson('p1')
    await identifySpeaker(db, { recordingId, speakerLabel: 'דובר 1', personId: null })
    await identifySpeaker(db, { recordingId, speakerLabel: 'דובר 1', personId: 'p1' })

    const rows = await db.select().from(voiceSpeakerIdentities).where(eq(voiceSpeakerIdentities.recordingId, recordingId))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ state: 'identified', personId: 'p1' })
  })

  it('treats an unknown person id as a skip', async () => {
    const db = getTestDb()
    const recordingId = await recording()
    expect(await identifySpeaker(db, { recordingId, speakerLabel: 'דובר 1', personId: 'ghost' })).toEqual({ state: 'skipped' })
  })

  it('is reachable through the voice router', async () => {
    const caller = await createTestCaller()
    const recordingId = await recording()
    expect((await caller.voice.speakers({ recordingId })).map((s) => s.speakerLabel)).toEqual(['דובר 1', 'דובר 2'])
    expect(await caller.voice.identifySpeaker({ recordingId, speakerLabel: 'דובר 2', personId: null })).toEqual({
      state: 'skipped',
      analysisRefreshed: false,
    })
    expect((await caller.voice.speakers({ recordingId })).find((s) => s.speakerLabel === 'דובר 2')?.state).toBe('skipped')
  })
})

describe('safe two-person attribution', () => {
  async function recording(): Promise<string> {
    const recordingId = await upload()
    await runProcessing(recordingId, async () => MODEL_JSON)
    return recordingId
  }

  async function seedSelfAndOther(recordingId: string) {
    const db = getTestDb()
    const owner = await ensureSelfPerson(db)
    const now = new Date().toISOString()
    await db.insert(voicePrints).values({
      id: 'vp_owner',
      personId: owner.id,
      embedding: '[]',
      model: 'test',
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(voiceSpeakerIdentities).values({
      id: 'vsi_owner',
      recordingId,
      speakerLabel: 'דובר 1',
      personId: owner.id,
      state: 'auto',
      createdAt: now,
    })
    await db.insert(people).values({
      id: 'p_dana',
      name: 'דנה לוי',
      status: 'confirmed',
      source: 'manual',
      createdAt: now,
    })
    await db.insert(voiceRecordingPeople).values({ recordingId, personId: 'p_dana' })
    return owner
  }

  it('auto-identifies the only other confirmed person and exposes the mapped name', async () => {
    const db = getTestDb()
    const recordingId = await recording()
    const owner = await seedSelfAndOther(recordingId)

    expect(await autoIdentifyTwoPersonConversation(db, recordingId)).toBe(true)
    expect(await autoIdentifyTwoPersonConversation(db, recordingId)).toBe(false)

    const speakers = await listRecordingSpeakers(db, recordingId)
    expect(speakers.find((speaker) => speaker.speakerLabel === 'דובר 1')).toMatchObject({
      state: 'auto',
      personId: owner.id,
      personName: owner.name,
    })
    expect(speakers.find((speaker) => speaker.speakerLabel === 'דובר 2')).toMatchObject({
      state: 'auto',
      personId: 'p_dana',
      personName: 'דנה לוי',
    })

    const attributed = await attributedTranscript(
      db,
      recordingId,
      'דובר 1: בוקר טוב, נתחיל\nדובר 2: בוקר\nדובר 1: אז מה המצב בפרויקט',
    )
    expect(attributed.allResolved).toBe(true)
    expect(attributed.text).toBe(`${owner.name}: בוקר טוב, נתחיל\nדנה לוי: בוקר\n${owner.name}: אז מה המצב בפרויקט`)
  })

  it('refuses to guess when more than one external participant is linked', async () => {
    const db = getTestDb()
    const recordingId = await recording()
    await seedSelfAndOther(recordingId)
    await db.insert(people).values({
      id: 'p_ron',
      name: 'רון כהן',
      status: 'confirmed',
      source: 'manual',
      createdAt: new Date().toISOString(),
    })
    await db.insert(voiceRecordingPeople).values({ recordingId, personId: 'p_ron' })

    expect(await autoIdentifyTwoPersonConversation(db, recordingId)).toBe(false)
    expect((await listRecordingSpeakers(db, recordingId)).find((speaker) => speaker.speakerLabel === 'דובר 2')).toMatchObject({
      state: 'unknown',
      personId: null,
    })
  })

  it('refreshes the existing analysis from attributed text without changing the stored transcript', async () => {
    const db = getTestDb()
    const recordingId = await recording()
    await seedSelfAndOther(recordingId)
    await autoIdentifyTwoPersonConversation(db, recordingId)
    let analyzedText = ''

    const refreshed = await refreshVoiceAnalysisAfterSpeakerResolution(db, recordingId, {
      analyze: async (options) => {
        analyzedText = options.transcriptText
        return {
          ...analysis(),
          topic: 'שיחה מיוחסת',
          keyInsight: 'דנה אישרה את לוח הזמנים',
          actionItems: [{ content: 'לשלוח לוח זמנים', owner: 'דנה לוי' }],
        }
      },
    })

    expect(refreshed).toBe(true)
    expect(analyzedText).toContain('דנה לוי: בוקר')
    expect(analyzedText).not.toContain('דובר 2: בוקר')
    const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    expect(rec.transcriptText).toContain('דובר 2: בוקר')
    const [stored] = await db.select().from(meetingAnalyses).where(eq(meetingAnalyses.id, rec.analysisId!))
    expect(stored.transcriptText).toContain('דנה לוי: בוקר')
    expect(stored.topic).toBe('שיחה מיוחסת')
    // The owner is a person on the recording, so the item is linked to her People record.
    expect(JSON.parse(stored.actionItemsJson!)).toEqual([{ content: 'לשלוח לוח זמנים', owner: 'דנה לוי', personId: 'p_dana' }])
  })

  it('does not refresh while any speaker is still unknown', async () => {
    const recordingId = await recording()
    let called = false
    expect(
      await refreshVoiceAnalysisAfterSpeakerResolution(getTestDb(), recordingId, {
        analyze: async () => {
          called = true
          return analysis()
        },
      }),
    ).toBe(false)
    expect(called).toBe(false)
  })
})

describe('resolveSelfSpeakerLabel', () => {
  const turns = [
    { speakerLabel: 'דובר 1', startMs: 0, endMs: 4000 },
    { speakerLabel: 'דובר 2', startMs: 4000, endMs: 8000 },
    { speakerLabel: 'דובר 1', startMs: 8000, endMs: 12_000 },
  ]

  it('picks the label whose turns the enrolled voice covers', () => {
    expect(resolveSelfSpeakerLabel(turns, [{ startMs: 0, endMs: 4000 }, { startMs: 8000, endMs: 12_000 }])).toBe('דובר 1')
  })

  it('returns null when no label is covered well enough, or there is nothing to align', () => {
    expect(resolveSelfSpeakerLabel(turns, [{ startMs: 0, endMs: 500 }])).toBeNull()
    expect(resolveSelfSpeakerLabel(turns, [])).toBeNull()
    expect(resolveSelfSpeakerLabel([], [{ startMs: 0, endMs: 4000 }])).toBeNull()
  })
})
