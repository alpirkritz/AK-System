import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import { meetingAnalyses, voiceRecordings } from '@ak-system/database'
import { router, protectedProcedure } from '../trpc'
import {
  attachCandidates,
  attachVoiceRecording,
  getVoiceRecording,
  listVoiceRecordings,
  processVoiceRecording,
} from '../services/voice'

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

  attachToPeople: protectedProcedure
    .input(z.object({
      recordingId: z.string().min(1),
      personIds: z.array(z.string().min(1)),
      meetingId: z.string().min(1).optional(),
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
        .select({ status: voiceRecordings.status, updatedAt: voiceRecordings.updatedAt })
        .from(voiceRecordings)
        .where(eq(voiceRecordings.id, input.recordingId))
      if (!rec) throw new TRPCError({ code: 'NOT_FOUND', message: 'Recording not found' })
      // A restart mid-run leaves `processing` behind; after this long it is treated as stuck.
      const stuck = Date.now() - Date.parse(rec.updatedAt) > STUCK_PROCESSING_MS
      if (rec.status === 'processing' && !stuck) return { status: rec.status }
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
        participants: parseJson(a.participantsJson),
        actionItems: parseJson(a.actionItemsJson) as { content: string; owner?: string }[],
        status: a.status,
        error: a.error,
      }
    }),
})
