/**
 * Consented voice recordings: stored on disk next to the database, transcribed by Gemini, and
 * analyzed into a meeting (the one it belongs to, or a placeholder `source='voice'` meeting).
 */
import * as fs from 'fs'
import * as path from 'path'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { FileState, GoogleAIFileManager } from '@google/generative-ai/server'
import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import {
  commitments,
  getDbPath,
  meetingAnalyses,
  meetingPeople,
  meetings,
  people,
  projects,
  voiceRecordingPeople,
  voiceRecordings,
  voiceTranscriptSegments,
  type VoiceRecording,
  type getDb,
} from '@ak-system/database'
import { analyzeTranscript, type AnalysisResult, type AnalyzeTranscriptOptions } from './meeting-analysis'
import { omitSelfParticipants, ownerIdentityPrompt } from './self-person'
import { proposeCommitmentsFromAnalysis } from './commitments'
import { notifyUnknownSpeakers, runSelfVoiceDetection } from './voice-diarization'
import { getAgentCalendarIds } from './agent-calendar-scope'

type Db = ReturnType<typeof getDb>

/**
 * Gemini's inline-request audio limit is ~20MB per request; above this, `transcribeWithGemini`
 * switches to the Files API (upload → poll → transcribe by reference → delete) instead of
 * rejecting the recording. This is a Gemini platform limit, not a product choice — keep it here.
 */
const GEMINI_INLINE_MAX_BYTES = 19 * 1024 * 1024
/** How long to wait for an uploaded Gemini file to leave the PROCESSING state. */
const GEMINI_FILE_ACTIVE_TIMEOUT_MS = 60_000
const GEMINI_FILE_POLL_INTERVAL_MS = 2000
/** App-level sanity ceiling on upload size — generous, effectively "don't accept absurd files". */
export const VOICE_MAX_BYTES = 300 * 1024 * 1024
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
  // Samsung/Android native call-recorder output, for imported (not live-recorded) files
  'audio/3gpp': '3gp',
  'audio/3gpp2': '3g2',
  'audio/amr': 'amr',
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

async function existingProjectId(db: Db, id: string | null | undefined): Promise<string | null> {
  if (!id) return null
  const [row] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id))
  return row?.id ?? null
}

async function existingPersonIds(db: Db, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return []
  return (await db.select({ id: people.id }).from(people).where(inArray(people.id, unique))).map((p) => p.id)
}

/** People already linked to a meeting, minus the ones hidden from the CRM. */
async function meetingAttendeeIds(db: Db, meetingId: string): Promise<string[]> {
  return (
    await db
      .select({ id: people.id })
      .from(meetingPeople)
      .innerJoin(people, eq(people.id, meetingPeople.personId))
      .where(and(eq(meetingPeople.meetingId, meetingId), ne(people.status, 'ignored')))
  ).map((p) => p.id)
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
  projectId?: string | null
  now?: number
  /** 'live' (recorded in-app, default) or 'imported' (e.g. a phone call recording picked/shared from device storage) */
  source?: 'live' | 'imported'
}

export async function saveVoiceUpload(db: Db, input: VoiceUploadInput): Promise<{ recordingId: string }> {
  if (!input.consentConfirmed) throw new VoiceUploadError('נדרש אישור שכל המשתתפים הסכימו להקלטה')
  if (input.audio.length === 0) throw new VoiceUploadError('קובץ ההקלטה ריק')
  if (input.audio.length > VOICE_MAX_BYTES) throw new VoiceUploadError('ההקלטה גדולה מדי')
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds < VOICE_MIN_SECONDS) {
    throw new VoiceUploadError('ההקלטה קצרה מדי (לפחות 10 שניות)')
  }
  const mimeType = input.mimeType.split(';')[0].trim().toLowerCase() || 'audio/webm'
  const ext = EXT_BY_MIME[mimeType]
  if (!ext) throw new VoiceUploadError(`סוג קובץ לא נתמך: ${mimeType}`)

  // Recording a meeting picked from the calendar: its attendees and project come along, so the
  // user never retypes what the calendar already knows (docs/specs/record-from-calendar-meeting.md).
  let meetingId: string | null = null
  let meetingPersonIds: string[] = []
  let meetingProjectId: string | null = null
  if (input.meetingId) {
    const [m] = await db
      .select({ id: meetings.id, projectId: meetings.projectId })
      .from(meetings)
      .where(eq(meetings.id, input.meetingId))
    if (!m) throw new VoiceUploadError('הפגישה לא נמצאה')
    meetingId = m.id
    meetingProjectId = m.projectId
    meetingPersonIds = await meetingAttendeeIds(db, m.id)
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
    projectId: (await existingProjectId(db, input.projectId)) ?? (await existingProjectId(db, meetingProjectId)),
    source: input.source ?? 'live',
  })
  const personIds = new Set([...(await existingPersonIds(db, input.personIds ?? [])), ...meetingPersonIds])
  for (const personId of personIds) {
    await db.insert(voiceRecordingPeople).values({ recordingId: id, personId })
  }
  return { recordingId: id }
}

