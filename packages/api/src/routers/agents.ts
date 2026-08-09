import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure } from '../trpc'
import { listAgentsWithDisplayNames } from '../services/agent-display-names'
import {
  isRoutableEvent,
  listAgentConfigs,
  listAgentsDueAtTime,
  migrateAgentSchedulesOnce,
  setAgentSchedule,
  setEventSubscription,
  type AgentScheduleConfig,
} from '../services/agent-schedules'

/** Zero-padded 24-hour HH:MM — anything else could never match a cron slot. */
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const scheduleTimesSchema = z.array(timeSchema).max(24)

async function requireAgent(agentId: string) {
  const agents = await listAgentsWithDisplayNames()
  const agent = agents.find((a) => a.id === agentId)
  if (!agent) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'סוכן לא נמצא' })
  }
  return { agent, agents }
}

export const agentsRouter = router({
  /**
   * Every agent card found in A_Agents/ with its clock schedule and the events
   * routed to it, plus the routable event catalog. One call feeds the whole
   * management screen.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    await migrateAgentSchedulesOnce(ctx.db)
    const agents = await listAgentsWithDisplayNames()
    return listAgentConfigs(agents, ctx.db)
  }),

  setSchedule: protectedProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        enabled: z.boolean().optional(),
        scheduleTimes: scheduleTimesSchema.optional(),
        triggerMessage: z.string().max(4000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<AgentScheduleConfig> => {
      const { agent } = await requireAgent(input.agentId)

      const { agents: before } = await listAgentConfigs([agent], ctx.db)
      const current = before[0]!
      const nextEnabled = input.enabled ?? current.enabled
      const nextTimes = input.scheduleTimes ?? current.scheduleTimes
      if (nextEnabled && nextTimes.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'יש להגדיר לפחות שעה אחת כדי להפעיל לוח זמנים',
        })
      }

      await setAgentSchedule(input, ctx.db)
      const { agents: after } = await listAgentConfigs([agent], ctx.db)
      return after[0]!
    }),

  setEventSubscription: protectedProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        typeId: z.string().min(1),
        subscribed: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireAgent(input.agentId)
      if (!isRoutableEvent(input.typeId)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'סוג התראה זה אינו תומך בניתוב לסוכן',
        })
      }
      return setEventSubscription(input, ctx.db)
    }),

  run: protectedProcedure
    .input(z.object({ agentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.runAgentTrigger) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Agent runner not configured',
        })
      }
      await requireAgent(input.agentId)
      return ctx.runAgentTrigger(input.agentId)
    }),

  dueAtTime: protectedProcedure
    .input(z.object({ time: timeSchema }))
    .query(async ({ ctx, input }) => {
      const rows = await listAgentsDueAtTime(input.time, ctx.db)
      const agents = await listAgentsWithDisplayNames()
      const nameById = new Map(agents.map((a) => [a.id, a.name]))

      return {
        agents: rows.map((row) => ({
          agentId: row.agentId,
          name: nameById.get(row.agentId) ?? row.agentId,
        })),
      }
    }),
})
