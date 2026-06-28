import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { whatsappLabels, whatsappGroups } from '@ak-system/database'
import { eq, asc } from 'drizzle-orm'
import {
  discoverGroups,
  getBridgeStatus,
  pushConfigToBridge,
  isBridgeConfigured,
  type GroupRulePayload,
} from '../services/whatsapp-bridge-client'

function genId(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

function stringifyJsonArray(arr: string[]): string {
  return JSON.stringify(arr)
}

function mapGroupRow(
  row: typeof whatsappGroups.$inferSelect,
  label?: typeof whatsappLabels.$inferSelect | null
) {
  return {
    ...row,
    summaryTimes: parseJsonArray(row.summaryTimes),
    keywords: parseJsonArray(row.keywords),
    labelName: label?.name ?? null,
    labelSummaryTimes: label ? parseJsonArray(label.summaryTimes) : [],
  }
}

async function buildBridgePayload(
  db: import('../trpc').Context['db']
): Promise<GroupRulePayload[]> {
  const rows = await db
    .select({
      group: whatsappGroups,
      label: whatsappLabels,
    })
    .from(whatsappGroups)
    .leftJoin(whatsappLabels, eq(whatsappGroups.labelId, whatsappLabels.id))

  return rows.map(({ group, label }) => ({
    jid: group.jid,
    name: group.name,
    enabled: !!group.enabled,
    fomoEnabled: !!group.fomoEnabled,
    fomoThreshold: group.fomoThreshold,
    fomoWindowMinutes: group.fomoWindowMinutes,
    keywords: parseJsonArray(group.keywords),
    summaryTimes: parseJsonArray(group.summaryTimes),
    labelSummaryTimes: label ? parseJsonArray(label.summaryTimes) : [],
    lastFomoAlertAt: group.lastFomoAlertAt,
  }))
}

const summaryTimesSchema = z.array(z.string().regex(/^\d{2}:\d{2}$/))

export const whatsappRouter = router({
  labels: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const labels = await ctx.db.select().from(whatsappLabels).orderBy(asc(whatsappLabels.name))
      const groups = await ctx.db.select().from(whatsappGroups)
      return labels.map((label) => ({
        ...label,
        summaryTimes: parseJsonArray(label.summaryTimes),
        groupCount: groups.filter((g) => g.labelId === label.id).length,
      }))
    }),

    upsert: protectedProcedure
      .input(
        z.object({
          id: z.string().optional(),
          name: z.string().min(1).max(100),
          summaryTimes: summaryTimesSchema.default([]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const now = new Date().toISOString()
        const id = input.id ?? genId('wl')
        const existing = input.id
          ? await ctx.db.select().from(whatsappLabels).where(eq(whatsappLabels.id, input.id)).limit(1)
          : []
        const row = {
          id,
          name: input.name.trim(),
          summaryTimes: stringifyJsonArray(input.summaryTimes),
          createdAt: existing[0]?.createdAt ?? now,
        }
        if (existing.length > 0) {
          await ctx.db.update(whatsappLabels).set({ name: row.name, summaryTimes: row.summaryTimes }).where(eq(whatsappLabels.id, id))
        } else {
          await ctx.db.insert(whatsappLabels).values(row)
        }
        return { id, ...row, summaryTimes: input.summaryTimes }
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .update(whatsappGroups)
          .set({ labelId: null, updatedAt: new Date().toISOString() })
          .where(eq(whatsappGroups.labelId, input.id))
        await ctx.db.delete(whatsappLabels).where(eq(whatsappLabels.id, input.id))
        return { ok: true }
      }),
  }),

  groups: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({ group: whatsappGroups, label: whatsappLabels })
        .from(whatsappGroups)
        .leftJoin(whatsappLabels, eq(whatsappGroups.labelId, whatsappLabels.id))
        .orderBy(asc(whatsappGroups.name))
      return rows.map(({ group, label }) => mapGroupRow(group, label))
    }),

    discover: protectedProcedure.query(async () => {
      if (!isBridgeConfigured()) {
        throw new Error('WhatsApp bridge not configured')
      }
      return discoverGroups()
    }),

    upsert: protectedProcedure
      .input(
        z.object({
          id: z.string().optional(),
          jid: z.string().min(1),
          name: z.string().min(1),
          labelId: z.string().nullable().optional(),
          enabled: z.boolean().default(false),
          fomoEnabled: z.boolean().default(false),
          fomoThreshold: z.number().int().min(1).max(100).default(5),
          fomoWindowMinutes: z.number().int().min(1).max(60).default(5),
          summaryTimes: summaryTimesSchema.optional(),
          keywords: z.array(z.string()).default([]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const now = new Date().toISOString()
        const id = input.id ?? genId('wg')
        const existing = await ctx.db
          .select()
          .from(whatsappGroups)
          .where(eq(whatsappGroups.jid, input.jid))
          .limit(1)
        const resolvedId = existing[0]?.id ?? id
        const fomoEnabled = input.enabled ? true : input.fomoEnabled
        const row = {
          id: resolvedId,
          jid: input.jid,
          name: input.name.trim(),
          labelId: input.labelId ?? null,
          enabled: input.enabled,
          fomoEnabled,
          fomoThreshold: input.fomoThreshold,
          fomoWindowMinutes: input.fomoWindowMinutes,
          summaryTimes: input.summaryTimes ? stringifyJsonArray(input.summaryTimes) : existing[0]?.summaryTimes ?? null,
          keywords: stringifyJsonArray(input.keywords.map((k) => k.trim()).filter(Boolean)),
          lastFomoAlertAt: existing[0]?.lastFomoAlertAt ?? null,
          updatedAt: now,
        }
        if (existing.length > 0) {
          await ctx.db.update(whatsappGroups).set(row).where(eq(whatsappGroups.id, resolvedId))
        } else {
          await ctx.db.insert(whatsappGroups).values(row)
        }
        return { id: resolvedId }
      }),

    toggle: protectedProcedure
      .input(z.object({ id: z.string(), enabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .update(whatsappGroups)
          .set({
            enabled: input.enabled,
            fomoEnabled: input.enabled,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(whatsappGroups.id, input.id))
        return { ok: true }
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db.delete(whatsappGroups).where(eq(whatsappGroups.id, input.id))
        return { ok: true }
      }),
  }),

  connection: router({
    status: protectedProcedure.query(async () => {
      if (!isBridgeConfigured()) {
        return { configured: false as const, connected: false, selfJid: '', qrAvailable: false, lastError: 'Bridge not configured' }
      }
      try {
        const status = await getBridgeStatus()
        return { configured: true as const, ...status, bridgeUrl: process.env.WHATSAPP_BRIDGE_URL ?? '' }
      } catch (err) {
        return {
          configured: true as const,
          connected: false,
          selfJid: '',
          qrAvailable: false,
          lastError: err instanceof Error ? err.message : 'Status check failed',
          bridgeUrl: process.env.WHATSAPP_BRIDGE_URL ?? '',
        }
      }
    }),
  }),

  sync: router({
    pushToBridge: protectedProcedure.mutation(async ({ ctx }) => {
      if (!isBridgeConfigured()) {
        throw new Error('WhatsApp bridge not configured')
      }
      const groups = await buildBridgePayload(ctx.db)
      await pushConfigToBridge(groups)
      return { ok: true, count: groups.filter((g) => g.enabled).length }
    }),
  }),

  /** Groups due for summary at HH:MM in timezone (used by cron). */
  groupsDueForSummary: protectedProcedure
    .input(z.object({ time: z.string().regex(/^\d{2}:\d{2}$/) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ group: whatsappGroups, label: whatsappLabels })
        .from(whatsappGroups)
        .leftJoin(whatsappLabels, eq(whatsappGroups.labelId, whatsappLabels.id))
      const due: { jid: string; name: string }[] = []
      for (const { group, label } of rows) {
        if (!group.enabled) continue
        const groupTimes = parseJsonArray(group.summaryTimes)
        const labelTimes = label ? parseJsonArray(label.summaryTimes) : []
        const times = groupTimes.length > 0 ? groupTimes : labelTimes
        if (times.includes(input.time)) {
          due.push({ jid: group.jid, name: group.name })
        }
      }
      return due
    }),
})