/** One speaker turn as the model returned it. */
export interface TranscriptSegment {
  speakerLabel: string
  startMs: number
  endMs: number
  text: string
}

/**
 * `text` keeps the plain `דובר N: ...` line format everything downstream already reads;
 * `segments` is empty whenever the model gave no usable timings.
 */
export interface TranscriptResult {
  text: string
  segments: TranscriptSegment[]
}

export type VoiceTranscriber = (audio: Buffer, mimeType: string) => Promise<string | TranscriptResult>
export type VoiceAnalyzer = (options: AnalyzeTranscriptOptions) => Promise<AnalysisResult>

const TRANSCRIBE_PROMPT = [
  ownerIdentityPrompt(),
  'Transcribe this recorded conversation verbatim, in its original language (usually Hebrew).',
  'Return ONLY a JSON array — no prose, no markdown fence. One object per speaker turn, in order:',
  '[{"speaker":"דובר 1","start":0,"end":4.2,"text":"..."}]',
  '"speaker" is "דובר 1", "דובר 2", … and stays the same label for the same voice throughout.',
  'Alpir Kritzler is one of the speakers. Do not write his name as the speaker label — keep דובר N.',
  '"start" and "end" are seconds from the start of the audio, as numbers.',
  '"text" is that turn verbatim, without any speaker prefix.',
].join('\n')

/** Seconds as a number, or a `hh:mm:ss.mmm` / `mm:ss` timecode, to whole milliseconds. */
function toMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.round(value * 1000)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000)
  if (!/^\d{1,2}(:\d{1,2}){1,2}(\.\d+)?$/.test(trimmed)) return null
  return Math.round(trimmed.split(':').reduce((acc, part) => acc * 60 + Number(part), 0) * 1000)
}

interface TranscriptTurn {
  speakerLabel: string
  text: string
  /** Null when the model gave no usable timing — the turn still belongs in the transcript. */
  timing: { startMs: number; endMs: number } | null
}

function turnOf(raw: unknown): TranscriptTurn | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const text = typeof row.text === 'string' ? row.text.trim() : ''
  const speakerLabel = typeof row.speaker === 'string' ? row.speaker.trim() : ''
  if (!text || !speakerLabel) return null
  const startMs = toMs(row.start)
  const endMs = toMs(row.end)
  const timing = startMs !== null && endMs !== null && endMs > startMs ? { startMs, endMs } : null
  return { speakerLabel, text, timing }
}

/**
 * Reads the model's JSON turns. A response that is not parseable JSON degrades to a plain
 * transcript rather than failing the recording. Timings are only needed for speaker samples,
 * so a turn the model timed badly still contributes its text — never leave the raw JSON as
 * the transcript, which is what the user and the analysis step read.
 */
export function parseTranscription(raw: string): TranscriptResult {
  const body = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return { text: raw, segments: [] }
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { segments?: unknown })?.segments)
      ? (parsed as { segments: unknown[] }).segments
      : null
  if (!rows) return { text: raw, segments: [] }

  const turns = rows.map(turnOf).filter((t): t is TranscriptTurn => t !== null)
  if (turns.length === 0) return { text: raw, segments: [] }

  const segments: TranscriptSegment[] = turns
    .filter((t) => t.timing !== null)
    .map((t) => ({ speakerLabel: t.speakerLabel, text: t.text, ...t.timing! }))

  return { text: turns.map((t) => `${t.speakerLabel}: ${t.text}`).join('\n'), segments }
}

