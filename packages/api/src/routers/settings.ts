import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure } from '../trpc'
import { getAgentCalendarIds, setAgentCalendarIds } from '../services/agent-calendar-scope'
import {
  listNotificationPreferences,
  upsertNotificationPreference,
  resetNotificationPreferences,
  getChannelStatus,
} from '../services/notification-preferences'
import { listAgentSummaries } from '../agents-meta'

const timeSchema = z.string().regex(/^\d{2}:\d{2}$/)

export const settingsRouter = router({
  agentCalendars: router({
    get: protectedProcedure.query(async () => {
      const calendarIds = await getAgentCalendarIds()
      return { calendarIds }
    }),

    set: protectedProcedure
      .input(z.object({ calendarIds: z.array(z.string()).nullable() }))
      .mutation(async ({ input }) => {
        const calendarIds = await setAgentCalendarIds(input.calendarIds)
        return { calendarIds }
      }),
  }),

  notifications: router({
    list: protectedProcedure.query(async () => {
      const items = await listNotificationPreferences()
      const agents = listAgentSummaries().map((a) => ({ id: a.id, name: a.name }))
      return { items, channels: getChannelStatus(), agents }
    }),

    upsert: protectedProcedure
      .input(
        z.object({
          typeId: z.string().min(1),
          enabled: z.boolean().optional(),
          channels: z
            .object({
              whatsapp: z.boolean().optional(),
              push: z.boolean().optional(),
              telegram: z.boolean().optional(),
            })
            .optional(),
          scheduleTimes: z.array(timeSchema).optional(),
          agentId: z.string().nullable().optional(),
          triggerMessage: z.string().max(4000).nullable().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        try {
          return await upsertNotificationPreference(input)
        } catch (err) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: err instanceof Error ? err.message : 'שמירת ההעדפה נכשלה',
          })
        }
      }),

    resetDefaults: protectedProcedure.mutation(async () => {
      const reset = await resetNotificationPreferences()
      return { reset }
    }),
  }),
})
