import { loadWorldMap, worldOf } from '../services/world-scope'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { commitmentsForDate } from '../services/commitments'
import { pushDmAllowlist } from '../services/whatsapp-dm'
import { router, protectedProcedure } from '../trpc'
import {
  getDb,
  people,
  personExternalIds,
  meetings,
  meetingPeople,
  meetingNotes,
  meetingNotePeople,
  meetingNoteProjects,
  projects,
  projectPeople,
} from '@ak-system/database'
import { eq, desc, inArray, and, or, gte, SQL } from 'drizzle-orm'
import { localTodayIso, localTomorrowIso, resolveLocalDayArg } from '../lib/calendar-dates'
import { queryMatchesPersonName, queryMatchesText, titlesShareKnownPerson } from '../lib/person-name-match'
import { titlesFuzzyMatch } from '../services/notion-graph-sync'
import { titlesShareTopic } from '../lib/topic-match'
import { ensureMeetingPageNote, parseNotionIdFromInput } from '../services/notion-meeting-note-body'
import { resolveDatabases } from '../services/notion-tasks-sync'
import { syncNotionGraph } from '../services/notion-graph-sync'
import {
  buildPersonContext,
  coolingFlagsForDate,
  meetingPrepRelationship,
  linkWhatsappSender,
  unlinkWhatsappSender,
  unlinkedWhatsappSenders,
} from '../services/person-context'
import { setWarmthNote } from '../services/warmth'
import {
  acknowledgeAttention,
  needs1on1Flags,
  relationshipBoardWithAttention,
} from '../services/relationship-attention'
import { analysisBacklogSummary, runAnalysisBacklog } from '../services/analysis-backlog'
import { loadSystemSummaries, mergeSystemFirst } from '../services/system-summaries'
import {
  dismissPersonTrait,
  readPersonTraitDetail,
  readPersonTraits,
  restorePersonTrait,
  writePersonTraits,
} from '../services/person-portrait'

function traitError(err: unknown): TRPCError {
  const message = err instanceof Error ? err.message : 'לא הצלחנו לנתח. התכונות הקודמות נשמרו. נסה שוב.'
  if (message === 'NOT_FOUND') return new TRPCError({ code: 'NOT_FOUND', message: 'Not found' })
  return new TRPCError({ code: 'BAD_REQUEST', message })
}

const meetingNotesInput = z
  .object({
    date: z.string().min(1).optional(),
    meetingId: z.string().min(1).optional(),
    personId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    notionPageId: z.string().min(1).optional(),
    notionUrl: z.string().min(1).optional(),
    query: z.string().min(1).optional(),
    prepDate: z.string().min(1).optional(),
    /** Single-meeting prep: keep notes for this title's topic, project, or series only. */
    focusTitle: z.string().min(1).optional(),
  })
  .refine(
    (v) => {
      const ids = [v.meetingId, v.personId, v.projectId].filter(Boolean)
      return ids.length <= 1
    },
    { message: 'Provide at most one of meetingId, personId, projectId' },
  )

function isoDaysBefore(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10)
}

type FocusNote = {
  id: string
  title: string
  meetingTitle: string | null
  meetingId: string | null
}

