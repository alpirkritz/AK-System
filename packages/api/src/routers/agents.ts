import { z } from 'zod'
import { agentTriggers } from '@ak-system/database'
import { eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure } from '../trpc'
import {
  getDefaultScheduleTimes,
  getDefaultTriggerMessage,
  isAgentSchedulable,
  listAgentSummaries,
  parseJsonTimes,
  stringifyJsonTimes,
} from '../agents-meta'

const scheduleTimesSchema = z.array(z.string().regex(/^\d{2}:\d{2}$/))

function rowToConfig(
  agent: { id: string; name: string; role: string },
  row?: typeof agentTriggers.$inferSelect,
) {
  const schedulable = isAgentSchedulable(agent.id)
  const dbTimes = row ? parseJsonTimes(row.scheduleTimes) : []
  const scheduleTimes =
    dbTimes.length > 0 ? dbTimes : schedulable ? getDefaultScheduleTimes(agent.id) : []

  return {
    agentId: agent.id,
    name: agent.name,
    role: agent.role,
    schedulable,
    enabled: row?.enabled ?? false,
    scheduleTimes,
    triggerMessage: row?.triggerMessage ?? null,
    defaultTriggerMessage: getDefaultTriggerMessage(agent.id),
    lastRunAt: row?.lastRunAt ?? null,
    lastRunStatus: row?.lastRunStatus ?? null,
    lastRunError: row?.lastRunError ?? null,
  }
}

export const agentsRouter = router({
  triggers: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const agents = listAgentSummaries()
      const rows = await ctx.db.select().from(agentTriggers).all()
      const byId = new Map(rows.map((r) => [r.agentId, r]))
      return {
        agents: agents.map((a) => rowToConfig(a, byId.get(a.id))),
      }
    }),

    upsert: protectedProcedure
      .input(
        z.object({
          agentId: z.string().min(1),
          enabled: z.boolean().optional(),
          scheduleTimes: scheduleTimesSchema.optional(),
          triggerMessage: z.string().nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const agents = listAgentSummaries()
        const agent = agents.find((a) => a.id === input.agentId)
        if (!agent) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'סוכן לא נמצא' })
        }

        if (input.scheduleTimes && !isAgentSchedulable(input.agentId)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'סוכן זה אינו תומך בלוח זמנים יומי',
          })
        }

        const existing = await ctx.db
          .select()
          .from(agentTriggers)
          .where(eq(agentTriggers.agentId, input.agentId))
          .limit(1)

        const now = new Date().toISOString()
        const prev = existing[0]
        const scheduleTimes =
          input.scheduleTimes ??
          (prev ? parseJsonTimes(prev.scheduleTimes) : getDefaultScheduleTimes(input.agentId))

        const row = {
          agentId: input.agentId,
          enabled: input.enabled ?? prev?.enabled ?? false,
          scheduleTimes: stringifyJsonTimes(scheduleTimes),
          triggerMessage:
            input.triggerMessage !== undefined
              ? input.triggerMessage
              : (prev?.triggerMessage ?? null),
          lastRunAt: prev?.lastRunAt ?? null,
          lastRunStatus: prev?.lastRunStatus ?? null,
          lastRunError: prev?.lastRunError ?? null,
          updatedAt: now,
        }

        if (prev) {
          await ctx.db
            .update(agentTriggers)
            .set(row)
            .where(eq(agentTriggers.agentId, input.agentId))
        } else {
          await ctx.db.insert(agentTriggers).values(row)
        }

        return rowToConfig(agent, row)
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

        const agents = listAgentSummaries()
        if (!agents.some((a) => a.id === input.agentId)) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'סוכן לא נמצא' })
        }

        return ctx.runAgentTrigger(input.agentId)
      }),

    dueAtTime: protectedProcedure
      .input(z.object({ time: z.string().regex(/^\d{2}:\d{2}$/) }))
      .query(async ({ ctx, input }) => {
        const rows = await ctx.db
          .select()
          .from(agentTriggers)
          .where(eq(agentTriggers.enabled, true))
          .all()

        const agents = listAgentSummaries()
        const nameById = new Map(agents.map((a) => [a.id, a.name]))

        const due = rows
          .filter((row) => {
            const times = parseJsonTimes(row.scheduleTimes)
            return times.includes(input.time)
          })
          .map((row) => ({
            agentId: row.agentId,
            name: nameById.get(row.agentId) ?? row.agentId,
          }))

        return { agents: due }
      }),
  }),
})
