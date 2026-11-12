import * as path from 'path'
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import { meetingAnalyses, voiceRecordingPeople, voiceRecordings } from '@ak-system/database'
import { router, protectedProcedure } from '../trpc'
import {
  attachCandidates,
  attachVoiceRecording,
  getMeetingChoice,
  getVoiceRecording,
  hasTranscriptGaps,
  listMeetingChoices,
  listVoiceRecordings,
  processVoiceRecording,
  refreshVoiceAnalysisAfterSpeakerResolution,
  voiceStorageDir,
} from '../services/voice'
import {
  deleteVoicePrint,
  enrollVoicePrint,
  getVoicePrintStatus,
  identifySpeaker,
  identifySpeakers,
  listRecordingSpeakers,
  VoiceEnrollmentError,
} from '../services/voice-diarization'
import { omitSelfParticipants } from '../services/self-person'
import { withPersonNames } from '../services/people-resolve'

const STUCK_PROCESSING_MS = 10 * 60_000

const parseJson = (raw: string | null) => {
  if (!raw) return []
  try {
    return JSON.parse(raw) as unknown[]
  } catch {
    return []
  }
}

/** Upload is `POST /api/voice/upload` (multipart); everything after that goes through here. */
export const voiceRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).optional() }).optional())
    .query(async ({ ctx, input }) => listVoiceRecordings(ctx.db, { limit: input?.limit ?? 20 })),

  listForPerson: protectedProcedure
    .input(z.object({ personId: z.string().min(1), limit: z.number().int().min(1).max(50).optional() }))
    .query(async ({ ctx, input }) => listVoiceRecordings(ctx.db, { personId: input.personId, limit: input.limit ?? 10 })),

  get: protectedProcedure
    .input(z.object({ recordingId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const rec = await getVoiceRecording(ctx.db, input.recordingId)
      if (!rec) throw new TRPCError({ code: 'NOT_FOUND', message: 'Recording not found' })
      return rec
    }),

  attachCandidates: protectedProcedure
    .input(z.object({ recordingId: z.string().min(1) }))
    .query(async ({ ctx, input }) => attachCandidates(ctx.db, input.recordingId)),

  /** Today's meetings offered on the recording screen — tapping one records it directly. */
  meetingChoices: protectedProcedure.query(async ({ ctx }) => ({ meetings: await listMeetingChoices(ctx.db) })),

  /** One meeting for the "record this meeting" deep link, on any date. */
  meetingContext: protectedProcedure
    .input(z.object({ meetingId: z.string().min(1) }))
    .query(async ({ ctx, input }) => getMeetingChoice(ctx.db, input.meetingId)),

  attachToPeople: protectedProcedure
    .input(z.object({
      recordingId: z.string().min(1),
      personIds: z.array(z.string().min(1)),
      meetingId: z.string().min(1).optional(),
      projectId: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await attachVoiceRecording(ctx.db, input)
      } catch (err) {
        throw new TRPCError({ code: 'NOT_FOUND', message: err instanceof Error ? err.message : 'Attach failed' })
      }
    }),

  retry: protectedProcedure
    .input(z.object({ recordingId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [rec] = await ctx.db
        .select({
          status: voiceRecordings.status,
          updatedAt: voiceRecordings.updatedAt,
          transcriptText: voiceRecordings.transcriptText,
        })
        .from(voiceRecordings)
        .where(eq(voiceRecordings.id, input.recordingId))
      if (!rec) throw new TRPCError({ code: 'NOT_FOUND', message: 'Recording not found' })
      // A restart mid-run leaves `processing` behind; after this long it is treated as stuck.
      const stuck = Date.now() - Date.parse(rec.updatedAt) > STUCK_PROCESSING_MS
      if (rec.status === 'processing' && !stuck) return { status: rec.status }
      // A transcript with failed chunks is re-transcribed from the audio; otherwise the stored
      // transcript is reused. The re-transcription of a long recording takes minutes, so it runs
      // in the background (the page polls while status is `processing`) instead of holding the request.
      if (hasTranscriptGaps(rec.transcriptText)) {
        await ctx.db
          .update(voiceRecordings)
          .set({ status: 'processing', error: null, updatedAt: new Date().toISOString() })
          .where(eq(voiceRecordings.id, input.recordingId))
        void processVoiceRecording(ctx.db, input.recordingId, { retranscribe: true }).catch((err) => {
          console.error('[voice] background re-transcription failed:', err)
        })
        return { status: 'processing' as const }
      }
      const after = await processVoiceRecording(ctx.db, input.recordingId)
      return { status: after.status, error: after.error }
    }),

  getAnalysis: protectedProcedure
    .input(z.object({ recordingId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [rec] = await ctx.db.select({ analysisId: voiceRecordings.analysisId }).from(voiceRecordings).where(eq(voiceRecordings.id, input.recordingId))
      if (!rec?.analysisId) return null
      const [a] = await ctx.db.select().from(meetingAnalyses).where(eq(meetingAnalyses.id, rec.analysisId))
      if (!a) return null
      return {
        id: a.id,
        meetingId: a.meetingId,
        hatName: a.hatName,
        topic: a.topic,
        mood: a.mood,
        subtext: a.subtext,
        keyInsight: a.keyInsight,
        score: a.score,
        kaizenKeep: a.kaizenKeep,
        kaizenImprove: a.kaizenImprove,
        openQuestion: a.openQuestion,
        participants: await withPersonNames(
          ctx.db,
          omitSelfParticipants(parseJson(a.participantsJson) as { name: string; confirmed?: boolean; personId?: string }[]),
        ),
        actionItems: await withPersonNames(ctx.db, parseJson(a.actionItemsJson) as { content: string; owner?: string; personId?: string }[]),
        status: a.status,
        error: a.error,
      }
    }),

  // Speaker identification by the user (docs/specs/identify-unknown-speakers.md): the sample is
  // played client-side out of the full audio file, so only times travel over the wire.
  speakers: protectedProcedure
    .input(z.object({ recordingId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const speakers = await listRecordingSpeakers(ctx.db, input.recordingId)
      // `candidate`: the speaker's person is one of the people tagged on the recording.
      const tagged = new Set(
        (
          await ctx.db
            .select({ personId: voiceRecordingPeople.personId })
            .from(voiceRecordingPeople)
            .where(eq(voiceRecordingPeople.recordingId, input.recordingId))
        ).map((row) => row.personId),
      )
      return speakers.map((speaker) => ({ ...speaker, candidate: Boolean(speaker.personId && tagged.has(speaker.personId)) }))
    }),

  identifySpeaker: protectedProcedure
    .input(z.object({
      recordingId: z.string().min(1),
      speakerLabel: z.string().min(1),
      personId: z.string().min(1).nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const identified = await identifySpeaker(ctx.db, input)
      const analysisRefreshed = await refreshVoiceAnalysisAfterSpeakerResolution(ctx.db, input.recordingId)
      return { ...identified, analysisRefreshed }
    }),

  // All speakers matched first, saved with one press (docs/specs/batch-speaker-identification.md).
  // The analysis re-runs once, with whatever names are known; a Gemini failure keeps the answers.
  identifySpeakers: protectedProcedure
    .input(z.object({
      recordingId: z.string().min(1),
      answers: z
        .array(z.object({ speakerLabel: z.string().min(1), personId: z.string().min(1).nullable() }))
        .min(1)
        .max(20),
    }))
    .mutation(async ({ ctx, input }) => {
      const saved = await identifySpeakers(ctx.db, input)
      let analysisRefreshed = false
      let analysisError: string | null = null
      if (saved.length > 0) {
        try {
          analysisRefreshed = await refreshVoiceAnalysisAfterSpeakerResolution(ctx.db, input.recordingId, {
            requireAllResolved: false,
          })
        } catch (err) {
          analysisError = err instanceof Error ? err.message : 'Analysis failed'
          console.warn('[voice.identifySpeakers] analysis refresh failed:', analysisError)
        }
      }
      return { saved, analysisRefreshed, analysisError }
    }),

  // Self-voice enrollment (see docs/specs/recording-background-and-speaker-id.md). MVP: a single
  // enrolled voiceprint (Alpir's own); no per-contact enrollment yet.
  getVoicePrintStatus: protectedProcedure.query(async ({ ctx }) => getVoicePrintStatus(ctx.db)),

  enrollVoicePrint: protectedProcedure
    .input(z.object({ audioBase64: z.string().min(1), mimeType: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await enrollVoicePrint(
          ctx.db,
          { audio: Buffer.from(input.audioBase64, 'base64'), mimeType: input.mimeType },
          path.join(voiceStorageDir(), 'enrollment'),
        )
      } catch (err) {
        if (err instanceof VoiceEnrollmentError) throw new TRPCError({ code: 'BAD_REQUEST', message: err.message })
        throw err
      }
    }),

  deleteVoicePrint: protectedProcedure.mutation(async ({ ctx }) => {
    await deleteVoicePrint(ctx.db)
    return { deleted: true }
  }),
})
