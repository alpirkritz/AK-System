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
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  people,
  voicePrints,
  voiceRecordingPeople,
  voiceRecordings,
  voiceSpeakerIdentities,
  voiceTranscriptSegments,
  type VoiceSpeakerState,
  type getDb,
} from '@ak-system/database'
import { cosineSimilarity, decodeToPcm16, extractOverallEmbedding, extractSpeechSegments, AudioFeatureError } from './audio-features'
import { ensureSelfPerson, getSelfPersonName, isSelfPersonName } from './self-person'
import { createNotification } from '../lib/notification-store'

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

const SELF_PERSON_EMAIL = () => process.env.SELF_PERSON_EMAIL || 'kritzler.alpir@dragontailsystems.com'

/** Move a voiceprint and recording tags off a duplicate "אלפיר" row onto the canonical owner. */
async function moveVoiceIdentity(db: Db, fromPersonId: string, toPersonId: string) {
  const [fromPrint] = await db.select({ id: voicePrints.id }).from(voicePrints).where(eq(voicePrints.personId, fromPersonId))
  const [toPrint] = await db.select({ id: voicePrints.id }).from(voicePrints).where(eq(voicePrints.personId, toPersonId))
  if (fromPrint && !toPrint) {
    await db.update(voicePrints).set({ personId: toPersonId }).where(eq(voicePrints.id, fromPrint.id))
  } else if (fromPrint && toPrint) {
    await db.delete(voicePrints).where(eq(voicePrints.id, fromPrint.id))
  }

  const links = await db
    .select({ recordingId: voiceRecordingPeople.recordingId })
    .from(voiceRecordingPeople)
    .where(eq(voiceRecordingPeople.personId, fromPersonId))
  for (const link of links) {
    const [already] = await db
      .select({ recordingId: voiceRecordingPeople.recordingId })
      .from(voiceRecordingPeople)
      .where(and(eq(voiceRecordingPeople.recordingId, link.recordingId), eq(voiceRecordingPeople.personId, toPersonId)))
    if (already) {
      await db
        .delete(voiceRecordingPeople)
        .where(and(eq(voiceRecordingPeople.recordingId, link.recordingId), eq(voiceRecordingPeople.personId, fromPersonId)))
    } else {
      await db
        .update(voiceRecordingPeople)
        .set({ personId: toPersonId })
        .where(and(eq(voiceRecordingPeople.recordingId, link.recordingId), eq(voiceRecordingPeople.personId, fromPersonId)))
    }
  }

  await db.update(voiceSpeakerIdentities).set({ personId: toPersonId }).where(eq(voiceSpeakerIdentities.personId, fromPersonId))
}

/**
 * The owner's contact row. An older enrollment created a person named "אלפיר".
 * When that is the only owner row, it is renamed to Alpir Kritzler. When both
 * rows already exist, the voiceprint moves onto the full-name row.
 */
async function selfPersonId(db: Db): Promise<string> {
  const email = SELF_PERSON_EMAIL()
  const name = getSelfPersonName()
  const [byName] = await db
    .select({ id: people.id })
    .from(people)
    .where(sql`lower(${people.name}) = ${name.toLowerCase()}`)
    .limit(1)
  const [byEmail] = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(eq(people.email, email))
    .limit(1)

  if (byEmail && isSelfPersonName(byEmail.name) && (!byName || byName.id === byEmail.id)) {
    if (byEmail.name !== name) {
      await db.update(people).set({ name }).where(eq(people.id, byEmail.id))
    }
    return byEmail.id
  }

  const canonical = byName ?? (await ensureSelfPerson(db))
  if (byEmail && byEmail.id !== canonical.id && isSelfPersonName(byEmail.name)) {
    await moveVoiceIdentity(db, byEmail.id, canonical.id)
    await db.update(people).set({ email: null }).where(eq(people.id, byEmail.id))
    const [row] = await db.select({ email: people.email }).from(people).where(eq(people.id, canonical.id))
    if (row && !row.email) await db.update(people).set({ email }).where(eq(people.id, canonical.id))
  } else if (!byEmail) {
    const [row] = await db.select({ email: people.email }).from(people).where(eq(people.id, canonical.id))
    if (row && !row.email) await db.update(people).set({ email }).where(eq(people.id, canonical.id))
  }
  return canonical.id
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
  /** Time ranges whose similarity cleared `SELF_MATCH_THRESHOLD`, for aligning against transcript turns. */
  matchedRanges: { startMs: number; endMs: number }[]
}