function toTranscriptResult(raw: string | TranscriptResult): TranscriptResult {
  return typeof raw === 'string' ? parseTranscription(raw) : raw
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Uploads a large file to Gemini, waits for it to leave PROCESSING, transcribes by reference, and always cleans up. */
async function transcribeViaFilesApi(key: string, model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>, audio: Buffer, mimeType: string): Promise<string> {
  const fileManager = new GoogleAIFileManager(key)
  const uploaded = await fileManager.uploadFile(audio, { mimeType, displayName: 'ak-voice-recording' })
  let file = uploaded.file
  const deadline = Date.now() + GEMINI_FILE_ACTIVE_TIMEOUT_MS
  try {
    while (file.state === FileState.PROCESSING && Date.now() < deadline) {
      await sleep(GEMINI_FILE_POLL_INTERVAL_MS)
      file = await fileManager.getFile(file.name)
    }
    if (file.state === FileState.FAILED) throw new Error('עיבוד ההקלטה ב-Gemini נכשל')
    if (file.state !== FileState.ACTIVE) throw new Error('עיבוד ההקלטה ב-Gemini נמשך זמן רב מדי')
    const result = await model.generateContent([
      { fileData: { fileUri: file.uri, mimeType: file.mimeType } },
      { text: TRANSCRIBE_PROMPT },
    ])
    const text = result.response.text().trim()
    if (!text) throw new Error('Empty transcription')
    return text
  } finally {
    await fileManager.deleteFile(file.name).catch((err) => {
      console.warn('[voice] failed to delete Gemini file:', err)
    })
  }
}

export const transcribeWithGemini: VoiceTranscriber = async (audio, mimeType) => {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY not configured')
  const model = new GoogleGenerativeAI(key).getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' })

  if (audio.length > GEMINI_INLINE_MAX_BYTES) return transcribeViaFilesApi(key, model, audio, mimeType)

  const result = await model.generateContent([
    { inlineData: { data: audio.toString('base64'), mimeType } },
    { text: TRANSCRIBE_PROMPT },
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

/** Replaces the stored turns for a recording, so a re-transcription never leaves stale segments. */
export async function saveTranscriptSegments(
  db: Db,
  recordingId: string,
  segments: TranscriptSegment[],
  now?: number,
): Promise<void> {
  await db.delete(voiceTranscriptSegments).where(eq(voiceTranscriptSegments.recordingId, recordingId))
  if (segments.length === 0) return
  const at = new Date(now ?? Date.now()).toISOString()
  for (const [i, seg] of segments.entries()) {
    await db.insert(voiceTranscriptSegments).values({
      id: `vts_${recordingId}_${i}`,
      recordingId,
      speakerLabel: seg.speakerLabel,
      startMs: seg.startMs,
      endMs: seg.endMs,
      text: seg.text,
      createdAt: at,
    })
  }
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
    const transcribed = rec.transcriptText
      ? { text: rec.transcriptText, segments: [] as TranscriptSegment[] }
      : toTranscriptResult(await (options.transcribe ?? transcribeWithGemini)(fs.readFileSync(rec.audioPath), rec.mimeType))
    const transcript = transcribed.text
    await db.update(voiceRecordings).set({ transcriptText: transcript, updatedAt: stamp() }).where(eq(voiceRecordings.id, rec.id))
    await saveTranscriptSegments(db, rec.id, transcribed.segments, options.now)

    // Best-effort: never blocks transcription/analysis if it fails (see voice-diarization.ts).
    await runSelfVoiceDetection(db, rec.id).catch((err) => {
      console.warn('[voice] self-voice detection failed:', err)
    })
    await notifyUnknownSpeakers(db, rec.id).catch((err) => {
      console.warn('[voice] unknown-speaker prompt failed:', err)
    })

    const attendees = await recordingPeople(db, rec.id)
    const [fresh] = await db.select({ projectId: voiceRecordings.projectId }).from(voiceRecordings).where(eq(voiceRecordings.id, rec.id))
    const projectId = fresh?.projectId ?? rec.projectId
    let meetingId = rec.meetingId
    let createdMeetingId = rec.createdMeetingId
    let matchedAutomatically = false
    if (!meetingId) {
      const auto = await findAutoMatchMeeting(db, rec).catch((err) => {
        console.warn('[voice] auto-match failed:', err)
        return null
      })
      if (auto) {
        meetingId = auto.id
        matchedAutomatically = true
        if (projectId) await db.update(meetings).set({ projectId, updatedAt: stamp() }).where(eq(meetings.id, meetingId))
      } else {
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
          projectId,
          createdAt: stamp(),
          updatedAt: stamp(),
        })
      }
    } else if (projectId) {
      await db.update(meetings).set({ projectId, updatedAt: stamp() }).where(eq(meetings.id, meetingId))
    }
    await linkMeetingPeople(db, meetingId, attendees.map((a) => a.id))
    await db
      .update(voiceRecordings)
      .set({ meetingId, createdMeetingId, matchedAutomatically, updatedAt: stamp() })
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
        participantsJson: JSON.stringify(omitSelfParticipants(result.participants ?? [])),
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
    const { notifyAnalysisOnWhatsApp } = await import('./analysis-whatsapp')
    await notifyAnalysisOnWhatsApp(db, analysisId).catch((err) => {
      console.warn('[voice] analysis WhatsApp failed:', err)
    })
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
  input: { recordingId: string; personIds: string[]; meetingId?: string | null; projectId?: string | null },
): Promise<{ attached: boolean; meetingId: string | null }> {
  const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, input.recordingId))
  if (!rec) throw new Error('Recording not found')
  const personIds = await existingPersonIds(db, input.personIds)
  await db.delete(voiceRecordingPeople).where(eq(voiceRecordingPeople.recordingId, rec.id))
  for (const personId of personIds) await db.insert(voiceRecordingPeople).values({ recordingId: rec.id, personId })

  const projectId = input.projectId !== undefined ? await existingProjectId(db, input.projectId) : rec.projectId
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
  if (meetingId) {
    // A placeholder meeting belongs to this recording, so removed people leave it too.
    // An existing meeting only gains people; its other attendees stay.
    if (createdMeetingId === meetingId) {
      await db.delete(meetingPeople).where(eq(meetingPeople.meetingId, meetingId))
    }
    await linkMeetingPeople(db, meetingId, personIds)
  }
  await db
    .update(voiceRecordings)
    .set({ meetingId, createdMeetingId, projectId, updatedAt: new Date().toISOString() })
    .where(eq(voiceRecordings.id, rec.id))
  if (meetingId && input.projectId !== undefined) {
    await db.update(meetings).set({ projectId, updatedAt: new Date().toISOString() }).where(eq(meetings.id, meetingId))
  }
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

/**
 * A single calendar-sourced meeting whose calendar is in the user's agent-calendar scope and whose
 * time overlaps the recording — auto-attach only when unambiguous. Never picks among several
 * candidates; that stays a manual choice via `attachCandidates`. See docs/specs/recording-auto-calendar-context.md.
 */
export async function findAutoMatchMeeting(
  db: Db,
  rec: Pick<VoiceRecording, 'createdAt' | 'duration'>,
): Promise<{ id: string } | null> {
  const endMs = Date.parse(rec.createdAt)
  const start = localDateTime(endMs - rec.duration * 1000)
  const end = localDateTime(endMs)
  const rows = await db
    .select({ id: meetings.id, time: meetings.time, endTime: meetings.endTime, calendarId: meetings.calendarId })
    .from(meetings)
    .where(and(eq(meetings.date, start.date), eq(meetings.source, 'calendar')))
  if (rows.length === 0) return null

  const scope = await getAgentCalendarIds()
  const inScope = scope ? rows.filter((m) => !m.calendarId || scope.includes(m.calendarId)) : rows

  const from = minutes(start.time) - ATTACH_WINDOW_MIN
  const to = (start.date === end.date ? minutes(end.time) : 24 * 60) + ATTACH_WINDOW_MIN
  const overlapping = inScope.filter((m) => {
    const s = minutes(m.time)
    const e = m.endTime ? minutes(m.endTime) : s + 60
    return s <= to && e >= from
  })
  return overlapping.length === 1 ? { id: overlapping[0].id } : null
}

/** A meeting offered on the recording screen: tapping it starts a recording linked to it. */
export interface MeetingChoice {
  id: string
  title: string
  date: string
  time: string
  endTime: string | null
  location: string | null
  projectId: string | null
  projectName: string | null
  people: { id: string; name: string }[]
  state: 'now' | 'upcoming' | 'ended'
}

/** A meeting counts as happening "now" from this long before its start time. */
const MEETING_NOW_LEAD_MIN = 30
/** Assumed length of a meeting with no end time, matching `attachCandidates`. */
const MEETING_DEFAULT_LENGTH_MIN = 60

type MeetingChoiceRow = {
  id: string
  title: string
  date: string
  time: string
  endTime: string | null
  location: string | null
  projectId: string | null
}

function meetingState(row: MeetingChoiceRow, today: string, nowMinutes: number): MeetingChoice['state'] {
  if (row.date !== today) return row.date < today ? 'ended' : 'upcoming'
  const start = minutes(row.time)
  const end = row.endTime ? minutes(row.endTime) : start + MEETING_DEFAULT_LENGTH_MIN
  if (nowMinutes > end) return 'ended'
  return start - nowMinutes <= MEETING_NOW_LEAD_MIN ? 'now' : 'upcoming'
}

async function toMeetingChoices(db: Db, rows: MeetingChoiceRow[], now: number): Promise<MeetingChoice[]> {
  if (rows.length === 0) return []
  const { date: today, time } = localDateTime(now)
  const nowMinutes = minutes(time)
  const attendees = await db
    .select({ meetingId: meetingPeople.meetingId, id: people.id, name: people.name })
    .from(meetingPeople)
    .innerJoin(people, eq(people.id, meetingPeople.personId))
    .where(and(inArray(meetingPeople.meetingId, rows.map((r) => r.id)), ne(people.status, 'ignored')))
  const projectIds = rows.map((r) => r.projectId).filter((id): id is string => !!id)
  const projectNames = new Map(
    projectIds.length
      ? (await db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, projectIds))).map((p) => [p.id, p.name])
      : [],
  )
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    date: r.date,
    time: r.time,
    endTime: r.endTime,
    location: r.location,
    projectId: r.projectId,
    projectName: r.projectId ? projectNames.get(r.projectId) ?? null : null,
    people: attendees.filter((a) => a.meetingId === r.id).map((a) => ({ id: a.id, name: a.name })),
    state: meetingState(r, today, nowMinutes),
  }))
}

