import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import {
  applyAgentFeedback,
  listAgentFeedback,
  listAgentRules,
  recordAgentFeedback,
  rejectAgentFeedback,
  setAgentRuleEnabled,
} from '../services/agent-feedback'

/** Corrections about agents and the per-agent rules they became (spec: agent-feedback-loop). */
export const agentFeedbackRouter = router({
  record: protectedProcedure
    .input(z.object({ agentId: z.string().min(1), feedback: z.string().min(1).max(5000), channel: z.string().optional() }))
    .mutation(({ ctx, input }) => recordAgentFeedback(ctx.db, input)),

  list: protectedProcedure
    .input(
      z
        .object({ agentId: z.string().optional(), status: z.enum(['pending', 'applied', 'rejected', 'all']).optional() })
        .optional(),
    )
    .query(({ ctx, input }) => listAgentFeedback(ctx.db, input ?? {})),

  apply: protectedProcedure
    .input(z.object({ id: z.string(), rule: z.string().min(1).max(500) }))
    .mutation(({ ctx, input }) => applyAgentFeedback(ctx.db, input.id, input.rule)),

  reject: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await rejectAgentFeedback(ctx.db, input.id)
      return { ok: true }
    }),

  rules: router({
    list: protectedProcedure
      .input(z.object({ agentId: z.string().min(1) }))
      .query(({ ctx, input }) => listAgentRules(ctx.db, input.agentId)),
    setEnabled: protectedProcedure
      .input(z.object({ memoryId: z.string(), enabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        await setAgentRuleEnabled(ctx.db, input.memoryId, input.enabled)
        return { ok: true }
      }),
  }),
})
