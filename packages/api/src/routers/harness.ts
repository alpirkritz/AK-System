/**
 * Harness — the unified cross-domain context API.
 *
 * `worldState` is what an agent should read instead of assembling its own snapshot:
 * one call returns how much of each domain is indexed, how fresh it is, and what the
 * reasoner currently considers worth acting on.
 */
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'
import { HARNESS_SCOPES, indexHarnessWorld, personSignals, worldStateSummary, type HarnessScope } from '../services/harness-context'
import { isGragMirrorEnabled } from '../services/harness-grag'
import { dismissInsight, insightKindStats, listOpenInsights, markInsightActed, reasonAndPersist } from '../services/harness-reasoner'
import { readHarnessStamps } from '../services/harness-stamps'
import { projectContext, topicContext } from '../services/harness-entity-context'
import { resolveNamedEntities } from '../services/memory-relevance'

const severitySchema = z.enum(['info', 'attention', 'urgent'])
const scopeSchema = z.enum(HARNESS_SCOPES as [HarnessScope, ...HarnessScope[]])

export const harnessRouter = router({
  /** Everything an agent needs about the current state of the world, in one read. */
  worldState: protectedProcedure
    .input(z.object({ insightLimit: z.number().int().min(1).max(20).default(5) }).optional())
    .query(async ({ ctx, input }) => {
      const [summary, insights, stamps, kindStats] = await Promise.all([
        worldStateSummary(ctx.db),
        listOpenInsights(ctx.db, { limit: input?.insightLimit ?? 5 }),
        readHarnessStamps(ctx.db),
        insightKindStats(ctx.db),
      ])
      const totalNodes = Object.values(summary.nodesByKind).reduce((a, b) => a + b, 0)
      return {
        ...summary,
        totalNodes,
        totalEdges: Object.values(summary.edgesByKind).reduce((a, b) => a + b, 0),
        insights,
        indexedAt: stamps.indexedAt,
        reasonedAt: stamps.reasonedAt,
        kindStats,
        gragMirror: isGragMirrorEnabled(),
      }
    }),

  insights: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20), severity: severitySchema.optional() }).optional())
    .query(async ({ ctx, input }) =>
      listOpenInsights(ctx.db, { limit: input?.limit ?? 20, severity: input?.severity }),
    ),

  /** Every world-model node reachable from one person — meetings, commitments, chat. */
  personSignals: protectedProcedure
    .input(z.object({ personId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const signals = await personSignals(ctx.db, input.personId)
      if (!signals) throw new TRPCError({ code: 'NOT_FOUND', message: 'Person not found' })
      const insights = await listOpenInsights(ctx.db, { limit: 10 })
      return { ...signals, insights: insights.filter((i) => i.personId === input.personId) }
    }),

  /** Brief, tasks, meetings, people, insights and memories for one project (by id or name). */
  projectContext: protectedProcedure
    .input(z.object({ projectId: z.string().optional(), name: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      let id = input.projectId
      if (!id && input.name) {
        const { links } = await resolveNamedEntities(ctx.db, { projects: [input.name] })
        id = links[0]?.entityId
      }
      return id ? projectContext(ctx.db, id) : { notFound: true as const }
    }),

  /** Meetings, tasks, WhatsApp groups and memories that carry one topic token. */
  topicContext: protectedProcedure
    .input(z.object({ topic: z.string().min(1) }))
    .query(async ({ ctx, input }) => topicContext(ctx.db, input.topic)),

  /** Manual re-index. The cron does this on a schedule; this is the "now" button. */
  syncToGraph: protectedProcedure
    .input(z.object({ scopes: z.array(scopeSchema).optional(), windowDays: z.number().int().min(1).max(365).optional() }).optional())
    .mutation(async ({ ctx, input }) =>
      indexHarnessWorld(ctx.db, { scopes: input?.scopes, windowDays: input?.windowDays }),
    ),

  /** Re-run the detectors without waiting for the cron. */
  runReasoner: protectedProcedure
    .input(z.object({ phraseChangedOnly: z.boolean().default(false) }).optional())
    .mutation(async ({ ctx, input }) => {
    const result = await reasonAndPersist(ctx.db, new Date(), { phraseChangedOnly: input?.phraseChangedOnly ?? false })
    return { created: result.created, updated: result.updated, model: result.model, count: result.insights.length }
  }),

  /** "טיפלתי" — the positive half of the feedback signal (spec: agent-episodes). */
  markActed: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const ok = await markInsightActed(ctx.db, input.id)
      if (!ok) throw new TRPCError({ code: 'NOT_FOUND', message: 'Insight not found' })
      return { ok: true }
    }),

  dismissInsight: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const ok = await dismissInsight(ctx.db, input.id)
      if (!ok) throw new TRPCError({ code: 'NOT_FOUND', message: 'Insight not found' })
      return { ok: true }
    }),
})
