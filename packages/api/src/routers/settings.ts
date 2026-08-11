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
import {
  getAgentDisplayNamesMap,
  getAgentDisplayNamesRaw,
  listAgentsWithDisplayNames,
  setAgentDisplayName,
} from '../services/agent-display-names'
import { getBusinessProfile, setBusinessProfile } from '../services/business-profile'
import { getDashboardPrefs, setDashboardPrefs } from '../services/dashboard-prefs'
import { SALES_DOCUMENT_TYPES } from '@ak-system/types'

const timeSchema = z.string().regex(/^\d{2}:\d{2}$/)

const businessProfileSchema = z.object({
  businessName: z.string().default(''),
  businessNameEn: z.string().optional(),
  ownerName: z.string().optional(),
  taxId: z.string().optional(),
  taxIdType: z.enum(['osek_morshe', 'osek_patur', 'company']).optional(),
  address: z.string().optional(),
  addressEn: z.string().optional(),
  city: z.string().optional(),
  zipCode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  website: z.string().optional(),
  logoDataUrl: z.string().optional(),
  bankDetails: z.string().optional(),
  bankDetailsEn: z.string().optional(),
  footerText: z.string().optional(),
  footerTextEn: z.string().optional(),
  defaultPaymentTerms: z.string().optional(),
  defaultLanguage: z.enum(['he', 'en']).optional(),
  numberPrefix: z.string().optional(),
  startNumbers: z.record(z.enum(SALES_DOCUMENT_TYPES), z.number().int().min(1)).optional(),
})

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

  agentDisplayNames: router({
    get: protectedProcedure.query(async () => {
      const [names, rawNames, agents] = await Promise.all([
        getAgentDisplayNamesMap(),
        getAgentDisplayNamesRaw(),
        listAgentsWithDisplayNames(),
      ])
      return { names, rawNames, agents }
    }),

    set: protectedProcedure
      .input(
        z.object({
          agentId: z.string().min(1),
          displayName: z.string().max(40).nullable(),
        }),
      )
      .mutation(async ({ input }) => {
        try {
          const names = await setAgentDisplayName(input.agentId, input.displayName)
          return { names }
        } catch (err) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: err instanceof Error ? err.message : 'שמירת השם נכשלה',
          })
        }
      }),
  }),

  businessProfile: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      return getBusinessProfile(ctx.db)
    }),

    set: protectedProcedure
      .input(businessProfileSchema)
      .mutation(async ({ ctx, input }) => {
        return setBusinessProfile(input, ctx.db)
      }),
  }),

  notifications: router({
    list: protectedProcedure.query(async () => {
      const items = await listNotificationPreferences()
      const agents = await listAgentsWithDisplayNames()
      return { items, channels: await getChannelStatus(), agents: agents.map((a) => ({ id: a.id, name: a.name })) }
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

  dashboard: router({
    get: protectedProcedure.query(async () => getDashboardPrefs()),

    set: protectedProcedure
      .input(
        z.object({
          meetingWindow: z.enum(['today', '3days', 'week']).optional(),
          taskWindow: z.enum(['today', 'all']).optional(),
        }),
      )
      .mutation(async ({ input }) => setDashboardPrefs(input)),
  }),
})