/**
 * Runs VAD + self-voice comparison against the enrolled voiceprint. Returns `selfDetected: false`
 * (never throws for "no match" cases) whenever there's no enrollment, no detected speech, or the
 * match doesn't clear the threshold/duration bar — callers only need to branch on `selfDetected`.
 */
export async function matchSelfVoice(db: Db, audioPath: string): Promise<SelfVoiceMatchResult> {
  const personId = await selfPersonId(db)
  const [print] = await db.select({ embedding: voicePrints.embedding }).from(voicePrints).where(eq(voicePrints.personId, personId))
  if (!print) return { selfDetected: false, confidence: null, selfSpeechMs: 0, totalSpeechMs: 0, matchedRanges: [] }
  const reference: number[] = JSON.parse(print.embedding)

  const pcm = await decodeToPcm16(audioPath)
  const segments = extractSpeechSegments(pcm)
  const matchedRanges: { startMs: number; endMs: number }[] = []
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
      matchedRanges.push({ startMs: seg.startMs, endMs: seg.endMs })
    }
  }
  const ratio = totalSpeechMs > 0 ? selfSpeechMs / totalSpeechMs : 0
  const selfDetected = selfSpeechMs >= MIN_SELF_SPEECH_MS && ratio >= MIN_SELF_SPEECH_RATIO
  return {
    selfDetected,
    confidence: selfSpeechMs > 0 ? weightedSimSum / selfSpeechMs : null,
    selfSpeechMs,
    totalSpeechMs,
    matchedRanges,
  }
}

/** Fraction of a transcript turn that must overlap self-matched speech before the label counts as "me". */
const SELF_LABEL_MIN_OVERLAP_RATIO = 0.5

/**
 * Which `דובר N` label is the enrolled voice, by overlapping the self-matched time ranges with the
 * transcript's turns. Returns null when no label dominates — the user is then asked about every
 * speaker, which is the safe outcome.
 */
export function resolveSelfSpeakerLabel(
  turns: { speakerLabel: string; startMs: number; endMs: number }[],
  matchedRanges: { startMs: number; endMs: number }[],
): string | null {
  if (turns.length === 0 || matchedRanges.length === 0) return null
  const matchedMs = new Map<string, number>()
  const totalMs = new Map<string, number>()
  for (const turn of turns) {
    const duration = turn.endMs - turn.startMs
    if (duration <= 0) continue
    totalMs.set(turn.speakerLabel, (totalMs.get(turn.speakerLabel) ?? 0) + duration)
    let overlap = 0
    for (const range of matchedRanges) {
      overlap += Math.max(0, Math.min(turn.endMs, range.endMs) - Math.max(turn.startMs, range.startMs))
    }
    matchedMs.set(turn.speakerLabel, (matchedMs.get(turn.speakerLabel) ?? 0) + Math.min(overlap, duration))
  }
  const ranked = [...matchedMs.entries()].sort((a, b) => b[1] - a[1])
  const [label, overlap] = ranked[0]
  if (overlap <= 0) return null
  return overlap / (totalMs.get(label) ?? overlap) >= SELF_LABEL_MIN_OVERLAP_RATIO ? label : null
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
      const turns = await db
        .select({ speakerLabel: voiceTranscriptSegments.speakerLabel, startMs: voiceTranscriptSegments.startMs, endMs: voiceTranscriptSegments.endMs })
        .from(voiceTranscriptSegments)
        .where(eq(voiceTranscriptSegments.recordingId, rec.id))
      const selfLabel = resolveSelfSpeakerLabel(turns, result.matchedRanges)
      if (selfLabel) await upsertSpeakerIdentity(db, rec.id, selfLabel, personId, 'auto')
    }
    await db.update(voiceRecordings).set({ diarizationStatus: 'completed', updatedAt: new Date().toISOString() }).where(eq(voiceRecordings.id, rec.id))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.update(voiceRecordings).set({ diarizationStatus: 'failed', diarizationError: message, updatedAt: new Date().toISOString() }).where(eq(voiceRecordings.id, rec.id))
  }
}

