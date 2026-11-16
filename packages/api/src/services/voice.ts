/**
 * Consented voice recordings: stored on disk next to the database, transcribed by Gemini, and
 * analyzed into a meeting (the one it belongs to, or a placeholder `source='voice'` meeting).
 */
import { assertSameWorld, sameWorldOrSkip } from './world-scope'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory, type GenerateContentResult } from '@google/generative-ai'
import { FileState, GoogleAIFileManager } from '@google/generative-ai/server'
import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import { cosineSimilarity, decodeToPcm16, extractSpeechSegments, type SpeechSegment } from './audio-features'
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
import {
  attributeSpeakersFromCandidates,
  attributedTranscript,
  autoIdentifyTwoPersonConversation,
  notifyUnknownSpeakers,
  recordingCandidates,
  runSelfVoiceDetection,
  type SpeakerAttributor,
} from './voice-diarization'
import { linkAnalysisPeople } from './people-resolve'
import { getAgentCalendarIds } from './agent-calendar-scope'

type Db = ReturnType<typeof getDb>

const execFileAsync = promisify(execFile)

/**
 * Gemini's inline-request audio limit is ~20MB per request; above this, `transcribeWithGemini`
 * switches to the Files API (upload → poll → transcribe by reference → delete) instead of
 * rejecting the recording. This is a Gemini platform limit, not a product choice — keep it here.
 */
const GEMINI_INLINE_MAX_BYTES = 19 * 1024 * 1024
/** How long to wait for an uploaded Gemini file to leave the PROCESSING state. */
const GEMINI_FILE_ACTIVE_TIMEOUT_MS = 60_000
const GEMINI_FILE_POLL_INTERVAL_MS = 2000
/**
 * Recordings longer than this are split into chunks before transcription instead of being sent to
 * Gemini as one request (see docs/specs/voice-chunked-long-transcription.md). A single very long
 * recording (~1h+) asks Gemini for a single huge speaker-by-speaker JSON transcript in one response;
 * in practice this sometimes comes back with `finishReason: 'OTHER'` (no usable text at all) instead
 * of a result — almost certainly the response approaching an internal output-size/complexity limit.
 * Chunking keeps each request's expected output small and makes a single bad chunk retryable/
 * isolated instead of failing the whole recording.
 *
 * Request time is the other limit: Node's fetch drops a request that has no response headers after
 * 300s ("fetch failed"), and gemini-3.8-flash took longer than that on 20 minutes of dense Hebrew
 * (it took ~100s on 10). Chunks stay at 10 minutes to keep each request well inside that window.
 */
export const VOICE_CHUNK_THRESHOLD_SECONDS = Number(process.env.VOICE_CHUNK_THRESHOLD_SECONDS) || 12 * 60
/** Target length of each chunk once a recording is over the threshold above. */
export const VOICE_CHUNK_DURATION_SECONDS = Number(process.env.VOICE_CHUNK_DURATION_SECONDS) || 10 * 60
/**
 * Model tried when the primary one still fails after its retries. gemini-3.1-pro-preview transcribed
 * a chunk that gemini-3.8-flash kept blocking (`blockReason: OTHER`). Set to an empty string to disable.
 */
const TRANSCRIBE_FALLBACK_MODEL = process.env.VOICE_TRANSCRIBE_FALLBACK_MODEL ?? 'gemini-3.1-pro-preview'
/**
 * Cosine-similarity cutoff (same log-mel voiceprint heuristic as self-voice matching, see
 * audio-features.ts) for deciding that a speaker label in one chunk is the same person as a label
 * already seen in an earlier chunk. Gemini renumbers "דובר 1/2/…" independently per request, so
 * without this, chunking would silently scramble who-said-what across chunk boundaries.
 */
const CHUNK_SPEAKER_MATCH_THRESHOLD = Number(process.env.VOICE_CHUNK_SPEAKER_MATCH_THRESHOLD ?? '0.75')
/**
 * How many times to ask Gemini again for the same audio when a response comes back blocked
 * (finishReason other than STOP) or otherwise fails — `finishReason: 'OTHER'` in particular has
 * been observed to be non-deterministic: the same audio can succeed on a retry.
 */
const TRANSCRIBE_MAX_ATTEMPTS = 3
/**
 * This is a verbatim-transcription task over the user's own consented recordings, not content
 * generation — Gemini's default (moderate) safety thresholds have been observed to block entirely
 * ordinary conversation (an animated business discussion, a disagreement, mention of an illness,
 * etc.) with `finishReason: 'OTHER'` and no transcript at all. Relaxing them here does not affect
 * any other Gemini call in the app (meeting analysis, agents, …), only this transcription request.
 */