/** Drop notes that are only related by shared attendees. */
async function keepNotesForFocusTitle<T extends FocusNote>(
  db: ReturnType<typeof getDb>,
  notes: T[],
  focusTitle: string,
): Promise<T[]> {
  const allMeetings = await db
    .select({
      id: meetings.id,
      title: meetings.title,
      projectId: meetings.projectId,
      seriesId: meetings.seriesId,
      workspaceId: meetings.workspaceId,
    })
    .from(meetings)
  // The focus meeting's world, when its same-titled meetings agree on one (project-world-scoping).
  const worldMap = await loadWorldMap(db)
  const focusWorlds = new Set(
    allMeetings
      .filter((m) => m.title.trim() === focusTitle.trim())
      .map((m) => worldOf(worldMap, m.workspaceId))
      .filter((w): w is string => Boolean(w)),
  )
  const focusWorld = focusWorlds.size === 1 ? [...focusWorlds][0] : null
  const anchors = allMeetings.filter((m) => titlesShareTopic(m.title, focusTitle))
  const projectIds = new Set(
    anchors.map((m) => m.projectId).filter((id): id is string => Boolean(id)),
  )
  const seriesIds = new Set(
    anchors.map((m) => m.seriesId).filter((id): id is string => Boolean(id)),
  )
  const metaById = new Map(allMeetings.map((m) => [m.id, m]))

  const linkedProjects = new Map<string, string[]>()
  const noteIds = notes.map((n) => n.id)
  if (noteIds.length > 0) {
    const links = await db
      .select({
        meetingNoteId: meetingNoteProjects.meetingNoteId,
        projectId: meetingNoteProjects.projectId,
      })
      .from(meetingNoteProjects)
      .where(inArray(meetingNoteProjects.meetingNoteId, noteIds))
    for (const link of links) {
      const list = linkedProjects.get(link.meetingNoteId) ?? []
      list.push(link.projectId)
      linkedProjects.set(link.meetingNoteId, list)
    }
  }

  return notes.filter((n) => {
    const noteMeta = n.meetingId ? metaById.get(n.meetingId) : undefined
    const noteWorld = worldOf(worldMap, noteMeta?.workspaceId)
    if (focusWorld && noteWorld && noteWorld !== focusWorld) return false
    if (titlesShareTopic(n.title, focusTitle)) return true
    if (n.meetingTitle && titlesShareTopic(n.meetingTitle, focusTitle)) return true
    const meta = n.meetingId ? metaById.get(n.meetingId) : undefined
    if (meta?.seriesId && seriesIds.has(meta.seriesId)) return true
    if (meta?.projectId && projectIds.has(meta.projectId)) return true
    return (linkedProjects.get(n.id) ?? []).some((id) => projectIds.has(id))
  })
}

function noteMatchesPrepMeeting(
  note: { id: string; title: string; meetingTitle: string | null; meetingId: string | null },
  dayMeetings: Array<{ id: string; title: string }>,
  personNames: string[],
  personNoteIds: Set<string>,
): boolean {
  if (personNoteIds.has(note.id)) return true
  for (const m of dayMeetings) {
    if (note.meetingId === m.id) return true
    if (titlesFuzzyMatch(note.title, m.title)) return true
    if (note.meetingTitle && titlesFuzzyMatch(note.meetingTitle, m.title)) return true
    if (titlesShareKnownPerson(note.title, m.title, personNames)) return true
    if (note.meetingTitle && titlesShareKnownPerson(note.meetingTitle, m.title, personNames)) return true
  }
  return false
}

