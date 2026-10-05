/**
 * Self-voice matching (MVP scope, per `docs/specs/recording-background-and-speaker-id.md`):
 * enroll one reference voiceprint (Alpir's own voice), then, for each new recording, detect
 * whether that voice is present and — if so — automatically add Alpir as a tagged participant
 * (`voice_recording_people`, `matchedAutomatically: true`) the same way a manual "attach person"
 * action would. This does NOT rewrite the transcript's "דובר 1/2" labels (which would require
 * frame-accurate diarization aligned to Gemini's un-timestamped text output — a materially bigger
 * problem); it only answers "was this voice present, and how confidently".
 *
 * Runs entirely self-hosted (no external speaker-ID vendor), using `audio-features.ts`'s
 * lightweight spectral-similarity heuristic — see that file's header for its accuracy caveats.
 * Every entry point here is best-effort: failures never block transcription/analysis.
 */
import * as fs from 'fs'
import { and, eq } from 'drizzle-orm'
import { people, voicePrints, voiceRecordingPeople, voiceRecordings, type getDb } from '@ak-system/database'
import { cosineSimilarity, decodeToPcm16, extractOverallEmbedding, extractSpeechSegments, AudioFeatureError } from './audio-features'

type Db = ReturnType<typeof getDb>

export const VOICE_PRINT_MODEL = 'logmel24-cosine-v1'
/** Cosine-similarity cutoff (on log-mel features, not a calibrated neural embedding) for "this segment is the enrolled voice". */
export const SELF_MATCH_THRESHOLD = Number(process.env.VOICE_SELF_MATCH_THRESHOLD ?? '0.82')
/** A recording only counts as "self detected" if at least this much matched speech was found. */
const MIN_SELF_SPEECH_MS = 3000
/** ...and it's at least this fraction of all detected speech (avoids a single stray high-similarity blip). */
const MIN_SELF_SPEECH_RATIO = 0.15

export class VoiceEnrollmentError extends Error {}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function selfPersonId(db: Db): Promise<string> {
  const email = process.env.SELF_PERSON_EMAIL || 'kritzler.alpir@dragontailsystems.com'
  const [existing] = await db.select({ id: people.id }).from(people).where(eq(people.email, email))
  if (existing) return existing.id
  const id = newId('p_self')
  await db.insert(people).values({ id, name: 'אלפיר', email, source: 'manual', status: 'confirmed', createdAt: new Date().toISOString() })
  return id
}

export interface EnrollVoicePrintInput {
  audio: Buffer
  mimeType: string
  now?: number
}

/** Enrolls (or re-enrolls) the single self voiceprint from a short reference sample. */
export async function enrollVoicePrint(db: Db, input: EnrollVoicePrintInput, storageDir: string): Promise<{ id: string }> {
  if (input.audio.length === 0) throw new VoiceEnrollmentError('קובץ הדוגמה ריק')
  const personId = await selfPersonId(db)
  const at = new Date(input.now ?? Date.now()).toISOString()

  fs.mkdirSync(storageDir, { recursive: true })
  const ext = input.mimeType.includes('wav') ? 'wav' : input.mimeType.includes('mpeg') ? 'mp3' : 'm4a'
  const samplePath = `${storageDir}/enroll_${Date.now()}.${ext}`
  fs.writeFileSync(samplePath, input.audio)

  let embedding: number[] | null
  try {
    const pcm = await decodeToPcm16(samplePath)
    embedding = extractOverallEmbedding(pcm)
  } catch (err) {
    throw new VoiceEnrollmentError(err instanceof AudioFeatureError ? err.message : 'עיבוד דגימת הקול נכשל')
  }
  if (!embedding) throw new VoiceEnrollmentError('לא זוהה דיבור בדגימה — נסה הקלטה ארוכה/ברורה יותר')

  const [existing] = await db.select({ id: voicePrints.id }).from(voicePrints).where(eq(voicePrints.personId, personId))
  if (existing) {
    await db
      .update(voicePrints)
      .set({ embedding: JSON.stringify(embedding), sampleAudioPath: samplePath, model: VOICE_PRINT_MODEL, updatedAt: at })
      .where(eq(voicePrints.id, existing.id))
    return { id: existing.id }
  }
  const id = newId('vp')
  await db.insert(voicePrints).values({ id, personId, embedding: JSON.stringify(embedding), sampleAudioPath: samplePath, model: VOICE_PRINT_MODEL, createdAt: at, updatedAt: at })
  return { id }
}

