import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import {
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
import { ensureMeetingPageNote, parseNotionIdFromInput } from '../services/notion-meeting-note-body'
import { resolveDatabases } from '../services/notion-tasks-sync'
import { syncNotionGraph } from '../services/notion-graph-sync'

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

    return {
      notes,
      count: notes.length,
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
      const lastContactAt =
        [lastMeetingDate, lastNoteDate, person.lastContact]
          .filter(Boolean)
          .sort()
          .reverse()[0] ?? null

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

      return {
        lastContactAt,
        cadence,
        sharedProjects,
        recentMeetingNotes,
        identitySources,
        meetingCount: personMeetings.length,
      }
    }),
})