const MEETING_CHOICE_COLUMNS = {
  id: meetings.id,
  title: meetings.title,
  date: meetings.date,
  time: meetings.time,
  endTime: meetings.endTime,
  location: meetings.location,
  projectId: meetings.projectId,
}

/**
 * Today's meetings for the recording screen, in tap order: the one happening now first, then the
 * rest of the day, then what already ended. "Today" and "now" are read in the system timezone, not
 * UTC, so the list is still right after midnight local time.
 */
export async function listMeetingChoices(db: Db, options: { now?: number } = {}): Promise<MeetingChoice[]> {
  const now = options.now ?? Date.now()
  const { date: today } = localDateTime(now)
  const rows = await db
    .select(MEETING_CHOICE_COLUMNS)
    .from(meetings)
    .where(and(eq(meetings.date, today), ne(meetings.source, 'voice')))
  const choices = await toMeetingChoices(db, rows, now)
  const rank = { now: 0, upcoming: 1, ended: 2 }
  return choices.sort((a, b) =>
    rank[a.state] !== rank[b.state]
      ? rank[a.state] - rank[b.state]
      : a.state === 'ended'
        ? b.time.localeCompare(a.time)
        : a.time.localeCompare(b.time),
  )
}

/** One meeting by id, for the "record this meeting" deep link — any date, not just today. */
export async function getMeetingChoice(db: Db, meetingId: string, options: { now?: number } = {}): Promise<MeetingChoice | null> {
  const rows = await db
    .select(MEETING_CHOICE_COLUMNS)
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), ne(meetings.source, 'voice')))
  const [choice] = await toMeetingChoices(db, rows, options.now ?? Date.now())
  return choice ?? null
}

