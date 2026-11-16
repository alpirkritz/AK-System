import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { hugoInstructions, memories, memoryLinks, MEMORY_LINK_KINDS } from '@ak-system/database'
import { and, eq, desc, inArray, notInArray } from 'drizzle-orm'
import {
  buildRelevantMemoryBlock,
  clearMemoryRelevanceCache,
  linksForMemories,
  normalizeTopic,
  replaceMemoryLinks,
  resolveNamedEntities,
  recallMemories,
  suggestMemoryLinks,
} from '../services/memory-relevance'
import { acceptProposal, countPendingProposals, rejectProposals, runMemoryDistiller } from '../services/memory-distiller'

const INSTRUCTIONS_ID = 'default'

const kindSchema = z.enum(['instruction', 'memory', 'knowledge'])
const sourceSchema = z.enum(['manual', 'auto', 'chat'])
const linkSchema = z.object({ kind: z.enum(MEMORY_LINK_KINDS), entityId: z.string().min(1) })
type LinkInput = z.infer<typeof linkSchema>

/** Topic ids are stored as normalized tokens ("DD release" → "dd"), so typed topics match runs. */
function normalizeLinks(links: LinkInput[]): LinkInput[] {
  return links.flatMap((l) =>
    l.kind === 'topic' ? normalizeTopic(l.entityId).map((t) => ({ kind: 'topic' as const, entityId: t })) : [l],
  )
}