export const insightsRouter = router({
  /**
   * Local AI meeting notes (with body text) for agents and digests.
   * Prefer this over live Notion property snippets.
   */
  meetingNotes: protectedProcedure.input(meetingNotesInput.optional()).query(async ({ ctx, input }) => {
    const filters = input ?? {}
    let dateFilter: string | undefined
    if (filters.date) {
      dateFilter = resolveLocalDayArg(filters.date)
    }
    const prepIso = filters.prepDate ? resolveLocalDayArg(filters.prepDate) : undefined
    const query = filters.query?.trim().toLowerCase()
    const ownerName = ctx.session?.user?.name ?? null
    let prepMeetingTitles: string[] = []

    const load = async () => {
      const conditions: SQL[] = []
      let prepDayMeetings: Array<{ id: string; title: string }> = []
      let prepPersonNames: string[] = []
      const prepPersonNoteIds = new Set<string>()

      if (prepIso) {
        prepDayMeetings = await ctx.db
          .select({ id: meetings.id, title: meetings.title })
          .from(meetings)
          .where(eq(meetings.date, prepIso))
        prepMeetingTitles = prepDayMeetings.map((m) => m.title)
        if (prepDayMeetings.length === 0) return []

        const peopleRows = await ctx.db.select({ id: people.id, name: people.name }).from(people)
        const isOwner = (name: string | null) =>
          Boolean(name && ownerName && (queryMatchesPersonName(name, ownerName) || queryMatchesPersonName(ownerName, name)))

        const personIds = new Set<string>()
        const dayMeetingIds = prepDayMeetings.map((m) => m.id)
        const links = await ctx.db
          .select({ personId: meetingPeople.personId, meetingId: meetingPeople.meetingId })
          .from(meetingPeople)
          .where(inArray(meetingPeople.meetingId, dayMeetingIds))
        const ownerPersonIds = new Set(
          peopleRows.filter((p) => isOwner(p.name)).map((p) => p.id),
        )
        for (const l of links) {
          if (!ownerPersonIds.has(l.personId)) personIds.add(l.personId)
        }
        for (const m of prepDayMeetings) {
          for (const p of peopleRows) {
            if (!p.name || isOwner(p.name)) continue
            if (queryMatchesPersonName(p.name, m.title) || queryMatchesText(m.title, p.name)) {
              personIds.add(p.id)
            }
          }
        }
        prepPersonNames = peopleRows
          .filter((p) => p.name && personIds.has(p.id))
          .map((p) => p.name as string)

        if (personIds.size > 0) {
          const nlinks = await ctx.db
            .select({ id: meetingNotePeople.meetingNoteId })
            .from(meetingNotePeople)
            .where(inArray(meetingNotePeople.personId, [...personIds]))
          for (const r of nlinks) prepPersonNoteIds.add(r.id)
        }

        const cutoff = isoDaysBefore(prepIso, 60)
        const recent = gte(meetingNotes.date, cutoff)
        conditions.push(
          prepPersonNoteIds.size > 0
            ? or(recent, inArray(meetingNotes.id, [...prepPersonNoteIds]))!
            : recent,
        )
      } else if (dateFilter) {
        const dayMeetings = await ctx.db
          .select({ id: meetings.id })
          .from(meetings)
          .where(eq(meetings.date, dateFilter))
        const dayIds = dayMeetings.map((m) => m.id)
        if (dayIds.length > 0) {
          conditions.push(or(eq(meetingNotes.date, dateFilter), inArray(meetingNotes.meetingId, dayIds))!)
        } else {
          conditions.push(eq(meetingNotes.date, dateFilter))
        }
      }
      if (filters.meetingId) conditions.push(eq(meetingNotes.meetingId, filters.meetingId))

      const parsedPage = parseNotionIdFromInput(filters.notionUrl || filters.notionPageId || '')
      if (parsedPage) {
        const compact = parsedPage.pageId.replace(/-/g, '')
        const already = await ctx.db
          .select({ id: meetingNotes.id, bodyText: meetingNotes.bodyText })
          .from(meetingNotes)
          .where(or(eq(meetingNotes.notionPageId, parsedPage.pageId), eq(meetingNotes.notionPageId, compact)))
        if (!already.some((r) => r.bodyText?.trim())) {
          await ensureMeetingPageNote(ctx.db, parsedPage.pageId, parsedPage.blockId)
        }
        conditions.push(
          or(eq(meetingNotes.notionPageId, parsedPage.pageId), eq(meetingNotes.notionPageId, compact))!,
        )
      }

      if (filters.personId) {
        const rows = await ctx.db
          .select({ id: meetingNotePeople.meetingNoteId })
          .from(meetingNotePeople)
          .where(eq(meetingNotePeople.personId, filters.personId))
        const ids = rows.map((r) => r.id)
        if (ids.length === 0) return []
        conditions.push(inArray(meetingNotes.id, ids))
      } else if (filters.projectId) {
        const rows = await ctx.db
          .select({ id: meetingNoteProjects.meetingNoteId })
          .from(meetingNoteProjects)
          .where(eq(meetingNoteProjects.projectId, filters.projectId))
        const ids = rows.map((r) => r.id)
        if (ids.length === 0) return []
        conditions.push(inArray(meetingNotes.id, ids))
      }

      const whereClause =
        conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions)

      const rows = await ctx.db
        .select({
          id: meetingNotes.id,
          title: meetingNotes.title,
          date: meetingNotes.date,
          snippet: meetingNotes.snippet,
          bodyText: meetingNotes.bodyText,
          notionUrl: meetingNotes.notionUrl,
          meetingId: meetingNotes.meetingId,
          sourceKind: meetingNotes.sourceKind,
        })
        .from(meetingNotes)
        .where(whereClause)
        .orderBy(desc(meetingNotes.date))
        .limit(prepIso ? 80 : 40)

      const meetingIds = [...new Set(rows.map((r) => r.meetingId).filter(Boolean) as string[])]
      const meetingTitleById = new Map<string, string>()
      if (meetingIds.length > 0) {
        const meetingRows = await ctx.db
          .select({ id: meetings.id, title: meetings.title })
          .from(meetings)
          .where(inArray(meetings.id, meetingIds))
        for (const m of meetingRows) meetingTitleById.set(m.id, m.title)
      }

      let notes = rows.map((r) => ({
        id: r.id,
        title: r.title,
        date: r.date,
        snippet: r.snippet,
        bodyText: r.bodyText,
        notionUrl: r.notionUrl,
        meetingId: r.meetingId,
        meetingTitle: r.meetingId ? meetingTitleById.get(r.meetingId) ?? null : null,
        sourceKind: r.sourceKind ?? null,
      }))

      if (prepIso) {
        notes = notes.filter((n) =>
          noteMatchesPrepMeeting(n, prepDayMeetings, prepPersonNames, prepPersonNoteIds),
        )
      }

      if (query && !prepIso) {
        const peopleRows = await ctx.db.select({ id: people.id, name: people.name }).from(people)
        const matchedPersonIds = peopleRows
          .filter((p) => queryMatchesPersonName(p.name || '', query))
          .map((p) => p.id)
        let meetingIdsForPeople = new Set<string>()
        if (matchedPersonIds.length > 0) {
          const links = await ctx.db
            .select({ meetingId: meetingPeople.meetingId })
            .from(meetingPeople)
            .where(inArray(meetingPeople.personId, matchedPersonIds))
          meetingIdsForPeople = new Set(links.map((l) => l.meetingId))
        }
        const filtered = notes.filter((n) => {
          const hay = `${n.title} ${n.meetingTitle ?? ''} ${n.snippet ?? ''} ${n.bodyText ?? ''}`
          return queryMatchesText(hay, query) || (n.meetingId ? meetingIdsForPeople.has(n.meetingId) : false)
        })
        // Named ask like "שני" vs "Shani Asaraf" should still return today's notes rather than empty.
        // prepDate + leftover query would drop other people — only keep query when it hits.
        if (filtered.length > 0 || (!dateFilter && !prepIso)) notes = filtered
      }

      if (filters.focusTitle) {
        notes = await keepNotesForFocusTitle(ctx.db, notes, filters.focusTitle)
      }

      return notes.slice(0, prepIso ? 20 : 15)
    }

    let notes = await load()
    const today = localTodayIso()
    const tomorrow = localTomorrowIso()
    const yesterday = new Date(`${today}T12:00:00`)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayIso = yesterday.toISOString().slice(0, 10)
    const wantsRecent =
      Boolean(query) ||
      dateFilter === today ||
      dateFilter === yesterdayIso ||
      prepIso === today ||
      prepIso === tomorrow ||
      prepIso === yesterdayIso
    const hasBody = notes.some((n) => n.bodyText?.trim())
    const needsResummary = notes.some((n) => n.sourceKind === 'meeting_page')
    if (
      (!hasBody || needsResummary) &&
      wantsRecent &&
      resolveDatabases('meetings').length > 0 &&
      !filters.notionUrl &&
      !filters.notionPageId
    ) {
      await syncNotionGraph({ windowDays: 3, dryRun: false, scope: 'meetings' }, ctx.db)
      notes = await load()
    }

    // System summaries first, Notion only as a fallback (docs/specs/hugo-system-summaries-first.md).
    const dayIso = prepIso ?? dateFilter
    const stubRows =
      filters.meetingId || dayIso
        ? await ctx.db
            .select({ id: meetings.id, title: meetings.title, date: meetings.date })
            .from(meetings)
            .where(filters.meetingId ? eq(meetings.id, filters.meetingId) : eq(meetings.date, dayIso!))
        : []
    const systemSummaries = await loadSystemSummaries(ctx.db, [
      ...new Set([...notes.map((n) => n.meetingId).filter((id): id is string => Boolean(id)), ...stubRows.map((m) => m.id)]),
    ])
    const merged = mergeSystemFirst(notes, systemSummaries, stubRows)

    return {
      notes: merged,
      count: merged.length,
      ...(prepIso ? { prepFor: { date: prepIso, meetingTitles: prepMeetingTitles } } : {}),
    }
  }),

  personContext: protectedProcedure
    .input(z.object({ personId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [person] = await ctx.db.select().from(people).where(eq(people.id, input.personId))
      if (!person) return null

      const relatedMeetingIds = await ctx.db
        .select({ meetingId: meetingPeople.meetingId })
        .from(meetingPeople)
        .where(eq(meetingPeople.personId, input.personId))
      const meetingIds = relatedMeetingIds.map((r) => r.meetingId)

      const personMeetings =
        meetingIds.length === 0
          ? []
          : await ctx.db
              .select()
              .from(meetings)
              .where(inArray(meetings.id, meetingIds))
              .orderBy(desc(meetings.date))

      const WEEKS = 8
      const windowStart = Date.now() - WEEKS * 7 * 86400000
      const recentCount = personMeetings.filter((m) => {
        const t = new Date(m.date + 'T00:00:00').getTime()
        return t >= windowStart && t <= Date.now()
      }).length
      const seriesIds = new Set(personMeetings.map((m) => m.seriesId).filter(Boolean) as string[])
      const cadence = {
        isRecurring: personMeetings.some((m) => m.recurring) || seriesIds.size > 0,
        recentCount,
        weeks: WEEKS,
        seriesCount: seriesIds.size,
        totalMeetings: personMeetings.length,
      }

      const lastMeetingDate = personMeetings[0]?.date ?? null
      const noteRows = await ctx.db
        .select({
          id: meetingNotes.id,
          title: meetingNotes.title,
          date: meetingNotes.date,
          snippet: meetingNotes.snippet,
          bodyText: meetingNotes.bodyText,
        })
        .from(meetingNotePeople)
        .innerJoin(meetingNotes, eq(meetingNotePeople.meetingNoteId, meetingNotes.id))
        .where(eq(meetingNotePeople.personId, input.personId))
        .orderBy(desc(meetingNotes.date))
        .limit(5)

      const recentMeetingNotes = noteRows.map((n) => ({
        id: n.id,
        title: n.title,
        date: n.date,
        snippet: n.snippet,
        bodyText: n.bodyText ? n.bodyText.slice(0, 1500) : null,
      }))

      const lastNoteDate = noteRows[0]?.date ?? null
      const extras = await buildPersonContext(ctx.db, input.personId)
      const attention = extras?.attention ?? null
      const today = new Date().toISOString().slice(0, 10)
      const lastContactAt =
        attention?.lastContact?.date ??
        [lastMeetingDate, lastNoteDate, person.lastContact]
          .filter((d): d is string => !!d && d.slice(0, 10) <= today)
          .sort()
          .reverse()[0] ??
        null
      const lastContactChannel = attention?.lastContact?.channel ?? null

      const sharedProjects = await ctx.db
        .select({
          id: projects.id,
          name: projects.name,
          color: projects.color,
        })
        .from(projectPeople)
        .innerJoin(projects, eq(projectPeople.projectId, projects.id))
        .where(eq(projectPeople.personId, input.personId))
        .orderBy(projects.name)

      const identitySources = await ctx.db
        .select({
          provider: personExternalIds.provider,
          accountKey: personExternalIds.accountKey,
          displayName: personExternalIds.displayName,
        })
        .from(personExternalIds)
        .where(eq(personExternalIds.personId, input.personId))

      const traits = await readPersonTraits(ctx.db, input.personId)

      return {
        lastContactAt,
        lastContactChannel,
        cadence,
        sharedProjects,
        recentMeetingNotes,
        identitySources,
        meetingCount: personMeetings.length,
        traits,
        ...extras!,
      }
    }),

  personTraits: protectedProcedure
    .input(z.object({ personId: z.string().min(1) }))
    .query(async ({ ctx, input }) => readPersonTraits(ctx.db, input.personId)),

  personTraitDetail: protectedProcedure
    .input(z.object({ personId: z.string().min(1) }))
    .query(async ({ ctx, input }) => readPersonTraitDetail(ctx.db, input.personId)),

  writePersonTraits: protectedProcedure
    .input(z.object({ personId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await writePersonTraits(ctx.db, input.personId)
      } catch (err) {
        throw traitError(err)
      }
    }),

  dismissPersonTrait: protectedProcedure
    .input(z.object({ traitId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await dismissPersonTrait(ctx.db, input.traitId)
      } catch (err) {
        throw traitError(err)
      }
    }),

  restorePersonTrait: protectedProcedure
    .input(z.object({ traitId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await restorePersonTrait(ctx.db, input.traitId)
      } catch (err) {
        throw traitError(err)
      }
    }),

  meetingPrepContext: protectedProcedure
    .input(z.object({ meetingId: z.string().min(1) }))
    .query(async ({ ctx, input }) => meetingPrepRelationship(ctx.db, input.meetingId)),

  coolingForDate: protectedProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ ctx, input }) => coolingFlagsForDate(ctx.db, input.date)),

  /**
   * People who need a 1:1, for list pills and the home card. `cooling` / `warming` keep installed
   * phone builds working: they read a needs-1:1 person as cooling.
   */
  relationshipFlags: protectedProcedure.query(async ({ ctx }) => {
    const needs1on1 = await needs1on1Flags(ctx.db)
    return {
      needs1on1,
      cooling: needs1on1.map((f) => ({ personId: f.personId, name: f.name, trend: 'cooling' as const, recentAvg: null, olderAvg: null, count: 0 })),
      warming: [] as { personId: string; name: string; trend: 'warming'; recentAvg: null; olderAvg: null; count: number }[],
    }
  }),

  relationshipBoard: protectedProcedure.query(async ({ ctx }) => {
    const [board, backlog] = await Promise.all([relationshipBoardWithAttention(ctx.db), analysisBacklogSummary(ctx.db)])
    return { ...board, summary: { ...board.summary, pendingBacklog: backlog.pending } }
  }),

  /** "ראיתי": hide the needs-1:1 flag until a new meeting with this person, or 30 days. */
  acknowledgeAttention: protectedProcedure
    .input(z.object({ personId: z.string().min(1), ack: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const saved = await acknowledgeAttention(ctx.db, input.personId, input.ack)
      if (!saved) throw new TRPCError({ code: 'NOT_FOUND', message: 'Not found' })
      return saved
    }),

  /** Meetings with a note body that were never analysed, inside the board's 180-day window. */
  analysisBacklog: protectedProcedure.query(async ({ ctx }) => analysisBacklogSummary(ctx.db)),

  /** Analyse a few backlog meetings now — sequential, no WhatsApp or push. */
  runAnalysisBacklog: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(5).default(5) }).optional())
    .mutation(async ({ ctx, input }) => {
      const r = await runAnalysisBacklog(ctx.db, { limit: input?.limit ?? 5 })
      return { analysed: r.analysed, failed: r.failed, remaining: r.remaining }
    }),

  setWarmthNote: protectedProcedure
    .input(z.object({
      subject: z.enum(['person', 'circle']),
      id: z.string().min(1),
      note: z.string().max(280).nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const saved = await setWarmthNote(ctx.db, input.subject, input.id, input.note)
      if (!saved) throw new TRPCError({ code: 'NOT_FOUND', message: 'Not found' })
      return saved
    }),

  /** Morning brief: open commitments of today's attendees, plus my other open ones. */
  commitmentsForDate: protectedProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ ctx, input }) => commitmentsForDate(ctx.db, input.date)),

  whatsappSenders: protectedProcedure
    .input(z.object({ query: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => unlinkedWhatsappSenders(ctx.db, input?.query)),

  linkWhatsappSender: protectedProcedure
    .input(z.object({ personId: z.string().min(1), jid: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await linkWhatsappSender(ctx.db, input.personId, input.jid)
      await pushDmAllowlist(ctx.db)
      return { ok: true }
    }),

  unlinkWhatsappSender: protectedProcedure
    .input(z.object({ personId: z.string().min(1), jid: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await unlinkWhatsappSender(ctx.db, input.personId, input.jid)
      await pushDmAllowlist(ctx.db)
      return { ok: true }
    }),
})