export async function getVoicePrintStatus(db: Db): Promise<{ enrolled: boolean; updatedAt: string | null }> {
  const personId = await selfPersonId(db)
  const [existing] = await db.select({ updatedAt: voicePrints.updatedAt }).from(voicePrints).where(eq(voicePrints.personId, personId))
  return { enrolled: Boolean(existing), updatedAt: existing?.updatedAt ?? null }
}

export async function deleteVoicePrint(db: Db): Promise<void> {
  const personId = await selfPersonId(db)
  await db.delete(voicePrints).where(eq(voicePrints.personId, personId))
}

export interface SelfVoiceMatchResult {
  selfDetected: boolean
  confidence: number | null
  selfSpeechMs: number
  totalSpeechMs: number
}

/**
 * Runs VAD + self-voice comparison against the enrolled voiceprint. Returns `selfDetected: false`
 * (never throws for "no match" cases) whenever there's no enrollment, no detected speech, or the
 * match doesn't clear the threshold/duration bar — callers only need to branch on `selfDetected`.
 */
export async function matchSelfVoice(db: Db, audioPath: string): Promise<SelfVoiceMatchResult> {
  const personId = await selfPersonId(db)
  const [print] = await db.select({ embedding: voicePrints.embedding }).from(voicePrints).where(eq(voicePrints.personId, personId))
  if (!print) return { selfDetected: false, confidence: null, selfSpeechMs: 0, totalSpeechMs: 0 }
  const reference: number[] = JSON.parse(print.embedding)

  const pcm = await decodeToPcm16(audioPath)
  const segments = extractSpeechSegments(pcm)
  let selfSpeechMs = 0
  let totalSpeechMs = 0
  let weightedSimSum = 0
  for (const seg of segments) {
    const durationMs = seg.endMs - seg.startMs
    totalSpeechMs += durationMs
    const sim = cosineSimilarity(seg.embedding, reference)
    if (sim >= SELF_MATCH_THRESHOLD) {
      selfSpeechMs += durationMs
      weightedSimSum += sim * durationMs
    }
  }
  const ratio = totalSpeechMs > 0 ? selfSpeechMs / totalSpeechMs : 0
  const selfDetected = selfSpeechMs >= MIN_SELF_SPEECH_MS && ratio >= MIN_SELF_SPEECH_RATIO
  return {
    selfDetected,
    confidence: selfSpeechMs > 0 ? weightedSimSum / selfSpeechMs : null,
    selfSpeechMs,
    totalSpeechMs,
  }
}

/**
 * Best-effort pass called from the voice-processing pipeline after transcription. Never throws —
 * on any failure it records `diarizationStatus: 'failed'` and leaves the recording's people/
 * transcript untouched (the existing manual "attach person" flow and Gemini's relative "דובר N"
 * labels remain the fallback).
 */
export async function runSelfVoiceDetection(db: Db, recordingId: string): Promise<void> {
  const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
  if (!rec) return
  const now = new Date().toISOString()
  await db.update(voiceRecordings).set({ diarizationStatus: 'pending', diarizationError: null, updatedAt: now }).where(eq(voiceRecordings.id, rec.id))
  try {
    const result = await matchSelfVoice(db, rec.audioPath)
    if (result.selfDetected) {
      const personId = await selfPersonId(db)
      const [already] = await db
        .select({ personId: voiceRecordingPeople.personId })
        .from(voiceRecordingPeople)
        .where(and(eq(voiceRecordingPeople.recordingId, rec.id), eq(voiceRecordingPeople.personId, personId)))
      if (!already) {
        await db.insert(voiceRecordingPeople).values({
          recordingId: rec.id,
          personId,
          matchedAutomatically: true,
          confidence: result.confidence,
        })
      }
    }
    await db.update(voiceRecordings).set({ diarizationStatus: 'completed', updatedAt: new Date().toISOString() }).where(eq(voiceRecordings.id, rec.id))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.update(voiceRecordings).set({ diarizationStatus: 'failed', diarizationError: message, updatedAt: new Date().toISOString() }).where(eq(voiceRecordings.id, rec.id))
  }
}