/** Persistent Hugo memory: standing instructions + memories/knowledge items. */
export const memoryRouter = router({
  instructions: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const [row] = await ctx.db
        .select()
        .from(hugoInstructions)
        .where(eq(hugoInstructions.id, INSTRUCTIONS_ID))
        .limit(1)
      return { content: row?.content ?? '', enabled: row ? !!row.enabled : true }
    }),

    set: protectedProcedure
      .input(z.object({ content: z.string().max(20000), enabled: z.boolean().default(true) }))
      .mutation(async ({ ctx, input }) => {
        const now = new Date().toISOString()
        const [existing] = await ctx.db
          .select()
          .from(hugoInstructions)
          .where(eq(hugoInstructions.id, INSTRUCTIONS_ID))
          .limit(1)
        if (existing) {
          await ctx.db
            .update(hugoInstructions)
            .set({ content: input.content, enabled: input.enabled, updatedAt: now })
            .where(eq(hugoInstructions.id, INSTRUCTIONS_ID))
        } else {
          await ctx.db.insert(hugoInstructions).values({
            id: INSTRUCTIONS_ID,
            content: input.content,
            enabled: input.enabled,
            updatedAt: now,
          })
        }
        return { ok: true }
      }),
  }),

  memories: router({
    list: protectedProcedure
      .input(
        z
          .object({
            kind: kindSchema.optional(),
            limit: z.number().min(1).max(500).default(200),
            personId: z.string().optional(),
            projectId: z.string().optional(),
            workspaceId: z.string().optional(),
            topic: z.string().optional(),
            scope: z.enum(['global', 'scoped']).optional(),
            agentId: z.string().optional(),
            status: z.enum(['active', 'proposed', 'rejected', 'superseded', 'disabled']).default('active'),
          })
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        const limit = input?.limit ?? 200
        const entity = input?.agentId
          ? { kind: 'agent', id: input.agentId }
          : input?.personId
          ? { kind: 'person', id: input.personId }
          : input?.projectId
            ? { kind: 'project', id: input.projectId }
            : input?.workspaceId
              ? { kind: 'workspace', id: input.workspaceId }
              : input?.topic
                ? { kind: 'topic', id: normalizeTopic(input.topic)[0] ?? input.topic.trim().toLowerCase() }
                : null
        const linked = ctx.db.select({ id: memoryLinks.memoryId }).from(memoryLinks)
        const where = entity
          ? inArray(
              memories.id,
              ctx.db
                .select({ id: memoryLinks.memoryId })
                .from(memoryLinks)
                .where(and(eq(memoryLinks.entityKind, entity.kind), eq(memoryLinks.entityId, entity.id))),
            )
          : input?.scope === 'global'
            ? notInArray(memories.id, linked)
            : input?.scope === 'scoped'
              ? inArray(memories.id, linked)
              : undefined
        const rows = await ctx.db
          .select()
          .from(memories)
          .where(and(eq(memories.status, input?.status ?? 'active'), where))
          .orderBy(desc(memories.pinned), desc(memories.updatedAt))
          .limit(limit)
        const filtered = input?.kind ? rows.filter((r) => r.kind === input.kind) : rows
        const links = await linksForMemories(ctx.db, filtered.map((r) => r.id))
        return filtered.map((r) => ({ ...r, pinned: !!r.pinned, links: links.get(r.id) ?? [] }))
      }),

    create: protectedProcedure
      .input(
        z.object({
          content: z.string().min(1).max(20000),
          kind: kindSchema.default('memory'),
          source: sourceSchema.default('manual'),
          pinned: z.boolean().default(false),
          /** Explicit links. Omit to keep the memory global. */
          links: z.array(linkSchema).max(50).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const id = 'mem_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
        const now = new Date().toISOString()
        await ctx.db.insert(memories).values({
          id,
          content: input.content.trim(),
          kind: input.kind,
          source: input.source,
          pinned: input.pinned,
          createdAt: now,
          updatedAt: now,
        })
        if (input.links && input.links.length > 0) {
          await replaceMemoryLinks(ctx.db, id, normalizeLinks(input.links), input.source === 'chat' ? 'tool' : 'manual')
        }
        const [row] = await ctx.db.select().from(memories).where(eq(memories.id, id)).limit(1)
        const links = await linksForMemories(ctx.db, [id])
        return row ? { ...row, pinned: !!row.pinned, links: links.get(id) ?? [] } : null
      }),

    setLinks: protectedProcedure
      .input(z.object({ id: z.string(), links: z.array(linkSchema).max(50) }))
      .mutation(async ({ ctx, input }) => {
        await replaceMemoryLinks(ctx.db, input.id, normalizeLinks(input.links), 'manual')
        await ctx.db
          .update(memories)
          .set({ updatedAt: new Date().toISOString() })
          .where(eq(memories.id, input.id))
        const links = await linksForMemories(ctx.db, [input.id])
        return { links: links.get(input.id) ?? [] }
      }),

    suggestLinks: protectedProcedure
      .input(z.object({ content: z.string().max(20000) }))
      .query(async ({ ctx, input }) => ({ links: await suggestMemoryLinks(ctx.db, input.content) })),

    update: protectedProcedure
      .input(
        z.object({
          id: z.string(),
          content: z.string().min(1).max(20000).optional(),
          kind: kindSchema.optional(),
          pinned: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() }
        if (input.content !== undefined) patch.content = input.content.trim()
        if (input.kind !== undefined) patch.kind = input.kind
        if (input.pinned !== undefined) patch.pinned = input.pinned
        await ctx.db.update(memories).set(patch).where(eq(memories.id, input.id))
        return { ok: true }
      }),

    togglePin: protectedProcedure
      .input(z.object({ id: z.string(), pinned: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .update(memories)
          .set({ pinned: input.pinned, updatedAt: new Date().toISOString() })
          .where(eq(memories.id, input.id))
        return { ok: true }
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        // SQLite runs with foreign_keys OFF, so the FK cascade cannot be relied on.
        await ctx.db.delete(memoryLinks).where(eq(memoryLinks.memoryId, input.id))
        await ctx.db.delete(memories).where(eq(memories.id, input.id))
        clearMemoryRelevanceCache(ctx.db)
        return { ok: true }
      }),
  }),

  /** Memories the nightly distiller proposed (spec: memory-distiller). */
  proposals: router({
    count: protectedProcedure.query(async ({ ctx }) => ({ pending: await countPendingProposals(ctx.db) })),
    accept: protectedProcedure
      .input(z.object({ id: z.string(), content: z.string().min(1).max(20000).optional(), links: z.array(linkSchema).max(50).optional() }))
      .mutation(async ({ ctx, input }) => {
        await acceptProposal(ctx.db, input.id, { content: input.content, links: input.links ? normalizeLinks(input.links) : undefined })
        return { ok: true }
      }),
    reject: protectedProcedure
      .input(z.object({ ids: z.array(z.string()).min(1).max(200) }))
      .mutation(async ({ ctx, input }) => ({ ok: true, count: await rejectProposals(ctx.db, input.ids) })),
  }),

  /** Manual distiller run (testing / catch-up). */
  distill: protectedProcedure
    .input(z.object({ sinceHours: z.number().int().min(1).max(24 * 30).optional() }).optional())
    .mutation(async ({ ctx, input }) => runMemoryDistiller(ctx.db, { sinceHours: input?.sinceHours })),

  /** The exact memory block a run with this message would get, plus the anchors found. */
  relevant: protectedProcedure
    .input(z.object({ message: z.string().max(20000), agentId: z.string().optional() }))
    .query(async ({ ctx, input }) =>
      buildRelevantMemoryBlock(ctx.db, { texts: [input.message], agentId: input.agentId ?? null }),
    ),

  /** Every memory about a named entity (no per-entity cap), plus global memories matching `query`. */
  recall: protectedProcedure
    .input(
      z.object({
        person: z.string().optional(),
        project: z.string().optional(),
        workspace: z.string().optional(),
        topic: z.string().optional(),
        query: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { links, unresolved } = await resolveNamedEntities(ctx.db, {
        people: input.person ? [input.person] : [],
        projects: input.project ? [input.project] : [],
        workspace: input.workspace ?? null,
        topics: input.topic ? [input.topic] : [],
      })
      const result = await recallMemories(ctx.db, { links, query: input.query })
      return { ...result, unresolved }
    }),

  /** Resolve names (as the model writes them) to link targets. */
  resolveNames: protectedProcedure
    .input(
      z.object({
        people: z.array(z.string()).max(20).optional(),
        projects: z.array(z.string()).max(20).optional(),
        workspace: z.string().optional(),
        topics: z.array(z.string()).max(20).optional(),
      }),
    )
    .query(async ({ ctx, input }) => resolveNamedEntities(ctx.db, input)),
})
