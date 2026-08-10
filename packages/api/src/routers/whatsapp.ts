import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { whatsappLabels, whatsappGroups, whatsappMessages, chatMessages } from '@ak-system/database'
import { eq, asc, and, gte, lte, inArray } from 'drizzle-orm'
import { generateGroupInsight, generateCrossGroupDigest } from '../services/whatsapp-insights'
import { WHATSAPP_WINDOWS, resolveWhatsappTimeWindow } from '../lib/whatsapp-time-window'
import {
  discoverGroups,
  getBridgeStatus,
  getBridgeWatchedGroups,
  pushConfigToBridge,
  isBridgeConfigured,
  summarizeAllGroups,
  summarizeGroup,
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

/** Shared time-range input for the insight procedures. */
const timeRangeInput = {
  sinceHour: z.number().int().min(0).max(23).optional(),
  untilHour: z.number().int().min(1).max(24).optional(),
}

function genMsgId(): string {
  return 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
}

/** Persist a generated insight into the unified chat timeline. */
async function saveInsightToChat(
  db: import('../trpc').Context['db'],
  content: string,
): Promise<void> {
  try {
    await db.insert(chatMessages).values({
      id: genMsgId(),
      role: 'assistant',
      content,
      source: 'whatsapp',
      createdAt: new Date().toISOString(),
    })
  } catch (err) {
    console.warn('[whatsapp.insights] failed to save to chat_messages:', err)
  }
}

/** Compute an importance score for cross-group ranking. */
function computeGroupScore(
  messages: { text: string; ts: number }[],
  keywords: string[],
  priority: number,
  nowMs: number,
): number {
  if (messages.length === 0) return 0
  const volume = messages.length
  const kw = keywords.map((k) => k.toLowerCase()).filter(Boolean)
  const keywordHits = kw.length
    ? messages.filter((m) => {
        const t = m.text.toLowerCase()
        return kw.some((k) => t.includes(k))
      }).length
    : 0
  const latest = messages.reduce((mx, m) => Math.max(mx, m.ts), 0)
  const ageHours = latest > 0 ? (nowMs - latest) / (60 * 60 * 1000) : 999
  const recencyBoost = ageHours < 1 ? 5 : ageHours < 6 ? 3 : ageHours < 24 ? 1 : 0
  return volume + keywordHits * 3 + priority * 10 + recencyBoost
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
          priority: z.number().int().min(0).max(2).optional(),
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
          priority: input.priority ?? existing[0]?.priority ?? 0,
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
        // Cascade-delete the group's stored messages (privacy: leave nothing behind).
        const rows = await ctx.db
          .select({ jid: whatsappGroups.jid })
          .from(whatsappGroups)
          .where(eq(whatsappGroups.id, input.id))
          .limit(1)
        const jid = rows[0]?.jid
        if (jid) {
          await ctx.db.delete(whatsappMessages).where(eq(whatsappMessages.groupJid, jid))
        }
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

    /** Drift check: how many groups are enabled in the DB vs actually watched by the bridge. */
    status: protectedProcedure.query(async ({ ctx }) => {
      const rows = await ctx.db.select().from(whatsappGroups)
      const dbEnabledCount = rows.filter((g) => g.enabled).length
      if (!isBridgeConfigured()) {
        return { configured: false as const, dbEnabledCount, bridgeWatchedCount: 0, inSync: false }
      }
      try {
        const watched = await getBridgeWatchedGroups()
        return {
          configured: true as const,
          dbEnabledCount,
          bridgeWatchedCount: watched.length,
          inSync: watched.length === dbEnabledCount,
        }
      } catch (err) {
        return {
          configured: true as const,
          dbEnabledCount,
          bridgeWatchedCount: 0,
          inSync: false,
          error: err instanceof Error ? err.message : 'Bridge status failed',
        }
      }
    }),
  }),

  summaries: router({
    trigger: protectedProcedure
      .input(z.object({ groupJid: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        if (!isBridgeConfigured()) {
          throw new Error('WhatsApp bridge not configured')
        }

        if (input.groupJid) {
          const result = await summarizeGroup(input.groupJid)
          const rows = await ctx.db
            .select({ group: whatsappGroups })
            .from(whatsappGroups)
            .where(eq(whatsappGroups.jid, input.groupJid))
            .limit(1)
          return {
            results: [
              {
                jid: input.groupJid,
                name: rows[0]?.group.name ?? input.groupJid,
                ...result,
              },
            ],
            okCount: result.ok ? 1 : 0,
            failCount: result.ok ? 0 : 1,
          }
        }

        const rows = await ctx.db
          .select({ group: whatsappGroups, label: whatsappLabels })
          .from(whatsappGroups)
          .leftJoin(whatsappLabels, eq(whatsappGroups.labelId, whatsappLabels.id))
        const enabled = rows.filter(({ group }) => group.enabled)
        if (enabled.length === 0) {
          return { results: [], okCount: 0, failCount: 0, message: 'No watched groups enabled' }
        }

        const { results: raw } = await summarizeAllGroups()
        const results = enabled.map(({ group }) => ({
          jid: group.jid,
          name: group.name,
          ok: raw[group.jid]?.ok ?? false,
          error: raw[group.jid]?.error ?? 'Group not summarized (bridge may have no buffer)',
        }))
        const okCount = results.filter((r) => r.ok).length
        return { results, okCount, failCount: results.length - okCount }
      }),
  }),

  messages: router({
    /** Stored messages for one group within a time window. */
    listByGroup: protectedProcedure
      .input(
        z.object({
          groupJid: z.string().min(1),
          sinceMs: z.number().int().optional(),
          untilMs: z.number().int().optional(),
          limit: z.number().int().min(1).max(1000).default(500),
        }),
      )
      .query(async ({ ctx, input }) => {
        const conds = [eq(whatsappMessages.groupJid, input.groupJid)]
        if (input.sinceMs !== undefined) conds.push(gte(whatsappMessages.ts, input.sinceMs))
        if (input.untilMs !== undefined) conds.push(lte(whatsappMessages.ts, input.untilMs))
        const rows = await ctx.db
          .select({
            id: whatsappMessages.id,
            sender: whatsappMessages.sender,
            senderName: whatsappMessages.senderName,
            text: whatsappMessages.text,
            ts: whatsappMessages.ts,
          })
          .from(whatsappMessages)
          .where(and(...conds))
          .orderBy(asc(whatsappMessages.ts))
          .limit(input.limit)
        return rows
      }),

    /** Per-group counts and date range of stored messages. */
    stats: protectedProcedure
      .input(z.object({ groupJid: z.string().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const groups = await ctx.db
          .select({ jid: whatsappGroups.jid, name: whatsappGroups.name })
          .from(whatsappGroups)
        const nameByJid = new Map(groups.map((g) => [g.jid, g.name]))
        const conds = input?.groupJid ? [eq(whatsappMessages.groupJid, input.groupJid)] : []
        const rows = await ctx.db
          .select({ groupJid: whatsappMessages.groupJid, ts: whatsappMessages.ts })
          .from(whatsappMessages)
          .where(conds.length ? and(...conds) : undefined)
        const byGroup = new Map<string, { count: number; earliestTs: number; latestTs: number }>()
        for (const r of rows) {
          const cur = byGroup.get(r.groupJid) ?? { count: 0, earliestTs: r.ts, latestTs: r.ts }
          cur.count += 1
          cur.earliestTs = Math.min(cur.earliestTs, r.ts)
          cur.latestTs = Math.max(cur.latestTs, r.ts)
          byGroup.set(r.groupJid, cur)
        }
        return Array.from(byGroup.entries()).map(([groupJid, v]) => ({
          groupJid,
          name: nameByJid.get(groupJid) ?? groupJid,
          count: v.count,
          earliestTs: v.earliestTs,
          latestTs: v.latestTs,
        }))
      }),
  }),

  insights: router({
    /** On-demand insight for one group: summary | topics | style. */
    forGroup: protectedProcedure
      .input(
        z.object({
          groupJid: z.string().min(1),
          window: z.enum(WHATSAPP_WINDOWS).default('7d'),
          mode: z.enum(['summary', 'topics', 'style']).default('summary'),
          ...timeRangeInput,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const range = resolveWhatsappTimeWindow({
          window: input.window,
          sinceHour: input.sinceHour,
          untilHour: input.untilHour,
        })
        const groupRows = await ctx.db
          .select({ name: whatsappGroups.name })
          .from(whatsappGroups)
          .where(eq(whatsappGroups.jid, input.groupJid))
          .limit(1)
        const displayName = groupRows[0]?.name?.trim() || input.groupJid.split('@')[0] || 'קבוצה'

        const msgs = await ctx.db
          .select({
            senderName: whatsappMessages.senderName,
            text: whatsappMessages.text,
            ts: whatsappMessages.ts,
          })
          .from(whatsappMessages)
          .where(
            and(
              eq(whatsappMessages.groupJid, input.groupJid),
              gte(whatsappMessages.ts, range.sinceMs),
              lte(whatsappMessages.ts, range.untilMs),
            ),
          )
          .orderBy(asc(whatsappMessages.ts))

        const text = await generateGroupInsight(displayName, msgs, input.mode, range.rangeLabel)
        const title =
          input.mode === 'style'
            ? `🔎 תובנות — ${displayName}`
            : input.mode === 'topics'
              ? `💬 על מה מדברים — ${displayName}`
              : `📋 סיכום קבוצה — ${displayName}`
        const header = `${title} · ${range.rangeLabel}\n\n`
        const full = (header + text).slice(0, 65000)
        if (msgs.length > 0) await saveInsightToChat(ctx.db, full)
        return {
          text: full,
          messageCount: msgs.length,
          mode: input.mode,
          window: input.window,
          rangeLabel: range.rangeLabel,
          sinceMs: range.sinceMs,
          untilMs: range.untilMs,
        }
      }),

    /** Prioritized cross-group briefing: "what's happening now in my groups". */
    digest: protectedProcedure
      .input(
        z
          .object({ window: z.enum(WHATSAPP_WINDOWS).default('24h'), ...timeRangeInput })
          .optional(),
      )
      .mutation(async ({ ctx, input }) => {
        const window = input?.window ?? '24h'
        const range = resolveWhatsappTimeWindow({
          window,
          sinceHour: input?.sinceHour,
          untilHour: input?.untilHour,
        })
        const meta = { window, rangeLabel: range.rangeLabel, sinceMs: range.sinceMs, untilMs: range.untilMs }

        const groups = await ctx.db.select().from(whatsappGroups)
        const enabled = groups.filter((g) => g.enabled)
        if (enabled.length === 0) {
          return { text: 'אין קבוצות פעילות במעקב.', items: [], ...meta }
        }

        const jids = enabled.map((g) => g.jid)
        const msgRows = await ctx.db
          .select({
            groupJid: whatsappMessages.groupJid,
            senderName: whatsappMessages.senderName,
            text: whatsappMessages.text,
            ts: whatsappMessages.ts,
          })
          .from(whatsappMessages)
          .where(
            and(
              inArray(whatsappMessages.groupJid, jids),
              gte(whatsappMessages.ts, range.sinceMs),
              lte(whatsappMessages.ts, range.untilMs),
            ),
          )
          .orderBy(asc(whatsappMessages.ts))

        const byGroup = new Map<string, { senderName: string; text: string; ts: number }[]>()
        for (const r of msgRows) {
          const list = byGroup.get(r.groupJid) ?? []
          list.push({ senderName: r.senderName, text: r.text, ts: r.ts })
          byGroup.set(r.groupJid, list)
        }

        const scored = enabled
          .map((g) => {
            const messages = byGroup.get(g.jid) ?? []
            const keywords = parseJsonArray(g.keywords)
            // Recency is measured against the end of the requested range, so a
            // past range ("yesterday", "14:00–16:00") is not penalized for being old.
            const score = computeGroupScore(messages, keywords, g.priority ?? 0, range.untilMs)
            return {
              groupJid: g.jid,
              name: g.name,
              priority: g.priority ?? 0,
              messages,
              score,
            }
          })
          .filter((g) => g.messages.length > 0)
          .sort((a, b) => b.score - a.score)

        if (scored.length === 0) {
          return {
            text: `אין פעילות חדשה בקבוצות שאתה עוקב אחריהן בטווח הזה (${range.rangeLabel}).`,
            items: [],
            ...meta,
          }
        }

        const { text, items } = await generateCrossGroupDigest(scored, range.rangeLabel)
        const isPastRange =
          window === 'yesterday' || input?.sinceHour !== undefined || input?.untilHour !== undefined
        const title = isPastRange
          ? `📡 מה היה בקבוצות · ${range.rangeLabel}`
          : `📡 מה קורה עכשיו בקבוצות · ${range.rangeLabel}`
        const full = (`${title}\n\n` + text).slice(0, 65000)
        await saveInsightToChat(ctx.db, full)
        return { text: full, items, ...meta }
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
