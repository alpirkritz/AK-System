import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import { tasks, meetings, projects, companies } from '@ak-system/database'
import { router, protectedProcedure } from '../trpc'
import { getLocalOverrides, resetNotionField, type SyncEntity } from '../services/notion-local-wins'

const TABLES = { task: tasks, meeting: meetings, project: projects, company: companies } as const

const entityInput = z.object({
  entity: z.enum(['task', 'meeting', 'project', 'company']),
  id: z.string().min(1),
})

async function loadRow(db: Parameters<typeof getLocalOverrides>[0], entity: SyncEntity, id: string) {
  const table = TABLES[entity]
  const [row] = await db.select().from(table).where(eq(table.id, id)).limit(1)
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Row not found' })
  return row as Record<string, unknown>
}

/** Fields the user edited locally that the Notion sync is therefore leaving alone. */
export const notionOverridesRouter = router({
  get: protectedProcedure.input(entityInput).query(async ({ ctx, input }) => {
    const row = await loadRow(ctx.db, input.entity, input.id)
    return { fields: await getLocalOverrides(ctx.db, input.entity, input.id, row) }
  }),

  /** Lets the next Notion sync overwrite this field with Notion's value again. */
  reset: protectedProcedure
    .input(entityInput.extend({ field: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const row = await loadRow(ctx.db, input.entity, input.id)
      await resetNotionField(ctx.db, input.entity, input.id, input.field, row[input.field])
      return { ok: true }
    }),
})