const TRANSCRIPTION_SAFETY_SETTINGS = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_NONE }))
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

/**
 * Real length of an audio file in seconds via `ffprobe`, or null when it can't be read (binary
 * missing, or a container without a duration header such as some MediaRecorder webm). Imported
 * files arrive with a placeholder duration from the client, so this is what decides chunking.
 */
export async function probeAudioDurationSeconds(audioPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      audioPath,
    ])
    const seconds = Number(String(stdout).trim())
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null
  } catch {
    return null
  }
}

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
  /**
   * The user reviewed attendees and project before upload. When true, `personIds` and
   * `projectId` are the confirmed context — calendar invitees are not merged in, and an
   * empty list stays empty. Old clients omit this and keep the previous merge behavior.
   */
  contextConfirmed?: boolean
  now?: number
  /** 'live' (recorded in-app, default) or 'imported' (e.g. a phone call recording picked/shared from device storage) */
  source?: 'live' | 'imported'
}

/** Normalized mime type and its storage extension, or a `VoiceUploadError` for unsupported types. */
export function voiceMimeAndExt(rawMimeType: string): { mimeType: string; ext: string } {
  const mimeType = rawMimeType.split(';')[0].trim().toLowerCase() || 'audio/webm'
  const ext = EXT_BY_MIME[mimeType]
  if (!ext) throw new VoiceUploadError(`סוג קובץ לא נתמך: ${mimeType}`)
  return { mimeType, ext }
}

/** Where a recording with this id and extension is stored. */
export function voiceAudioPath(id: string, ext: string): string {
  return path.join(voiceStorageDir(), `${id}.${ext}`)
}

export function newVoiceRecordingId(): string {
  return newId('vr')
}

export async function saveVoiceUpload(db: Db, input: VoiceUploadInput): Promise<{ recordingId: string }> {
  if (!input.consentConfirmed) throw new VoiceUploadError('נדרש אישור שכל המשתתפים הסכימו להקלטה')
  if (input.audio.length === 0) throw new VoiceUploadError('קובץ ההקלטה ריק')
  if (input.audio.length > VOICE_MAX_BYTES) throw new VoiceUploadError('ההקלטה גדולה מדי')
  const { mimeType, ext } = voiceMimeAndExt(input.mimeType)

  const id = newVoiceRecordingId()
  fs.mkdirSync(voiceStorageDir(), { recursive: true })
  const audioPath = voiceAudioPath(id, ext)
  // Use async write so large audio files don't block the Node.js event loop (and delay the HTTP
  // response) while writing to disk.
  await fs.promises.writeFile(audioPath, input.audio)
  return registerStoredVoiceFile(db, { ...input, id, audioPath, mimeType, sizeBytes: input.audio.length })
}

export interface StoredVoiceFileInput extends Omit<VoiceUploadInput, 'audio'> {
  id: string
  /** Already written to disk at its final location; removed again if registration is rejected. */
  audioPath: string
  /** Normalized (see `voiceMimeAndExt`). */
  mimeType: string
  sizeBytes: number
}

/**
 * Inserts the recording row for an audio file already on disk — shared by the single-request
 * upload and the resumable upload (docs/specs/voice-recording-never-lost.md).
 */
