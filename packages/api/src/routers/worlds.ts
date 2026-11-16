import { z } from 'zod'
import { count, eq } from 'drizzle-orm'
import { meetings, projects } from '@ak-system/database'
import { router, protectedProcedure } from '../trpc'
import {
  clearWorldCache,
  ensureWorldScopeBackfilled,
  listCalendarWorlds,
  listKnownCalendars,
  listNotionWorldDisagreements,
  listWorldConflicts,
  loadWorldMap,
  settleNotionDisagreement,
  resolveAllWorlds,
  resolveWorldConflict,
  setCalendarWorld,
  worldOf,
} from '../services/world-scope'

/** Worlds own projects; meetings and tasks resolve into them (spec: project-world-scoping). */
export const worldsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    await ensureWorldScopeBackfilled(ctx.db)
    const map = await loadWorldMap(ctx.db)
    const [projectRows, meetingRows] = await Promise.all([
      ctx.db.select({ workspaceId: projects.workspaceId }).from(projects),
      ctx.db.select({ workspaceId: meetings.workspaceId, n: count() }).from(meetings).groupBy(meetings.workspaceId),
    ])
    return map.worlds.map((w) => ({
      ...w,
      projectCount: projectRows.filter((p) => worldOf(map, p.workspaceId) === w.id).length,
      meetingCount: meetingRows.filter((m) => worldOf(map, m.workspaceId) === w.id).reduce((a, m) => a + Number(m.n), 0),
    }))
  }),

  calendars: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const [known, mapped] = await Promise.all([listKnownCalendars(ctx.db), listCalendarWorlds(ctx.db)])
      const byCal = new Map(mapped.map((m) => [m.calendarId, m.workspaceId]))
      const ids = new Set([...known.map((k) => k.calendarId), ...mapped.map((m) => m.calendarId)])
      return [...ids].map((calendarId) => ({
        calendarId,
        label: calendarLabel(calendarId),
        meetingCount: known.find((k) => k.calendarId === calendarId)?.count ?? 0,
        workspaceId: byCal.get(calendarId) ?? null,
      }))
    }),
    set: protectedProcedure
      .input(z.object({ calendarId: z.string().min(1), workspaceId: z.string().nullable() }))
      .mutation(async ({ ctx, input }) => ({ ok: true, reresolved: await setCalendarWorld(ctx.db, input.calendarId, input.workspaceId) })),
  }),

  conflicts: protectedProcedure.query(async ({ ctx }) => {
    await ensureWorldScopeBackfilled(ctx.db)
    return listWorldConflicts(ctx.db)
  }),

  resolveConflict: protectedProcedure
    .input(z.object({ kind: z.enum(['meeting', 'task']), id: z.string().min(1), action: z.enum(['unlink', 'move']) }))
    .mutation(async ({ ctx, input }) => {
      await resolveWorldConflict(ctx.db, input)
      return { ok: true }
    }),

  /** Meetings where ARO's own signal and the Notion DB disagree — ARO's world is kept until settled. */
  notionDisagreements: protectedProcedure.query(({ ctx }) => listNotionWorldDisagreements(ctx.db)),

  settleNotionDisagreement: protectedProcedure
    .input(z.object({ meetingId: z.string().min(1), keep: z.enum(['aro', 'notion']) }))
    .mutation(async ({ ctx, input }) => {
      await settleNotionDisagreement(ctx.db, input.meetingId, input.keep)
      return { ok: true }
    }),

  reresolve: protectedProcedure.mutation(async ({ ctx }) => {
    clearWorldCache(ctx.db)
    return resolveAllWorlds(ctx.db)
  }),
})

/** `google:<account>:<calendarId>` → a readable label without the hash noise. */
export function calendarLabel(calendarId: string): string {
  const [source, account, ...rest] = calendarId.split(':')
  const cal = rest.join(':')
  if (!account) return calendarId
  if (cal === account) return `${account} (ראשי)`
  const short = cal.includes('@group.calendar.google.com') ? `${cal.slice(0, 8)}…` : cal
  return `${source === 'apple' ? 'Apple' : account} · ${short}`
}
