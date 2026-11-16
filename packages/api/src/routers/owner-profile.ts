import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure } from '../trpc'
import {
  applyPrioritiesUpdate,
  buildOwnerProfileBlock,
  getOwnerProfile,
  MAX_PRIORITIES,
  proposePrioritiesUpdate,
  setOwnerProfile,
} from '../services/owner-profile'

const prioritySchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1).max(120),
  projectId: z.string().nullable().optional(),
  workspaceId: z.string().nullable().optional(),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

/** The principal's own record: roles, priorities, principles (spec: owner-priorities-profile). */
export const ownerProfileRouter = router({
  get: protectedProcedure.query(({ ctx }) => getOwnerProfile(ctx.db)),

  set: protectedProcedure
    .input(
      z.object({
        roles: z.string().max(1000).optional(),
        priorities: z.array(prioritySchema).max(MAX_PRIORITIES).optional(),
        principles: z.string().max(1500).optional(),
      }),
    )
    .mutation(({ ctx, input }) => setOwnerProfile(ctx.db, input)),

  /** What every agent sees — for the settings preview. */
  promptBlock: protectedProcedure.query(async ({ ctx }) => ({ block: await buildOwnerProfileBlock(ctx.db) })),

  proposeUpdate: protectedProcedure
    .input(z.object({ priorities: z.array(z.string().trim().min(1).max(120)).min(1).max(MAX_PRIORITIES), reason: z.string().max(500).optional() }))
    .mutation(({ ctx, input }) => proposePrioritiesUpdate(ctx.db, input.priorities)),

  applyUpdate: protectedProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await applyPrioritiesUpdate(ctx.db, input.token)
      } catch (err) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: err instanceof Error ? err.message : 'apply failed' })
      }
    }),
})
