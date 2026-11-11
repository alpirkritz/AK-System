import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure } from '../trpc'
import { workspaces, workspaceNotionDatabases, tasks, personWorkspaces, WORKSPACE_KINDS } from '@ak-system/database'
import { eq } from 'drizzle-orm'
import {
  extractNotionDatabaseId,
  findNotionAccountToken,
  listConfiguredTaskDatabases,
  resolveDatabases,
} from '../services/notion-tasks-sync'
import { fetchDatabaseInfo } from '../services/notion-people-directory'
import { assertValidParent, mergePreview, mergeWorkspaces } from '../services/workspace-scope'

const createInput = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  notionAccountLabel: z.string().nullable().optional(),
  kind: z.enum(WORKSPACE_KINDS).nullable().optional(),
  description: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
})

const updateInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  color: z.string().optional(),
  notionAccountLabel: z.string().nullable().optional(),
  kind: z.enum(WORKSPACE_KINDS).nullable().optional(),
  description: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
})

const idInput = z.object({ id: z.string().min(1) })

type LinkRow = {
  id: string
  workspaceId: string
  notionDatabaseId: string
  notionDatabaseName: string | null
  accountLabel: string | null
}

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

  /** Env task databases plus paste-a-link rows, annotated with any existing workspace link. */
  listNotionDatabases: protectedProcedure.query(async ({ ctx }) => {
    const configured = listConfiguredTaskDatabases()
    const links = (await ctx.db.select().from(workspaceNotionDatabases)) as LinkRow[]
    const wsRows = await ctx.db.select({ id: workspaces.id, name: workspaces.name }).from(workspaces)
    const wsName = new Map(wsRows.map((w) => [w.id, w.name]))
    const linkByDbId = new Map(links.map((l) => [l.notionDatabaseId, l]))
    const envIds = new Set(configured.map((d) => d.notionDatabaseId))
    const env = configured.map((d) => {
      const link = linkByDbId.get(d.notionDatabaseId)
      return {
        source: 'env' as const,
        notionDatabaseId: d.notionDatabaseId,
        name: d.name,
        accountLabel: d.accountLabel,
        linkId: link?.id ?? null,
        linkedWorkspaceId: link?.workspaceId ?? null,
        linkedWorkspaceName: link ? wsName.get(link.workspaceId) ?? null : null,
      }
    })
    const custom = links
      .filter((l) => !envIds.has(l.notionDatabaseId))
      .map((l) => ({
        source: 'custom' as const,
        notionDatabaseId: l.notionDatabaseId,
        name: l.notionDatabaseName ?? l.notionDatabaseId,
        accountLabel: l.accountLabel ?? '',
        linkId: l.id,
        linkedWorkspaceId: l.workspaceId,
        linkedWorkspaceName: wsName.get(l.workspaceId) ?? null,
      }))
    return [...env, ...custom]
  }),

  /**
   * Validates a pasted Notion database link against one account's token and previews its title.
   * Does not write a row — the UI confirms before `addNotionTaskDatabase`.
   */
  resolveNotionTaskDatabaseLink: protectedProcedure
    .input(z.object({ accountLabel: z.string().min(1), link: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const notionDatabaseId = extractNotionDatabaseId(input.link)
      if (!notionDatabaseId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'לא זיהיתי מזהה בסיס נתונים בקישור הזה' })
      }
      const token = findNotionAccountToken(input.accountLabel)
      if (!token) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'חשבון Notion לא נמצא' })
      }
      let info: Awaited<ReturnType<typeof fetchDatabaseInfo>>
      try {
        info = await fetchDatabaseInfo(token, notionDatabaseId)
      } catch {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `האינטגרציה של ${input.accountLabel} לא משותפת לבסיס הנתונים הזה ב-Notion — שתף אותו קודם משם ונסה שוב`,
        })
      }
      const alreadyEnv = resolveDatabases('tasks').some((d) => d.databaseId === notionDatabaseId)
      const [existing] = await ctx.db
        .select({ id: workspaceNotionDatabases.id })
        .from(workspaceNotionDatabases)
        .where(eq(workspaceNotionDatabases.notionDatabaseId, notionDatabaseId))
      return {
        notionDatabaseId,
        name: info.title || notionDatabaseId,
        alreadyAdded: alreadyEnv || !!existing,
      }
    }),

  addNotionTaskDatabase: protectedProcedure
    .input(z.object({
      workspaceId: z.string().min(1),
      accountLabel: z.string().min(1),
      notionDatabaseId: z.string().min(1),
      notionDatabaseName: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!findNotionAccountToken(input.accountLabel)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'חשבון Notion לא נמצא' })
      }
      const [ws] = await ctx.db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, input.workspaceId))
      if (!ws) throw new TRPCError({ code: 'NOT_FOUND', message: 'המקור לא נמצא' })
      const alreadyEnv = resolveDatabases('tasks').some((d) => d.databaseId === input.notionDatabaseId)
      const [existing] = await ctx.db
        .select()
        .from(workspaceNotionDatabases)
        .where(eq(workspaceNotionDatabases.notionDatabaseId, input.notionDatabaseId))
      if (alreadyEnv || existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'בסיס הנתונים כבר רשום' })
      }
      const id = 'wnd' + Date.now() + Math.random().toString(36).slice(2, 7)
      await ctx.db.insert(workspaceNotionDatabases).values({
        id,
        workspaceId: input.workspaceId,
        notionDatabaseId: input.notionDatabaseId,
        notionDatabaseName: input.notionDatabaseName.trim() || null,
        accountLabel: input.accountLabel,
        createdAt: new Date().toISOString(),
      })
      const [row] = await ctx.db.select().from(workspaceNotionDatabases).where(eq(workspaceNotionDatabases.id, id))
      return row!
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
    try {
      await assertValidParent(ctx.db, null, input.parentId ?? null)
    } catch (err) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: err instanceof Error ? err.message : 'שיוך לא תקין' })
    }
    const id = 'ws' + Date.now() + Math.random().toString(36).slice(2, 7)
    const now = new Date().toISOString()
    await ctx.db.insert(workspaces).values({
      id,
      name: input.name,
      color: input.color ?? '#2dd4bf',
      notionAccountLabel: input.notionAccountLabel?.trim() || null,
      kind: input.kind ?? null,
      description: input.description?.trim() || null,
      parentId: input.parentId ?? null,
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
    if (input.kind !== undefined) updates.kind = input.kind
    if (input.description !== undefined) updates.description = input.description?.trim() || null
    if (input.parentId !== undefined) {
      try {
        await assertValidParent(ctx.db, input.id, input.parentId)
      } catch (err) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: err instanceof Error ? err.message : 'שיוך לא תקין' })
      }
      updates.parentId = input.parentId
    }
    await ctx.db.update(workspaces).set(updates).where(eq(workspaces.id, input.id))
    const [row] = await ctx.db.select().from(workspaces).where(eq(workspaces.id, input.id))
    return row ?? null
  }),

  delete: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const children = await ctx.db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.parentId, input.id))
    if (children.length > 0) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'יש סביבות עבודה בתוך העולם הזה. העבר או מחק אותן קודם.' })
    }
    await ctx.db.update(tasks).set({ workspaceId: null }).where(eq(tasks.workspaceId, input.id))
    await ctx.db.delete(workspaceNotionDatabases).where(eq(workspaceNotionDatabases.workspaceId, input.id))
    await ctx.db.delete(personWorkspaces).where(eq(personWorkspaces.workspaceId, input.id))
    await ctx.db.delete(workspaces).where(eq(workspaces.id, input.id))
    return { ok: true }
  }),

  /** Worlds with the workspaces nested under them. Rows with no parent are worlds. */
  tree: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.select().from(workspaces).orderBy(workspaces.name)
    const worlds = rows.filter((w) => !w.parentId)
    return worlds.map((world) => ({
      ...world,
      children: rows.filter((w) => w.parentId === world.id),
    }))
  }),

  mergePreview: protectedProcedure
    .input(z.object({ fromId: z.string().min(1), intoId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      try {
        return await mergePreview(ctx.db, input.fromId, input.intoId)
      } catch (err) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: err instanceof Error ? err.message : 'מיזוג לא אפשרי' })
      }
    }),

  merge: protectedProcedure
    .input(z.object({ fromId: z.string().min(1), intoId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const moved = await mergeWorkspaces(ctx.db, input.fromId, input.intoId)
        return { ok: true, moved }
      } catch (err) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: err instanceof Error ? err.message : 'המיזוג נכשל' })
      }
    }),
})
