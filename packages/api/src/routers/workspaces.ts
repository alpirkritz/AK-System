import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure } from '../trpc'
import { workspaces, workspaceNotionDatabases, tasks } from '@ak-system/database'
import { eq } from 'drizzle-orm'
import { listConfiguredTaskDatabases } from '../services/notion-tasks-sync'

const createInput = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  notionAccountLabel: z.string().nullable().optional(),
})

const updateInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  color: z.string().optional(),
  notionAccountLabel: z.string().nullable().optional(),
})

const idInput = z.object({ id: z.string().min(1) })

type LinkRow = { id: string; workspaceId: string; notionDatabaseId: string; notionDatabaseName: string | null }

/** Group link rows by workspace id → the shape attached to each workspace. */
function groupLinks(rows: LinkRow[]): Map<string, Array<{ id: string; notionDatabaseId: string; notionDatabaseName: string | null }>> {
  const map = new Map<string, Array<{ id: string; notionDatabaseId: string; notionDatabaseName: string | null }>>()
  for (const r of rows) {
    const list = map.get(r.workspaceId) ?? []
    list.push({ id: r.id, notionDatabaseId: r.notionDatabaseId, notionDatabaseName: r.notionDatabaseName })
    map.set(r.workspaceId, list)
  }
  return map
}

export const workspacesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.select().from(workspaces).orderBy(workspaces.name)
    const links = (await ctx.db.select().from(workspaceNotionDatabases)) as LinkRow[]
    const byWorkspace = groupLinks(links)
    return rows.map((w) => ({ ...w, notionDatabases: byWorkspace.get(w.id) ?? [] }))
  }),

  getById: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const [row] = await ctx.db.select().from(workspaces).where(eq(workspaces.id, input.id))
    if (!row) return null
    const links = (await ctx.db
      .select()
      .from(workspaceNotionDatabases)
      .where(eq(workspaceNotionDatabases.workspaceId, input.id))) as LinkRow[]
    return {
      ...row,
      notionDatabases: links.map((l) => ({
        id: l.id,
        notionDatabaseId: l.notionDatabaseId,
        notionDatabaseName: l.notionDatabaseName,
      })),
    }
  }),

  /** Notion task databases resolvable from env, annotated with any existing link. */
  listNotionDatabases: protectedProcedure.query(async ({ ctx }) => {
    const configured = listConfiguredTaskDatabases()
    const links = (await ctx.db.select().from(workspaceNotionDatabases)) as LinkRow[]
    const wsRows = await ctx.db.select({ id: workspaces.id, name: workspaces.name }).from(workspaces)
    const wsName = new Map(wsRows.map((w) => [w.id, w.name]))
    const linkByDbId = new Map(links.map((l) => [l.notionDatabaseId, l]))
    return configured.map((d) => {
      const link = linkByDbId.get(d.notionDatabaseId)
      return {
        notionDatabaseId: d.notionDatabaseId,
        name: d.name,
        accountLabel: d.accountLabel,
        linkId: link?.id ?? null,
        linkedWorkspaceId: link?.workspaceId ?? null,
        linkedWorkspaceName: link ? wsName.get(link.workspaceId) ?? null : null,
      }
    })
  }),

  linkNotionDatabase: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        notionDatabaseId: z.string().min(1),
        notionDatabaseName: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(workspaceNotionDatabases)
        .where(eq(workspaceNotionDatabases.notionDatabaseId, input.notionDatabaseId))
      if (existing && existing.workspaceId !== input.workspaceId) {
        throw new TRPCError({ code: 'CONFLICT', message: 'בסיס הנתונים כבר מקושר למקור אחר' })
      }
      if (existing) return existing
      const id = 'wnd' + Date.now() + Math.random().toString(36).slice(2, 7)
      await ctx.db.insert(workspaceNotionDatabases).values({
        id,
        workspaceId: input.workspaceId,
        notionDatabaseId: input.notionDatabaseId,
        notionDatabaseName: input.notionDatabaseName?.trim() || null,
        createdAt: new Date().toISOString(),
      })
      const [row] = await ctx.db
        .select()
        .from(workspaceNotionDatabases)
        .where(eq(workspaceNotionDatabases.id, id))
      return row!
    }),

  unlinkNotionDatabase: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(workspaceNotionDatabases).where(eq(workspaceNotionDatabases.id, input.id))
    return { ok: true }
  }),

  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    const id = 'ws' + Date.now() + Math.random().toString(36).slice(2, 7)
    const now = new Date().toISOString()
    await ctx.db.insert(workspaces).values({
      id,
      name: input.name,
      color: input.color ?? '#2dd4bf',
      notionAccountLabel: input.notionAccountLabel?.trim() || null,
      createdAt: now,
      updatedAt: now,
    })
    const [row] = await ctx.db.select().from(workspaces).where(eq(workspaces.id, id))
    return row!
  }),

  update: protectedProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
    const updates: Partial<typeof workspaces.$inferInsert> = { updatedAt: new Date().toISOString() }
    if (input.name !== undefined) updates.name = input.name
    if (input.color !== undefined) updates.color = input.color
    if (input.notionAccountLabel !== undefined) {
      updates.notionAccountLabel = input.notionAccountLabel?.trim() || null
    }
    await ctx.db.update(workspaces).set(updates).where(eq(workspaces.id, input.id))
    const [row] = await ctx.db.select().from(workspaces).where(eq(workspaces.id, input.id))
    return row ?? null
  }),

  delete: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.update(tasks).set({ workspaceId: null }).where(eq(tasks.workspaceId, input.id))
    await ctx.db.delete(workspaceNotionDatabases).where(eq(workspaceNotionDatabases.workspaceId, input.id))
    await ctx.db.delete(workspaces).where(eq(workspaces.id, input.id))
    return { ok: true }
  }),
})