export async function registerStoredVoiceFile(db: Db, input: StoredVoiceFileInput): Promise<{ recordingId: string }> {
  const { id, audioPath, mimeType } = input
  if (!input.consentConfirmed) {
    fs.rmSync(audioPath, { force: true })
    throw new VoiceUploadError('נדרש אישור שכל המשתתפים הסכימו להקלטה')
  }
  // For imported files, probe the real duration with ffprobe so chunking decisions are correct;
  // live recordings already carry an accurate client duration.
  const durationSeconds =
    input.source === 'imported'
      ? ((await probeAudioDurationSeconds(audioPath)) ?? input.durationSeconds)
      : input.durationSeconds
  if (!Number.isFinite(durationSeconds) || durationSeconds < VOICE_MIN_SECONDS) {
    fs.rmSync(audioPath, { force: true })
    throw new VoiceUploadError('ההקלטה קצרה מדי (לפחות 10 שניות)')
  }

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
    if (!m) {
      fs.rmSync(audioPath, { force: true })
      throw new VoiceUploadError('הפגישה לא נמצאה')
    }
    meetingId = m.id
    meetingProjectId = m.projectId
    meetingPersonIds = await meetingAttendeeIds(db, m.id)
  }

  const at = new Date(input.now ?? Date.now()).toISOString()
  await db.insert(voiceRecordings).values({
    id,
    audioPath,
    mimeType,
    sizeBytes: input.sizeBytes,
    transcriptText: null,
    analysisId: null,
    meetingId,
    createdMeetingId: null,
    duration: Math.round(durationSeconds),
    status: 'uploaded',
    error: null,
    consentConfirmedAt: at,
    createdAt: at,
    updatedAt: at,
    projectId: input.contextConfirmed
      ? await existingProjectId(db, input.projectId)
      : (await existingProjectId(db, input.projectId)) ?? (await existingProjectId(db, meetingProjectId)),
    source: input.source ?? 'live',
  })
  const confirmedPeople = await existingPersonIds(db, input.personIds ?? [])
  // A reviewed upload is the source of truth for who was actually in the room. Old clients
  // still inherit calendar attendees when they send a meeting without confirming context.
  const personIds = input.contextConfirmed ? confirmedPeople : [...new Set([...confirmedPeople, ...meetingPersonIds])]
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
 * Parses the model's JSON turns, or `null` when the response isn't parseable JSON (or has no
 * usable turns) — callers fall back to treating the raw text as a plain transcript in that case.
 */
function parseTranscriptionTurns(raw: string): TranscriptTurn[] | null {
  const body = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { segments?: unknown })?.segments)
      ? (parsed as { segments: unknown[] }).segments
      : null
  if (!rows) return null

  const turns = rows.map(turnOf).filter((t): t is TranscriptTurn => t !== null)
  return turns.length === 0 ? null : turns
}

function turnsToResult(turns: TranscriptTurn[], fallbackRaw: string): TranscriptResult {
  const segments: TranscriptSegment[] = turns
    .filter((t) => t.timing !== null)
    .map((t) => ({ speakerLabel: t.speakerLabel, text: t.text, ...t.timing! }))
  return { text: turns.length ? turns.map((t) => `${t.speakerLabel}: ${t.text}`).join('\n') : fallbackRaw, segments }
}

/**
 * Reads the model's JSON turns. A response that is not parseable JSON degrades to a plain
 * transcript rather than failing the recording. Timings are only needed for speaker samples,
 * so a turn the model timed badly still contributes its text — never leave the raw JSON as
 * the transcript, which is what the user and the analysis step read.
 */
export function parseTranscription(raw: string): TranscriptResult {
  const turns = parseTranscriptionTurns(raw)
  return turns ? turnsToResult(turns, raw) : { text: raw, segments: [] }
}

