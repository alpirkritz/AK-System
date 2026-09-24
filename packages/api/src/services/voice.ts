/**
 * Consented voice recordings: stored on disk next to the database, transcribed by Gemini, and
 * analyzed into a meeting (the one it belongs to, or a placeholder `source='voice'` meeting).
 */
import * as fs from 'fs'
import * as path from 'path'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import {
  commitments,
  getDbPath,
  meetingAnalyses,
  meetingPeople,
  meetings,
  people,
  voiceRecordingPeople,
  voiceRecordings,
  type VoiceRecording,
  type getDb,
} from '@ak-system/database'
import { analyzeTranscript, type AnalysisResult, type AnalyzeTranscriptOptions } from './meeting-analysis'
import { proposeCommitmentsFromAnalysis } from './commitments'

type Db = ReturnType<typeof getDb>

/** Gemini inline audio limit is 20 MB per request, leaving room for the prompt. */
export const VOICE_MAX_BYTES = 19 * 1024 * 1024
export const VOICE_MIN_SECONDS = 10
export const VOICE_PLACEHOLDER_TITLE = 'שיחה מוקלטת'
const ATTACH_WINDOW_MIN = 15

const EXT_BY_MIME: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
}

export function voiceStorageDir(): string {
  return process.env.VOICE_STORAGE_DIR || path.join(path.dirname(getDbPath()), 'voice')
}

export class VoiceUploadError extends Error {}

function timezone(): string {
  return process.env.TIMEZONE || 'Asia/Jerusalem'
}

