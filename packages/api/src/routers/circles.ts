import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure } from '../trpc'
import {
  addGuest,
  addRosterMember,
  applyCalendarDiff,
  dismissCalendarDiff,
  followRosterMember,
  getCircle,
  markAbsent,
  occurrenceAttendance,
  removeException,
  retireRosterMember,
  saveRosterFromCalendar,
  saveRosterFromNames,
} from '../services/series-roster'

const seriesInput = z.object({ seriesId: z.string().min(1) })
const memberInput = z.object({ name: z.string().trim().min(1), email: z.string().trim().email().nullable().optional() })

function notFound(err: unknown): never {
  throw new TRPCError({ code: 'NOT_FOUND', message: err instanceof Error ? err.message : 'Not found' })
}

export const circlesRouter = router({
  get: protectedProcedure.input(seriesInput).query(async ({ ctx, input }) => {
    try {
      return await getCircle(ctx.db, input.seriesId)
    } catch (err) {
      notFound(err)
    }
  }),

  saveFromCalendar: protectedProcedure.input(seriesInput).mutation(async ({ ctx, input }) => {
    try {
      return await saveRosterFromCalendar(ctx.db, input.seriesId)
    } catch (err) {
      notFound(err)
    }
  }),

  saveFromNames: protectedProcedure
    .input(seriesInput.extend({
      names: z.array(z.string().trim().min(1)).min(1).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await saveRosterFromNames(ctx.db, input.seriesId, input.names)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Not found'
        if (message === 'Series not found') notFound(err)
        throw new TRPCError({ code: 'BAD_REQUEST', message })
      }
    }),

  applyCalendarDiff: protectedProcedure.input(seriesInput).mutation(async ({ ctx, input }) => {
    try {
      return await applyCalendarDiff(ctx.db, input.seriesId)
    } catch (err) {
      notFound(err)
    }
  }),

  dismissCalendarDiff: protectedProcedure.input(seriesInput).mutation(async ({ ctx, input }) => {
    await dismissCalendarDiff(ctx.db, input.seriesId)
    return { ok: true }
  }),

  addMember: protectedProcedure
    .input(seriesInput.merge(memberInput))
    .mutation(async ({ ctx, input }) => {
      try {
        return await addRosterMember(ctx.db, input.seriesId, input)
      } catch (err) {
        notFound(err)
      }
    }),

  removeMember: protectedProcedure
    .input(z.object({ rosterId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await retireRosterMember(ctx.db, input.rosterId)
      return { ok: true }
    }),

  follow: protectedProcedure
    .input(z.object({ rosterId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await followRosterMember(ctx.db, input.rosterId)
      } catch (err) {
        notFound(err)
      }
    }),

  attendance: protectedProcedure
    .input(z.object({ meetingId: z.string().min(1) }))
    .query(async ({ ctx, input }) => occurrenceAttendance(ctx.db, input.meetingId)),

  markAbsent: protectedProcedure
    .input(z.object({ meetingId: z.string().min(1), rosterId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await markAbsent(ctx.db, input.meetingId, input.rosterId)
        return { ok: true }
      } catch (err) {
        notFound(err)
      }
    }),

  addGuest: protectedProcedure
    .input(z.object({ meetingId: z.string().min(1) }).merge(memberInput))
    .mutation(async ({ ctx, input }) => {
      await addGuest(ctx.db, input.meetingId, input)
      return { ok: true }
    }),

  removeException: protectedProcedure
    .input(z.object({ exceptionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await removeException(ctx.db, input.exceptionId)
      return { ok: true }
    }),
})
