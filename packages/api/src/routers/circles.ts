import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure } from '../trpc'
import {
  addGuest,
  applyCalendarDiff,
  circleForMeeting,
  CirclePersonError,
  confirmRosterMember,
  createPersonForCircle,
  dismissCalendarDiff,
  getCircle,
  linkRosterMember,
  markAbsent,
  occurrenceAttendance,
  removeException,
  retireRosterMember,
  saveRosterFromCalendar,
  saveRosterFromPeople,
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

  saveFromPeople: protectedProcedure
    .input(seriesInput.extend({
      personIds: z.array(z.string().min(1)).min(1).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await saveRosterFromPeople(ctx.db, input.seriesId, input.personIds)
      } catch (err) {
        if (err instanceof CirclePersonError) throw new TRPCError({ code: 'BAD_REQUEST', message: err.message })
        notFound(err)
      }
    }),

  createPersonForCircle: protectedProcedure
    .input(z.object({
      name: z.string().trim().min(1).max(200),
      email: z.string().trim().email().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => createPersonForCircle(ctx.db, input)),

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

  removeMember: protectedProcedure
    .input(z.object({ rosterId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await retireRosterMember(ctx.db, input.rosterId)
      return { ok: true }
    }),

  linkMember: protectedProcedure
    .input(z.object({ rosterId: z.string().min(1), personId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await linkRosterMember(ctx.db, input.rosterId, input.personId)
        return { ok: true }
      } catch (err) {
        if (err instanceof CirclePersonError) throw new TRPCError({ code: 'BAD_REQUEST', message: err.message })
        notFound(err)
      }
    }),

  confirmMember: protectedProcedure
    .input(z.object({ rosterId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await confirmRosterMember(ctx.db, input.rosterId)
      } catch (err) {
        notFound(err)
      }
    }),

  forMeeting: protectedProcedure
    .input(z.object({ meetingId: z.string().min(1) }))
    .query(async ({ ctx, input }) => circleForMeeting(ctx.db, input.meetingId)),

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