async function upsertSpeakerIdentity(
  db: Db,
  recordingId: string,
  speakerLabel: string,
  personId: string | null,
  state: VoiceSpeakerState,
): Promise<void> {
  const [existing] = await db
    .select({ id: voiceSpeakerIdentities.id })
    .from(voiceSpeakerIdentities)
    .where(and(eq(voiceSpeakerIdentities.recordingId, recordingId), eq(voiceSpeakerIdentities.speakerLabel, speakerLabel)))
  if (existing) {
    await db.update(voiceSpeakerIdentities).set({ personId, state }).where(eq(voiceSpeakerIdentities.id, existing.id))
    return
  }
  await db.insert(voiceSpeakerIdentities).values({
    id: newId('vsi'),
    recordingId,
    speakerLabel,
    personId,
    state,
    createdAt: new Date().toISOString(),
  })
}

/** `unknown` means the user has not answered for this speaker yet. */
export type SpeakerPromptState = VoiceSpeakerState | 'unknown'

export interface RecordingSpeaker {
  speakerLabel: string
  state: SpeakerPromptState
  personId: string | null
  personName: string | null
  /** Longest turn of this speaker — the best shot at recognising the voice. */
  sampleStartMs: number
  sampleEndMs: number
  sampleText: string
  segmentCount: number
}

/** Speakers of a recording in label order, each with its longest turn as a playable sample. */
export async function listRecordingSpeakers(db: Db, recordingId: string): Promise<RecordingSpeaker[]> {
  const segments = await db
    .select()
    .from(voiceTranscriptSegments)
    .where(eq(voiceTranscriptSegments.recordingId, recordingId))
  if (segments.length === 0) return []
  const identities = await db
    .select()
    .from(voiceSpeakerIdentities)
    .where(eq(voiceSpeakerIdentities.recordingId, recordingId))
  const personIds = [...new Set(identities.map((identity) => identity.personId).filter((id): id is string => Boolean(id)))]
  const personNames = new Map(
    personIds.length
      ? (await db.select({ id: people.id, name: people.name }).from(people).where(inArray(people.id, personIds))).map((person) => [
          person.id,
          person.name,
        ])
      : [],
  )

  const byLabel = new Map<string, typeof segments>()
  for (const seg of segments) {
    const list = byLabel.get(seg.speakerLabel)
    if (list) list.push(seg)
    else byLabel.set(seg.speakerLabel, [seg])
  }
  return [...byLabel.entries()]
    .map(([speakerLabel, turns]) => {
      const longest = turns.reduce((best, s) => (s.endMs - s.startMs > best.endMs - best.startMs ? s : best))
      const identity = identities.find((i) => i.speakerLabel === speakerLabel)
      return {
        speakerLabel,
        state: (identity?.state ?? 'unknown') as SpeakerPromptState,
        personId: identity?.personId ?? null,
        personName: identity?.personId ? personNames.get(identity.personId) ?? null : null,
        sampleStartMs: longest.startMs,
        sampleEndMs: longest.endMs,
        sampleText: longest.text,
        segmentCount: turns.length,
      }
    })
    .sort((a, b) => a.speakerLabel.localeCompare(b.speakerLabel, 'he'))
}

/**
 * Conservatively resolves the other speaker in a one-on-one recording. The inference is allowed
 * only when the enrolled owner's voice already resolved one of exactly two transcript labels and
 * the recording has exactly one other confirmed person. Anything less certain stays manual.
 */
export async function autoIdentifyTwoPersonConversation(db: Db, recordingId: string): Promise<boolean> {
  const segments = await db
    .select({ speakerLabel: voiceTranscriptSegments.speakerLabel })
    .from(voiceTranscriptSegments)
    .where(eq(voiceTranscriptSegments.recordingId, recordingId))
  const labels = [...new Set(segments.map((segment) => segment.speakerLabel))]
  if (labels.length !== 2) return false

  const ownerPersonId = await selfPersonId(db)
  const [ownerPrint] = await db
    .select({ personId: voicePrints.personId })
    .from(voicePrints)
    .where(eq(voicePrints.personId, ownerPersonId))
  if (!ownerPrint) return false
  const identities = await db
    .select()
    .from(voiceSpeakerIdentities)
    .where(eq(voiceSpeakerIdentities.recordingId, recordingId))
  const ownerIdentity = identities.find(
    (identity) =>
      identity.state === 'auto' &&
      identity.personId === ownerPrint.personId &&
      labels.includes(identity.speakerLabel),
  )
  if (!ownerIdentity) return false

  const otherLabel = labels.find((label) => label !== ownerIdentity.speakerLabel)
  if (!otherLabel || identities.some((identity) => identity.speakerLabel === otherLabel)) return false

  const linkedPeople = await db
    .select({ personId: voiceRecordingPeople.personId })
    .from(voiceRecordingPeople)
    .innerJoin(people, eq(people.id, voiceRecordingPeople.personId))
    .where(and(eq(voiceRecordingPeople.recordingId, recordingId), eq(people.status, 'confirmed')))
  const candidates = [...new Set(linkedPeople.map((link) => link.personId))].filter(
    (personId) => personId !== ownerPrint.personId,
  )
  if (candidates.length !== 1) return false

  await upsertSpeakerIdentity(db, recordingId, otherLabel, candidates[0], 'auto')
  return true
}

