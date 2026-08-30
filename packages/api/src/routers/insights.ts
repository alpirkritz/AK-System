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
import { eq, desc, inArray, and, or, SQL } from 'drizzle-orm'
import { localTodayIso } from '../lib/calendar-dates'
import { ensureMeetingPageNote, parseNotionIdFromInput } from '../services/notion-meeting-note-body'

const meetingNotesInput = z
  .object({
    date: z.string().min(1).optional(),
    meetingId: z.string().min(1).optional(),
    personId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    notionPageId: z.string().min(1).optional(),
    notionUrl: z.string().min(1).optional(),
  })
  .refine(
    (v) => {
      const ids = [v.meetingId, v.personId, v.projectId].filter(Boolean)
      return ids.length <= 1
    },
    { message: 'Provide at most one of meetingId, personId, projectId' },
  )

export const insightsRouter = router({
  /**
   * Local AI meeting notes (with body text) for agents and digests.
   * Prefer this over live Notion property snippets.
   */
  meetingNotes: protectedProcedure.input(meetingNotesInput.optional()).query(async ({ ctx, input }) => {
    const filters = input ?? {}
    let dateFilter: string | undefined
    if (filters.date) {
      dateFilter = filters.date === 'today' ? localTodayIso() : filters.date
    }

    const conditions: SQL[] = []
    if (dateFilter) conditions.push(eq(meetingNotes.date, dateFilter))
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

    let noteIdsFromEdge: string[] | null = null
    if (filters.personId) {
      const rows = await ctx.db
        .select({ id: meetingNotePeople.meetingNoteId })
        .from(meetingNotePeople)
        .where(eq(meetingNotePeople.personId, filters.personId))
      noteIdsFromEdge = rows.map((r) => r.id)
      if (noteIdsFromEdge.length === 0) return { notes: [], count: 0 }
      conditions.push(inArray(meetingNotes.id, noteIdsFromEdge))
    } else if (filters.projectId) {
      const rows = await ctx.db
        .select({ id: meetingNoteProjects.meetingNoteId })
        .from(meetingNoteProjects)
        .where(eq(meetingNoteProjects.projectId, filters.projectId))
      noteIdsFromEdge = rows.map((r) => r.id)
      if (noteIdsFromEdge.length === 0) return { notes: [], count: 0 }
      conditions.push(inArray(meetingNotes.id, noteIdsFromEdge))
    }

    const whereClause = conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions)

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
      .limit(15)

    const meetingIds = [...new Set(rows.map((r) => r.meetingId).filter(Boolean) as string[])]
    const meetingTitleById = new Map<string, string>()
    if (meetingIds.length > 0) {
      const meetingRows = await ctx.db
        .select({ id: meetings.id, title: meetings.title })
        .from(meetings)
        .where(inArray(meetings.id, meetingIds))
      for (const m of meetingRows) meetingTitleById.set(m.id, m.title)
    }

    const notes = rows.map((r) => ({
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

    return { notes, count: notes.length }
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