/** Local `YYYY-MM-DD` and `HH:MM` for an instant, in the system timezone. */
export function localDateTime(ms: number): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  const hour = get('hour') === '24' ? '00' : get('hour')
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${hour}:${get('minute')}` }
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function existingPersonIds(db: Db, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return []
  return (await db.select({ id: people.id }).from(people).where(inArray(people.id, unique))).map((p) => p.id)
}

async function linkMeetingPeople(db: Db, meetingId: string, personIds: string[]) {
  if (personIds.length === 0) return
  const linked = new Set(
    (await db.select({ personId: meetingPeople.personId }).from(meetingPeople).where(eq(meetingPeople.meetingId, meetingId))).map((r) => r.personId),
  )
  for (const personId of personIds) if (!linked.has(personId)) await db.insert(meetingPeople).values({ meetingId, personId })
}

export interface VoiceUploadInput {
  audio: Buffer
  mimeType: string
  durationSeconds: number
  consentConfirmed: boolean
  personIds?: string[]
  meetingId?: string | null
  now?: number
}

export async function saveVoiceUpload(db: Db, input: VoiceUploadInput): Promise<{ recordingId: string }> {
  if (!input.consentConfirmed) throw new VoiceUploadError('נדרש אישור שכל המשתתפים הסכימו להקלטה')
  if (input.audio.length === 0) throw new VoiceUploadError('קובץ ההקלטה ריק')
  if (input.audio.length > VOICE_MAX_BYTES) throw new VoiceUploadError('ההקלטה גדולה מדי (עד 19MB, כ-40 דקות)')
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds < VOICE_MIN_SECONDS) {
    throw new VoiceUploadError('ההקלטה קצרה מדי (לפחות 10 שניות)')
  }
  const mimeType = input.mimeType.split(';')[0].trim().toLowerCase() || 'audio/webm'
  const ext = EXT_BY_MIME[mimeType]
  if (!ext) throw new VoiceUploadError(`סוג קובץ לא נתמך: ${mimeType}`)

  let meetingId: string | null = null
  if (input.meetingId) {
    const [m] = await db.select({ id: meetings.id }).from(meetings).where(eq(meetings.id, input.meetingId))
    if (!m) throw new VoiceUploadError('הפגישה לא נמצאה')
    meetingId = m.id
  }

  const id = newId('vr')
  const dir = voiceStorageDir()
  fs.mkdirSync(dir, { recursive: true })
  const audioPath = path.join(dir, `${id}.${ext}`)
  fs.writeFileSync(audioPath, input.audio)

  const at = new Date(input.now ?? Date.now()).toISOString()
  await db.insert(voiceRecordings).values({
    id,
    audioPath,
    mimeType,
    sizeBytes: input.audio.length,
    transcriptText: null,
    analysisId: null,
    meetingId,
    createdMeetingId: null,
    duration: Math.round(input.durationSeconds),
    status: 'uploaded',
    error: null,
    consentConfirmedAt: at,
    createdAt: at,
    updatedAt: at,
  })
  for (const personId of await existingPersonIds(db, input.personIds ?? [])) {
    await db.insert(voiceRecordingPeople).values({ recordingId: id, personId })
  }
  return { recordingId: id }
}

export type VoiceTranscriber = (audio: Buffer, mimeType: string) => Promise<string>
export type VoiceAnalyzer = (options: AnalyzeTranscriptOptions) => Promise<AnalysisResult>

export const transcribeWithGemini: VoiceTranscriber = async (audio, mimeType) => {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY not configured')
  const model = new GoogleGenerativeAI(key).getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' })
  const result = await model.generateContent([
    { inlineData: { data: audio.toString('base64'), mimeType } },
    {
      text: [
        'Transcribe this recorded conversation verbatim, in its original language (usually Hebrew).',
        'Start a new line for each change of speaker and label speakers "דובר 1", "דובר 2" when you can tell them apart.',
        'Plain text only. No summary, no commentary.',
      ].join('\n'),
    },
  ])
  const text = result.response.text().trim()
  if (!text) throw new Error('Empty transcription')
  return text
}

async function recordingPeople(db: Db, recordingId: string) {
  return db
    .select({ id: people.id, name: people.name })
    .from(voiceRecordingPeople)
    .innerJoin(people, eq(people.id, voiceRecordingPeople.personId))
    .where(eq(voiceRecordingPeople.recordingId, recordingId))
}

/** Transcribes, analyzes and proposes commitments. Failures are stored on the recording. */
export async function processVoiceRecording(
  db: Db,
  recordingId: string,
  options: { transcribe?: VoiceTranscriber; analyze?: VoiceAnalyzer; now?: number } = {},
): Promise<VoiceRecording> {
  const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
  if (!rec) throw new Error('Recording not found')
  const stamp = () => new Date(options.now ?? Date.now()).toISOString()
  await db.update(voiceRecordings).set({ status: 'processing', error: null, updatedAt: stamp() }).where(eq(voiceRecordings.id, rec.id))
  let analysisId: string | null = null
  try {
    const transcript =
      rec.transcriptText || (await (options.transcribe ?? transcribeWithGemini)(fs.readFileSync(rec.audioPath), rec.mimeType))
    await db.update(voiceRecordings).set({ transcriptText: transcript, updatedAt: stamp() }).where(eq(voiceRecordings.id, rec.id))

    const attendees = await recordingPeople(db, rec.id)
    let meetingId = rec.meetingId
    let createdMeetingId = rec.createdMeetingId
    if (!meetingId) {
      const startMs = Date.parse(rec.createdAt) - rec.duration * 1000
      const start = localDateTime(startMs)
      const end = localDateTime(Date.parse(rec.createdAt))
      meetingId = newId('m_voice')
      createdMeetingId = meetingId
      await db.insert(meetings).values({
        id: meetingId,
        title: attendees.length > 0 ? `${VOICE_PLACEHOLDER_TITLE} · ${attendees.map((a) => a.name).join(', ')}` : VOICE_PLACEHOLDER_TITLE,
        date: start.date,
        time: start.time,
        endTime: end.time,
        source: 'voice',
        createdAt: stamp(),
        updatedAt: stamp(),
      })
    }
    await linkMeetingPeople(db, meetingId, attendees.map((a) => a.id))
    await db
      .update(voiceRecordings)
      .set({ meetingId, createdMeetingId, updatedAt: stamp() })
      .where(eq(voiceRecordings.id, rec.id))

    const [meeting] = await db.select({ title: meetings.title, date: meetings.date }).from(meetings).where(eq(meetings.id, meetingId))
    const participantNames = (
      await db
        .select({ name: people.name })
        .from(meetingPeople)
        .innerJoin(people, eq(people.id, meetingPeople.personId))
        .where(eq(meetingPeople.meetingId, meetingId))
    ).map((p) => p.name)

    if (rec.analysisId) await db.delete(meetingAnalyses).where(eq(meetingAnalyses.id, rec.analysisId))
    analysisId = newId('ma_voice')
    await db.insert(meetingAnalyses).values({
      id: analysisId,
      meetingId,
      source: 'voice',
      transcriptText: transcript,
      audioPath: rec.audioPath,
      status: 'pending',
      consentConfirmedAt: rec.consentConfirmedAt,
      createdAt: stamp(),
      updatedAt: stamp(),
    })
    const result = await (options.analyze ?? analyzeTranscript)({
      transcriptText: transcript,
      meetingTitle: meeting?.title ?? VOICE_PLACEHOLDER_TITLE,
      meetingDate: meeting?.date ?? rec.createdAt.slice(0, 10),
      participantNames,
    })
    await db
      .update(meetingAnalyses)
      .set({
        hatName: result.hatName,
        topic: result.topic,
        mood: result.mood,
        subtext: result.subtext,
        keyInsight: result.keyInsight,
        score: result.score,
        scoreRationale: result.scoreRationale,
        kaizenKeep: result.kaizenKeep,
        kaizenImprove: result.kaizenImprove,
        openQuestion: result.openQuestion,
        participantsJson: JSON.stringify(result.participants),
        actionItemsJson: JSON.stringify(result.actionItems),
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        status: 'completed',
        updatedAt: stamp(),
      })
      .where(eq(meetingAnalyses.id, analysisId))
    await db
      .update(voiceRecordings)
      .set({ analysisId, status: 'completed', updatedAt: stamp() })
      .where(eq(voiceRecordings.id, rec.id))
    await proposeCommitmentsFromAnalysis(db, analysisId, 'voice')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (analysisId) {
      await db.update(meetingAnalyses).set({ status: 'failed', error: message, updatedAt: stamp() }).where(eq(meetingAnalyses.id, analysisId))
    }
    await db
      .update(voiceRecordings)
      .set({ status: 'failed', error: message, analysisId, updatedAt: stamp() })
      .where(eq(voiceRecordings.id, rec.id))
  }
  const [after] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, rec.id))
  return after
}

/**
 * Sets the recording's people and optionally moves it onto an existing meeting. The analysis,
 * people and voice commitments move with it; a placeholder meeting made for it is removed.
 */
export async function attachVoiceRecording(
  db: Db,
  input: { recordingId: string; personIds: string[]; meetingId?: string | null },
): Promise<{ attached: boolean; meetingId: string | null }> {
  const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, input.recordingId))
  if (!rec) throw new Error('Recording not found')
  const personIds = await existingPersonIds(db, input.personIds)
  await db.delete(voiceRecordingPeople).where(eq(voiceRecordingPeople.recordingId, rec.id))
  for (const personId of personIds) await db.insert(voiceRecordingPeople).values({ recordingId: rec.id, personId })

  let meetingId = rec.meetingId
  let createdMeetingId = rec.createdMeetingId
  if (input.meetingId && input.meetingId !== rec.meetingId) {
    const [target] = await db.select({ id: meetings.id }).from(meetings).where(eq(meetings.id, input.meetingId))
    if (!target) throw new Error('Meeting not found')
    if (rec.analysisId) await db.update(meetingAnalyses).set({ meetingId: target.id }).where(eq(meetingAnalyses.id, rec.analysisId))
    if (rec.meetingId) {
      await db
        .update(commitments)
        .set({ sourceId: target.id })
        .where(and(eq(commitments.source, 'voice'), eq(commitments.sourceId, rec.meetingId)))
      if (rec.createdMeetingId === rec.meetingId) await db.delete(meetings).where(eq(meetings.id, rec.meetingId))
    }
    meetingId = target.id
    createdMeetingId = null
  }
  if (meetingId) await linkMeetingPeople(db, meetingId, personIds)
  await db
    .update(voiceRecordings)
    .set({ meetingId, createdMeetingId, updatedAt: new Date().toISOString() })
    .where(eq(voiceRecordings.id, rec.id))
  if (rec.analysisId) await proposeCommitmentsFromAnalysis(db, rec.analysisId, 'voice')
  return { attached: true, meetingId }
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Meetings that were running during the recording or ended up to 15 minutes before it started. */
export async function attachCandidates(db: Db, recordingId: string) {
  const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
  if (!rec) return []
  const endMs = Date.parse(rec.createdAt)
  const start = localDateTime(endMs - rec.duration * 1000)
  const end = localDateTime(endMs)
  const rows = await db
    .select({ id: meetings.id, title: meetings.title, date: meetings.date, time: meetings.time, endTime: meetings.endTime })
    .from(meetings)
    .where(and(eq(meetings.date, start.date), ne(meetings.source, 'voice')))
  const from = minutes(start.time) - ATTACH_WINDOW_MIN
  const to = start.date === end.date ? minutes(end.time) : 24 * 60
  return rows
    .filter((m) => {
      const s = minutes(m.time)
      const e = m.endTime ? minutes(m.endTime) : s + 60
      return s <= to && e >= from
    })
    .sort((a, b) => b.time.localeCompare(a.time))
}

export interface VoiceRecordingSummary {
  id: string
  createdAt: string
  duration: number
  status: string
  error: string | null
  meetingId: string | null
  meetingTitle: string | null
  analysisId: string | null
  topic: string | null
  people: { id: string; name: string }[]
}

async function summarize(db: Db, rows: VoiceRecording[]): Promise<VoiceRecordingSummary[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const links = await db
    .select({ recordingId: voiceRecordingPeople.recordingId, id: people.id, name: people.name })
    .from(voiceRecordingPeople)
    .innerJoin(people, eq(people.id, voiceRecordingPeople.personId))
    .where(inArray(voiceRecordingPeople.recordingId, ids))
  const meetingIds = rows.map((r) => r.meetingId).filter((id): id is string => !!id)
  const titles = new Map(
    meetingIds.length
      ? (await db.select({ id: meetings.id, title: meetings.title }).from(meetings).where(inArray(meetings.id, meetingIds))).map((m) => [m.id, m.title])
      : [],
  )
  const analysisIds = rows.map((r) => r.analysisId).filter((id): id is string => !!id)
  const topics = new Map(
    analysisIds.length
      ? (await db.select({ id: meetingAnalyses.id, topic: meetingAnalyses.topic }).from(meetingAnalyses).where(inArray(meetingAnalyses.id, analysisIds))).map((a) => [a.id, a.topic])
      : [],
  )
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    duration: r.duration,
    status: r.status,
    error: r.error,
    meetingId: r.meetingId,
    meetingTitle: r.meetingId ? titles.get(r.meetingId) ?? null : null,
    analysisId: r.analysisId,
    topic: r.analysisId ? topics.get(r.analysisId) ?? null : null,
    people: links.filter((l) => l.recordingId === r.id).map((l) => ({ id: l.id, name: l.name })),
  }))
}

export async function listVoiceRecordings(db: Db, options: { personId?: string; limit?: number } = {}) {
  const limit = options.limit ?? 10
  let rows: VoiceRecording[]
  if (options.personId) {
    rows = (
      await db
        .select({ rec: voiceRecordings })
        .from(voiceRecordingPeople)
        .innerJoin(voiceRecordings, eq(voiceRecordings.id, voiceRecordingPeople.recordingId))
        .where(eq(voiceRecordingPeople.personId, options.personId))
        .orderBy(desc(voiceRecordings.createdAt))
        .limit(limit + 1)
    ).map((r) => r.rec)
  } else {
    rows = await db.select().from(voiceRecordings).orderBy(desc(voiceRecordings.createdAt)).limit(limit + 1)
  }
  return { recordings: await summarize(db, rows.slice(0, limit)), hasMore: rows.length > limit }
}

export async function getVoiceRecording(db: Db, recordingId: string) {
  const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
  if (!rec) return null
  const [summary] = await summarize(db, [rec])
  return { ...summary, transcriptText: rec.transcriptText }
}