function toTranscriptResult(raw: string | TranscriptResult): TranscriptResult {
  return typeof raw === 'string' ? parseTranscription(raw) : raw
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * `result.response.text()` throws the SDK's own (English, implementation-detail) message whenever
 * the candidate didn't finish normally — e.g. `finishReason: 'OTHER'`, which Gemini sometimes
 * returns with no usable text at all for very long/complex requests. Surface a clear Hebrew error
 * with the finish reason instead of letting that raw SDK string reach the user.
 */
function readTranscriptionText(result: GenerateContentResult): string {
  let text: string
  try {
    text = result.response.text()
  } catch (err) {
    const finishReason = result.response.candidates?.[0]?.finishReason
    const blockReason = result.response.promptFeedback?.blockReason
    const reasonNote = finishReason ? ` (finishReason=${finishReason})` : blockReason ? ` (blockReason=${blockReason})` : ''
    throw new Error(
      `Gemini לא החזיר תמלול להקלטה${reasonNote} — ייתכן שההקלטה ארוכה/מורכבת מדי לבקשה אחת. נסה שוב, או פצל אותה למקטעים קצרים יותר.`,
    )
  }
  text = text.trim()
  if (!text) throw new Error('Empty transcription')
  return text
}

type GeminiModel = ReturnType<GoogleGenerativeAI['getGenerativeModel']>

/** Calls `generateContent` and reads its text, retrying (same request) a blocked/failed response up to `TRANSCRIBE_MAX_ATTEMPTS` times. */
async function generateTranscription(model: GeminiModel, parts: Parameters<GeminiModel['generateContent']>[0]): Promise<string> {
  let lastError: unknown
  for (let attempt = 1; attempt <= TRANSCRIBE_MAX_ATTEMPTS; attempt++) {
    try {
      const result = await model.generateContent(parts)
      return readTranscriptionText(result)
    } catch (err) {
      lastError = err
      if (attempt < TRANSCRIBE_MAX_ATTEMPTS) {
        console.warn(`[voice] transcription attempt ${attempt} failed, retrying:`, err instanceof Error ? err.message : err)
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/** Tries each model in order (each with its own retries); throws the last model's error if all fail. */
async function generateWithFallback(models: GeminiModel[], parts: Parameters<GeminiModel['generateContent']>[0]): Promise<string> {
  let lastError: unknown
  for (const [i, model] of models.entries()) {
    try {
      return await generateTranscription(model, parts)
    } catch (err) {
      lastError = err
      if (i < models.length - 1) {
        console.warn('[voice] primary transcription model failed, trying fallback model:', err instanceof Error ? err.message : err)
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/** Uploads a large file to Gemini, waits for it to leave PROCESSING, transcribes by reference, and always cleans up. */
async function transcribeViaFilesApi(key: string, models: GeminiModel[], audio: Buffer, mimeType: string): Promise<string> {
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
    return await generateWithFallback(models, [
      { fileData: { fileUri: file.uri, mimeType: file.mimeType } },
      { text: TRANSCRIBE_PROMPT },
    ])
  } finally {
    await fileManager.deleteFile(file.name).catch((err) => {
      console.warn('[voice] failed to delete Gemini file:', err)
    })
  }
}

export const transcribeWithGemini: VoiceTranscriber = async (audio, mimeType) => {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY not configured')
  const client = new GoogleGenerativeAI(key)
  const primary = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  const models = [...new Set([primary, TRANSCRIBE_FALLBACK_MODEL].filter(Boolean))].map((model) =>
    client.getGenerativeModel({ model, safetySettings: TRANSCRIPTION_SAFETY_SETTINGS }),
  )

  if (audio.length > GEMINI_INLINE_MAX_BYTES) return transcribeViaFilesApi(key, models, audio, mimeType)

  return generateWithFallback(models, [
    { inlineData: { data: audio.toString('base64'), mimeType } },
    { text: TRANSCRIBE_PROMPT },
  ])
}

/** Start of the placeholder line left in a transcript where one chunk of a long recording failed. */
export const VOICE_TRANSCRIPT_GAP_MARKER = '[לא ניתן היה לתמלל את הקטע'

/** True when a stored transcript has at least one chunk that failed to transcribe. */
export function hasTranscriptGaps(text: string | null | undefined): boolean {
  return typeof text === 'string' && text.includes(VOICE_TRANSCRIPT_GAP_MARKER)
}

/** One chunk of a long recording, cut from the original audio file. */
interface AudioChunk {
  path: string
  startSeconds: number
}

/** `[{ startSeconds, lengthSeconds }, …]` covering `durationSeconds` in `VOICE_CHUNK_DURATION_SECONDS`-sized steps. */
function buildChunkPlan(durationSeconds: number): { startSeconds: number; lengthSeconds: number }[] {
  const plan: { startSeconds: number; lengthSeconds: number }[] = []
  for (let start = 0; start < durationSeconds; start += VOICE_CHUNK_DURATION_SECONDS) {
    plan.push({ startSeconds: start, lengthSeconds: Math.min(VOICE_CHUNK_DURATION_SECONDS, durationSeconds - start) })
  }
  return plan
}

/**
 * Cuts one time range out of `inputPath` with a stream copy (no re-encode — audio formats split
 * cleanly this way, unlike video keyframes). Requires the `ffmpeg` binary on PATH, same as
 * audio-features.ts's `decodeToPcm16`.
 */
async function splitAudioChunk(inputPath: string, outputPath: string, startSeconds: number, lengthSeconds: number): Promise<void> {
  try {
    await execFileAsync('ffmpeg', [
      '-v', 'error',
      '-i', inputPath,
      '-ss', String(startSeconds),
      '-t', String(lengthSeconds),
      '-c', 'copy',
      outputPath,
    ])
  } catch (err) {
    throw new Error(`פיצול ההקלטה לקטעים נכשל (ffmpeg, is it installed?): ${err instanceof Error ? err.message : String(err)}`)
  }
}

function meanVector(vectors: number[][]): number[] {
  const dims = vectors[0]?.length ?? 0
  const out = new Array(dims).fill(0)
  for (const v of vectors) for (let i = 0; i < dims; i++) out[i] += v[i] / vectors.length
  return out
}

/**
 * One raw ("דובר N", chunk-local) speaker label's voiceprint, built by pooling the VAD segments
 * that fall inside that label's turns. Labels with no overlapping speech (e.g. a mistimed turn)
 * are skipped — they fall back to an unmatched, chunk-unique label in `reconcileChunk`.
 */
function labelEmbeddings(turns: TranscriptTurn[], vadSegments: SpeechSegment[]): Map<string, number[]> {
  const byLabel = new Map<string, number[][]>()
  const timed = turns.filter((t): t is TranscriptTurn & { timing: NonNullable<TranscriptTurn['timing']> } => t.timing !== null)
  for (const seg of vadSegments) {
    let bestLabel: string | null = null
    let bestOverlap = 0
    for (const turn of timed) {
      const overlap = Math.max(0, Math.min(seg.endMs, turn.timing.endMs) - Math.max(seg.startMs, turn.timing.startMs))
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        bestLabel = turn.speakerLabel
      }
    }
    if (bestLabel) byLabel.get(bestLabel)?.push(seg.embedding) ?? byLabel.set(bestLabel, [seg.embedding])
  }
  return new Map([...byLabel.entries()].map(([label, vectors]) => [label, meanVector(vectors)]))
}

/**
 * Speakers already seen in earlier chunks, so a label in chunk 2 can be recognised as "the same
 * person as chunk 1's דובר 1" rather than renumbered into a brand-new label — see
 * `VOICE_CHUNK_THRESHOLD_SECONDS`'s comment for why chunking needs this at all.
 */
class GlobalSpeakerRegistry {
  private speakers: { label: string; embedding: number[]; count: number }[] = []
  private nextIndex = 0

  /** Matches an embedding against known speakers, or registers it as a new one; returns the stable global label. */
  resolve(embedding: number[] | null): string {
    if (embedding) {
      let best: { speaker: (typeof this.speakers)[number]; sim: number } | null = null
      for (const speaker of this.speakers) {
        const sim = cosineSimilarity(embedding, speaker.embedding)
        if (!best || sim > best.sim) best = { speaker, sim }
      }
      if (best && best.sim >= CHUNK_SPEAKER_MATCH_THRESHOLD) {
        const { speaker } = best
        const total = speaker.count + 1
        speaker.embedding = speaker.embedding.map((v, i) => (v * speaker.count + embedding[i]) / total)
        speaker.count = total
        return speaker.label
      }
    }
    this.nextIndex += 1
    const label = `דובר ${this.nextIndex}`
    this.speakers.push({ label, embedding: embedding ?? new Array(24).fill(0), count: embedding ? 1 : 0 })
    return label
  }
}

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = Math.floor(totalSeconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Transcribes one chunk and remaps its (chunk-local, time-relative) turns onto the full recording's
 * timeline and global speaker labels. A chunk that still fails to transcribe after
 * `transcribeWithGemini`'s own retries does NOT fail the whole (possibly hour-plus) recording — it
 * becomes one clearly-marked gap in an otherwise complete transcript.
 */
async function reconcileChunk(chunk: AudioChunk, mimeType: string, registry: GlobalSpeakerRegistry): Promise<TranscriptTurn[]> {
  let raw: string | TranscriptResult
  try {
    raw = await transcribeWithGemini(fs.readFileSync(chunk.path), mimeType)
  } catch (err) {
    console.warn(`[voice] chunk at ${formatClock(chunk.startSeconds)} failed to transcribe, leaving a gap and continuing:`, err)
    const message = err instanceof Error ? err.message : String(err)
    const offsetMs = chunk.startSeconds * 1000
    return [
      {
        speakerLabel: registry.resolve(null),
        text: `${VOICE_TRANSCRIPT_GAP_MARKER} החל מ-${formatClock(chunk.startSeconds)}: ${message}]`,
        timing: { startMs: offsetMs, endMs: offsetMs },
      },
    ]
  }
  const text = typeof raw === 'string' ? raw : raw.text
  const turns = parseTranscriptionTurns(text)
  if (!turns) return [{ speakerLabel: registry.resolve(null), text, timing: null }]

  let embeddingsByLabel = new Map<string, number[]>()
  try {
    const pcm = await decodeToPcm16(chunk.path)
    embeddingsByLabel = labelEmbeddings(turns, extractSpeechSegments(pcm))
  } catch (err) {
    // Best-effort: a chunk whose voiceprint we can't extract still keeps its text, just without
    // cross-chunk speaker matching (each of its labels becomes its own new global speaker).
    console.warn('[voice] chunk voiceprint extraction failed, speaker labels will not match across chunks for this chunk:', err)
  }

  const localToGlobal = new Map<string, string>()
  for (const label of new Set(turns.map((t) => t.speakerLabel))) {
    localToGlobal.set(label, registry.resolve(embeddingsByLabel.get(label) ?? null))
  }

  const offsetMs = chunk.startSeconds * 1000
  return turns.map((turn) => ({
    speakerLabel: localToGlobal.get(turn.speakerLabel) ?? turn.speakerLabel,
    text: turn.text,
    timing: turn.timing ? { startMs: turn.timing.startMs + offsetMs, endMs: turn.timing.endMs + offsetMs } : null,
  }))
}

/**
 * Transcribes a recording longer than `VOICE_CHUNK_THRESHOLD_SECONDS` by splitting it into
 * `VOICE_CHUNK_DURATION_SECONDS`-long pieces, transcribing each one independently (via the same
 * inline/Files-API logic as a normal recording), and reconciling speaker labels and timestamps
 * back onto the original timeline. See docs/specs/voice-chunked-long-transcription.md.
 */
export async function transcribeLongRecordingWithGemini(
  audioPath: string,
  mimeType: string,
  durationSeconds: number,
  onChunkDone?: () => Promise<void>,
): Promise<TranscriptResult> {
  const ext = EXT_BY_MIME[mimeType.split(';')[0].trim().toLowerCase()] || path.extname(audioPath).replace(/^\./, '') || 'webm'
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-voice-chunk-'))
  try {
    const plan = buildChunkPlan(durationSeconds)
    const chunks: AudioChunk[] = []
    for (const [i, { startSeconds, lengthSeconds }] of plan.entries()) {
      const chunkPath = path.join(tmpDir, `chunk_${i}.${ext}`)
      await splitAudioChunk(audioPath, chunkPath, startSeconds, lengthSeconds)
      chunks.push({ path: chunkPath, startSeconds })
    }

    const registry = new GlobalSpeakerRegistry()
    const allTurns: TranscriptTurn[] = []
    for (const chunk of chunks) {
      allTurns.push(...(await reconcileChunk(chunk, mimeType, registry)))
      await onChunkDone?.()
    }
    return turnsToResult(allTurns, allTurns.map((t) => t.text).join('\n'))
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

/**
 * Runs the analysis with the recording's people as candidates and links its participants and
 * action-item owners to them (docs/specs/recording-uses-chosen-people.md). Shared by the first
 * analysis and the text-only refresh after speakers are named.
 */
async function analyzeRecordingTranscript(
  db: Db,
  recordingId: string,
  analyze: VoiceAnalyzer,
  options: Omit<AnalyzeTranscriptOptions, 'candidates'>,
): Promise<{ result: AnalysisResult; participantsJson: string; actionItemsJson: string }> {
  const { candidates, chosen } = await recordingCandidates(db, recordingId)
  const useCandidates = chosen > 0 ? candidates : []
  const result = await analyze({
    ...options,
    ...(useCandidates.length
      ? {
          candidates: useCandidates.map((c) => ({
            id: c.id,
            name: c.name,
            aliases: c.aliases,
            role: c.role ?? null,
            company: c.company ?? null,
          })),
        }
      : {}),
  })
  const linked = await linkAnalysisPeople(db, result, useCandidates)
  return {
    result,
    participantsJson: JSON.stringify(omitSelfParticipants(linked.participants)),
    actionItemsJson: JSON.stringify(linked.actionItems),
  }
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
  options: {
    transcribe?: VoiceTranscriber
    analyze?: VoiceAnalyzer
    /** Injected in tests; defaults to the text-only Gemini pass. */
    attributeSpeakers?: SpeakerAttributor
    now?: number
    retranscribe?: boolean
  } = {},
): Promise<VoiceRecording> {
  const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
  if (!rec) throw new Error('Recording not found')
  const stamp = () => new Date(options.now ?? Date.now()).toISOString()
  await db.update(voiceRecordings).set({ status: 'processing', error: null, updatedAt: stamp() }).where(eq(voiceRecordings.id, rec.id))
  // Rows saved before uploads were probed carry the client's placeholder length (imports sent 11s).
  const needsAudio = !rec.transcriptText || options.retranscribe
  if (needsAudio && !options.transcribe) {
    const probed = await probeAudioDurationSeconds(rec.audioPath)
    if (probed !== null && Math.abs(probed - rec.duration) > 5) {
      rec.duration = Math.round(probed)
      await db.update(voiceRecordings).set({ duration: rec.duration }).where(eq(voiceRecordings.id, rec.id))
    }
  }
  let analysisId: string | null = null
  try {
    let transcribed: TranscriptResult
    // `retranscribe` ignores a stored transcript (e.g. one with failed chunks) and transcribes the audio
    // again. The old transcript stays in place until the new one is saved, so a failure loses nothing.
    if (rec.transcriptText && !options.retranscribe) {
      transcribed = { text: rec.transcriptText, segments: [] }
    } else if (options.transcribe) {
      transcribed = toTranscriptResult(await options.transcribe(fs.readFileSync(rec.audioPath), rec.mimeType))
    } else if (rec.duration > VOICE_CHUNK_THRESHOLD_SECONDS) {
      // Long recording: split into chunks rather than one huge request (see
      // VOICE_CHUNK_THRESHOLD_SECONDS's comment and docs/specs/voice-chunked-long-transcription.md).
      // Read straight from disk per-chunk instead of loading the whole (possibly 100s of MB) file here.
      // Each chunk refreshes `updatedAt` so `voice.retry` doesn't treat a long run as stuck and start a second one.
      transcribed = await transcribeLongRecordingWithGemini(rec.audioPath, rec.mimeType, rec.duration, async () => {
        await db.update(voiceRecordings).set({ updatedAt: stamp() }).where(eq(voiceRecordings.id, rec.id))
      })
    } else {
      transcribed = toTranscriptResult(await transcribeWithGemini(fs.readFileSync(rec.audioPath), rec.mimeType))
    }
    const transcript = transcribed.text
    await db.update(voiceRecordings).set({ transcriptText: transcript, updatedAt: stamp() }).where(eq(voiceRecordings.id, rec.id))
    await saveTranscriptSegments(db, rec.id, transcribed.segments, options.now)

    // Best-effort: never blocks transcription/analysis if it fails (see voice-diarization.ts).
    await runSelfVoiceDetection(db, rec.id).catch((err) => {
      console.warn('[voice] self-voice detection failed:', err)
    })
    await autoIdentifyTwoPersonConversation(db, rec.id).catch((err) => {
      console.warn('[voice] two-person speaker attribution failed:', err)
    })
    // Labels still unknown are matched against the people chosen before upload (text only).
    await attributeSpeakersFromCandidates(db, rec.id, options.attributeSpeakers).catch((err) => {
      console.warn('[voice] chosen-people speaker attribution failed:', err)
    })
    await notifyUnknownSpeakers(db, rec.id).catch((err) => {
      console.warn('[voice] unknown-speaker prompt failed:', err)
    })
    const analysisTranscript = (await attributedTranscript(db, rec.id, transcript)).text

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
        if (projectId && (await sameWorldOrSkip(db, { projectId, meetingId }, 'voice auto-match'))) {
          await db.update(meetings).set({ projectId, updatedAt: stamp() }).where(eq(meetings.id, meetingId))
        }
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
    } else if (projectId && (await sameWorldOrSkip(db, { projectId, meetingId }, 'voice attach'))) {
      await db.update(meetings).set({ projectId, updatedAt: stamp() }).where(eq(meetings.id, meetingId))
    }
    await linkMeetingPeople(db, meetingId, attendees.map((a) => a.id))
    await db
      .update(voiceRecordings)
      .set({ meetingId, createdMeetingId, matchedAutomatically, updatedAt: stamp() })
      .where(eq(voiceRecordings.id, rec.id))

    const [meeting] = await db.select({ title: meetings.title, date: meetings.date }).from(meetings).where(eq(meetings.id, meetingId))
    // Gemini sees who was confirmed on this recording, not every calendar invitee.
    const participantRows = attendees.length
      ? await db
          .select({ name: people.name, role: people.role, company: people.company })
          .from(people)
          .where(inArray(people.id, attendees.map((a) => a.id)))
      : []
    const participantNames = participantRows.map((p) => p.name)
    const knownPeople = participantRows.map((p) => ({
      name: p.name,
      ...(p.role ? { role: p.role } : {}),
      ...(p.company ? { company: p.company } : {}),
    }))
    // Load the project name for Gemini context when a project is attached.
    let projectName: string | undefined
    if (projectId) {
      const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId))
      projectName = proj?.name
    }

    if (rec.analysisId) await db.delete(meetingAnalyses).where(eq(meetingAnalyses.id, rec.analysisId))
    analysisId = newId('ma_voice')
    await db.insert(meetingAnalyses).values({
      id: analysisId,
      meetingId,
      source: 'voice',
      transcriptText: analysisTranscript,
      audioPath: rec.audioPath,
      status: 'pending',
      consentConfirmedAt: rec.consentConfirmedAt,
      createdAt: stamp(),
      updatedAt: stamp(),
    })
    const { result, participantsJson, actionItemsJson } = await analyzeRecordingTranscript(
      db,
      rec.id,
      options.analyze ?? analyzeTranscript,
      {
        transcriptText: analysisTranscript,
        meetingTitle: meeting?.title ?? VOICE_PLACEHOLDER_TITLE,
        meetingDate: meeting?.date ?? rec.createdAt.slice(0, 10),
        participantNames,
        projectName,
        knownPeople,
      },
    )
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
        participantsJson,
        actionItemsJson,
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        status: 'completed',
        updatedAt: stamp(),
      })
      .where(eq(meetingAnalyses.id, analysisId))

    // Update the meeting title from the AI topic only when this is a placeholder meeting
    // created by the recording pipeline (not a calendar event or manually-named meeting).
    // (docs/specs/recording-context-before-upload.md)
    if (
      result.topic &&
      createdMeetingId === meetingId &&
      meeting?.title?.startsWith(VOICE_PLACEHOLDER_TITLE)
    ) {
      const safeTitle = result.topic.trim().slice(0, 120)
      if (safeTitle) {
        await db.update(meetings).set({ title: safeTitle, updatedAt: stamp() }).where(eq(meetings.id, meetingId))
      }
    }

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
 * Re-runs only the text analysis once every transcript speaker has been answered. The recording is
 * never read or transcribed here. Existing analysis data remains untouched if Gemini fails.
 */
export async function refreshVoiceAnalysisAfterSpeakerResolution(
  db: Db,
  recordingId: string,
  options: { analyze?: VoiceAnalyzer; now?: number } = {},
): Promise<boolean> {
  const [rec] = await db
    .select({
      analysisId: voiceRecordings.analysisId,
      meetingId: voiceRecordings.meetingId,
      projectId: voiceRecordings.projectId,
      transcriptText: voiceRecordings.transcriptText,
    })
    .from(voiceRecordings)
    .where(eq(voiceRecordings.id, recordingId))
  if (!rec?.analysisId || !rec.meetingId || !rec.transcriptText) return false

  const attributed = await attributedTranscript(db, recordingId, rec.transcriptText)
  if (!attributed.allResolved || attributed.text === rec.transcriptText) return false

  const [analysis] = await db
    .select({ id: meetingAnalyses.id })
    .from(meetingAnalyses)
    .where(eq(meetingAnalyses.id, rec.analysisId))
  const [meeting] = await db
    .select({ title: meetings.title, date: meetings.date })
    .from(meetings)
    .where(eq(meetings.id, rec.meetingId))
  if (!analysis || !meeting) return false

  const attendees = await recordingPeople(db, recordingId)
  await linkMeetingPeople(db, rec.meetingId, attendees.map((attendee) => attendee.id))
  const participantRows = attendees.length
    ? await db
        .select({ name: people.name, role: people.role, company: people.company })
        .from(people)
        .where(inArray(people.id, attendees.map((attendee) => attendee.id)))
    : []
  let projectName: string | undefined
  if (rec.projectId) {
    const [project] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, rec.projectId))
    projectName = project?.name
  }

  const { result, participantsJson, actionItemsJson } = await analyzeRecordingTranscript(
    db,
    recordingId,
    options.analyze ?? analyzeTranscript,
    {
      transcriptText: attributed.text,
      meetingTitle: meeting.title,
      meetingDate: meeting.date,
      participantNames: participantRows.map((participant) => participant.name),
      projectName,
      knownPeople: participantRows.map((participant) => ({
        name: participant.name,
        ...(participant.role ? { role: participant.role } : {}),
        ...(participant.company ? { company: participant.company } : {}),
      })),
    },
  )
  const stamp = new Date(options.now ?? Date.now()).toISOString()
  await db
    .update(meetingAnalyses)
    .set({
      transcriptText: attributed.text,
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
      participantsJson,
      actionItemsJson,
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      status: 'completed',
      error: null,
      updatedAt: stamp,
    })
    .where(eq(meetingAnalyses.id, rec.analysisId))

  // Replace only proposals that are still awaiting review. Accepted/dismissed history is retained.
  await db
    .delete(commitments)
    .where(
      and(
        eq(commitments.source, 'voice'),
        eq(commitments.sourceId, rec.meetingId),
        eq(commitments.status, 'proposed'),
      ),
    )
  await proposeCommitmentsFromAnalysis(db, rec.analysisId, 'voice')
  return true
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
  if (meetingId && input.projectId) {
    // The owner picked this project by hand — refuse it rather than silently drop it.
    await assertSameWorld(db, { projectId: input.projectId, meetingId })
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
