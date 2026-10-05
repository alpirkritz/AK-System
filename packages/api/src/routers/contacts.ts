import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { syncGoogleContacts } from '../services/google-contacts-sync'
import { applyGooglePhones, previewGooglePhones } from '../services/google-phone-fill'

export const contactsRouter = router({
  syncGoogle: protectedProcedure
    .input(z.object({ dryRun: z.boolean().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      return syncGoogleContacts({ dryRun: input?.dryRun ?? false }, ctx.db)
    }),

  /** Proposed phone fills for existing people. Does not insert anyone. */
  previewGooglePhones: protectedProcedure.mutation(async ({ ctx }) => {
    return previewGooglePhones(ctx.db)
  }),

  /** Applies a reviewed subset. Phones come from a fresh preview. Names are the edited phone-book names. */
  applyGooglePhones: protectedProcedure
    .input(z.object({
      fills: z.array(z.object({
        personId: z.string().min(1),
        name: z.string().max(200),
      })).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      return applyGooglePhones(ctx.db, input.fills)
    }),
})