/**
 * How the recording got its meeting: `chosen` from the calendar before recording, `auto` from the
 * post-upload match, `standalone` for the placeholder meeting made for an unlinked recording.
 */
export type VoiceMeetingLink = 'chosen' | 'auto' | 'standalone' | null

function meetingLinkOf(rec: Pick<VoiceRecording, 'meetingId' | 'createdMeetingId' | 'matchedAutomatically'>): VoiceMeetingLink {
  if (!rec.meetingId) return null
  if (rec.createdMeetingId === rec.meetingId) return 'standalone'
  return rec.matchedAutomatically ? 'auto' : 'chosen'
}

export interface VoiceRecordingSummary {
  id: string
  createdAt: string
  duration: number
  status: string
  error: string | null
  meetingId: string | null
  meetingTitle: string | null
  /** True when `meetingId` was set by automatic calendar-context matching, not manual attach or a placeholder */
  matchedAutomatically: boolean
  meetingLink: VoiceMeetingLink
  analysisId: string | null
  topic: string | null
  project: { id: string; name: string } | null
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
  const projectIds = rows.map((r) => r.projectId).filter((id): id is string => !!id)
  const projectNames = new Map(
    projectIds.length
      ? (await db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, projectIds))).map((p) => [p.id, p.name])
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
    matchedAutomatically: Boolean(r.matchedAutomatically),
    meetingLink: meetingLinkOf(r),
    analysisId: r.analysisId,
    topic: r.analysisId ? topics.get(r.analysisId) ?? null : null,
    project: r.projectId && projectNames.has(r.projectId) ? { id: r.projectId, name: projectNames.get(r.projectId)! } : null,
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