/**
 * Builds analysis-only text with known speaker names. The stored transcript remains unchanged.
 * Skipped labels deliberately keep their original `דובר N` prefix.
 */
export async function attributedTranscript(
  db: Db,
  recordingId: string,
  transcriptText: string,
): Promise<{ text: string; allResolved: boolean }> {
  const speakers = await listRecordingSpeakers(db, recordingId)
  if (speakers.length === 0) return { text: transcriptText, allResolved: false }
  const allResolved = speakers.every((speaker) => speaker.state !== 'unknown')
  const names = new Map(
    speakers
      .filter((speaker) => speaker.state !== 'skipped' && speaker.personName)
      .map((speaker) => [speaker.speakerLabel, speaker.personName!]),
  )
  const text = transcriptText
    .split('\n')
    .map((line) => {
      for (const [speakerLabel, personName] of names) {
        const prefix = `${speakerLabel}:`
        if (line.startsWith(prefix)) return `${personName}:${line.slice(prefix.length)}`
      }
      return line
    })
    .join('\n')
  return { text, allResolved }
}

/**
 * Records the user's answer for one speaker. A chosen person is also tagged on the recording
 * itself, so the recording ends up linked to everyone the user recognised.
 */
export async function identifySpeaker(
  db: Db,
  input: { recordingId: string; speakerLabel: string; personId: string | null },
): Promise<{ state: Extract<VoiceSpeakerState, 'identified' | 'skipped'> }> {
  const personId = input.personId
    ? (await db.select({ id: people.id }).from(people).where(eq(people.id, input.personId)))[0]?.id ?? null
    : null
  const state = personId ? 'identified' : 'skipped'
  await upsertSpeakerIdentity(db, input.recordingId, input.speakerLabel, personId, state)
  if (personId) {
    const [already] = await db
      .select({ personId: voiceRecordingPeople.personId })
      .from(voiceRecordingPeople)
      .where(and(eq(voiceRecordingPeople.recordingId, input.recordingId), eq(voiceRecordingPeople.personId, personId)))
    if (!already) await db.insert(voiceRecordingPeople).values({ recordingId: input.recordingId, personId })
  }
  return { state }
}

/**
 * Asks the user to name the speakers the system could not. Stamped on the recording so a retry or a
 * second pass never asks twice.
 */
export async function notifyUnknownSpeakers(db: Db, recordingId: string): Promise<boolean> {
  const [rec] = await db
    .select({ speakerPromptSentAt: voiceRecordings.speakerPromptSentAt })
    .from(voiceRecordings)
    .where(eq(voiceRecordings.id, recordingId))
  if (!rec || rec.speakerPromptSentAt) return false
  const unknown = (await listRecordingSpeakers(db, recordingId)).filter((s) => s.state === 'unknown')
  if (unknown.length === 0) return false

  await db
    .update(voiceRecordings)
    .set({ speakerPromptSentAt: new Date().toISOString() })
    .where(eq(voiceRecordings.id, recordingId))
  await createNotification({
    title: 'מי מדבר בהקלטה?',
    body:
      unknown.length === 1
        ? `יש דובר אחד שלא זוהה (${unknown[0].speakerLabel}). שמע דגימה וספר לי מי זה.`
        : `יש ${unknown.length} דוברים שלא זוהו. שמע דגימה וספר לי מי הם.`,
    url: `/voice?recording=${recordingId}`,
    type: 'system',
  })
  return true
}
