/**
 * Read-side of a recording's transcript: what the meeting page and /voice show under "תמלול מלא".
 * Spec: docs/specs/meeting-full-transcript-view.md. Read-only over voice_recordings,
 * voice_transcript_segments and the speaker identities — it never depends on diarization having
 * succeeded, so a recording whose speaker detection failed still shows its plain transcript.
 */
import { asc, desc, eq, or } from 'drizzle-orm'
import { voiceRecordings, voiceTranscriptSegments, type getDb } from '@ak-system/database'
import { listRecordingSpeakers } from './voice-diarization'

type Db = ReturnType<typeof getDb>

export interface TranscriptSegmentView {
  /** The label the model returned (`דובר 1`) — stable key for grouping/colouring. */
  speakerKey: string
  /** The identified person's name, or null when the speaker is unknown or was skipped. */
  speakerName: string | null
  startMs: number
  endMs: number
  text: string
}

export interface RecordingTranscript {
  recordingId: string
  status: string
  error: string | null
  diarizationStatus: string
  /** `transcript_text` — the fallback when there are no segments. */
  text: string | null
  segments: TranscriptSegmentView[]
}

export async function getRecordingTranscript(db: Db, recordingId: string): Promise<RecordingTranscript | null> {
  const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
  if (!rec) return null

  const rows = await db
    .select()
    .from(voiceTranscriptSegments)
    .where(eq(voiceTranscriptSegments.recordingId, recordingId))
    .orderBy(asc(voiceTranscriptSegments.startMs))

  // A speaker the user skipped stays anonymous even if a name was once resolved for the label.
  const names = new Map<string, string>()
  if (rows.length > 0) {
    for (const speaker of await listRecordingSpeakers(db, recordingId)) {
      if (speaker.state !== 'skipped' && speaker.personName) names.set(speaker.speakerLabel, speaker.personName)
    }
  }

  return {
    recordingId: rec.id,
    status: rec.status,
    error: rec.error ?? null,
    diarizationStatus: rec.diarizationStatus,
    text: rec.transcriptText ?? null,
    segments: rows.map((row) => ({
      speakerKey: row.speakerLabel,
      speakerName: names.get(row.speakerLabel) ?? null,
      startMs: row.startMs,
      endMs: row.endMs,
      text: row.text,
    })),
  }
}

/** Recordings linked to a meeting — chosen/attached (`meeting_id`) or created for it. Newest first. */
export async function listRecordingsForMeeting(db: Db, meetingId: string) {
  const rows = await db
    .select({
      id: voiceRecordings.id,
      createdAt: voiceRecordings.createdAt,
      duration: voiceRecordings.duration,
      status: voiceRecordings.status,
    })
    .from(voiceRecordings)
    .where(or(eq(voiceRecordings.meetingId, meetingId), eq(voiceRecordings.createdMeetingId, meetingId)))
    .orderBy(desc(voiceRecordings.createdAt))
  return rows
}
