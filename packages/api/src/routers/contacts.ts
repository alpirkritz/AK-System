import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { syncGoogleContacts } from '../services/google-contacts-sync'

export const contactsRouter = router({
  syncGoogle: protectedProcedure
    .input(z.object({ dryRun: z.boolean().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      return syncGoogleContacts({ dryRun: input?.dryRun ?? false }, ctx.db)
    }),
})
