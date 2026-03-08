import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { meetings, meetingPeople, tasks, people, MEETING_CATEGORIES } from '@ak-system/database'
import { eq, inArray, and, isNotNull } from 'drizzle-orm'
import {
  fetchGoogleCalendarEvents,
  isGoogleCalendarConfigured,
  invalidateGoogleCalendarCache,
  type GoogleCalendarEvent,
} from '../services/google-calendar'
import {
  fetchAppleCalendarEvents,
  invalidateAppleCalendarCache,
} from '../services/apple-calendar'

const categoryEnum = z.enum(MEETING_CATEGORIES)
const createInput = z.object({
  title: z.string().min(1),
  date: z.string(),
  time: z.string().optional(),
  recurring: z.string().nullable().optional(),
  recurrenceDay: z.string().nullable().optional(),
  notes: z.string().optional(),
  category: categoryEnum.nullable().optional(),
  projectId: z.string().nullable().optional(),
  peopleIds: z.array(z.string()).optional(),
})

const updateInput = createInput.extend({
  id: z.string().min(1),
})

const idInput = z.object({ id: z.string().min(1) })

export const meetingsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const list = await ctx.db.select().from(meetings).orderBy(meetings.date)
    if (list.length === 0) return []

    const ids = list.map((m) => m.id)
    const [allLinks, allTasks] = await Promise.all([
      ctx.db.select().from(meetingPeople).where(inArray(meetingPeople.meetingId, ids)),
      ctx.db.select({ id: tasks.id, meetingId: tasks.meetingId }).from(tasks).where(inArray(tasks.meetingId, ids)),
    ])

    const peopleByMeeting = new Map<string, string[]>()
    for (const link of allLinks) {
      const arr = peopleByMeeting.get(link.meetingId) ?? []
      arr.push(link.personId)
      peopleByMeeting.set(link.meetingId, arr)
    }
    const tasksByMeeting = new Map<string, string[]>()
    for (const t of allTasks) {
      if (!t.meetingId) continue
      const arr = tasksByMeeting.get(t.meetingId) ?? []
      arr.push(t.id)
      tasksByMeeting.set(t.meetingId, arr)
    }

    return list.map((m) => ({
      ...m,
      peopleIds: peopleByMeeting.get(m.id) ?? [],
      taskIds: tasksByMeeting.get(m.id) ?? [],
    }))
  }),

  getById: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const [[meeting], links, taskList] = await Promise.all([
      ctx.db.select().from(meetings).where(eq(meetings.id, input.id)),
      ctx.db.select().from(meetingPeople).where(eq(meetingPeople.meetingId, input.id)),
      ctx.db.select({ id: tasks.id }).from(tasks).where(eq(tasks.meetingId, input.id)),
    ])
    if (!meeting) return null
    return {
      ...meeting,
      peopleIds: links.map((l) => l.personId),
      taskIds: taskList.map((t) => t.id),
    }
  }),

  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    const id = 'm' + Date.now()
    const now = new Date().toISOString()
    await ctx.db.insert(meetings).values({
      id,
      title: input.title,
      date: input.date,
      time: input.time ?? '09:00',
      recurring: input.recurring ?? null,
      recurrenceDay: input.recurrenceDay ?? null,
      notes: input.notes ?? null,
      category: input.category ?? null,
      projectId: input.projectId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    if (input.peopleIds?.length) {
      await ctx.db.insert(meetingPeople).values(
        input.peopleIds.map((personId) => ({ meetingId: id, personId }))
      )
    }
    const [row] = await ctx.db.select().from(meetings).where(eq(meetings.id, id))
    return { ...row!, peopleIds: input.peopleIds ?? [], taskIds: [] }
  }),

  update: protectedProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
    const now = new Date().toISOString()
    await ctx.db
      .update(meetings)
      .set({
        title: input.title,
        date: input.date,
        time: input.time ?? undefined,
        recurring: input.recurring ?? null,
        recurrenceDay: input.recurrenceDay ?? null,
        notes: input.notes ?? null,
        category: input.category ?? undefined,
        projectId: input.projectId ?? null,
        updatedAt: now,
      })
      .where(eq(meetings.id, input.id))
    if (input.peopleIds !== undefined) {
      await ctx.db.delete(meetingPeople).where(eq(meetingPeople.meetingId, input.id))
      if (input.peopleIds.length > 0) {
        await ctx.db.insert(meetingPeople).values(
          input.peopleIds.map((personId) => ({ meetingId: input.id, personId }))
        )
      }
    }
    const [row] = await ctx.db.select().from(meetings).where(eq(meetings.id, input.id))
    return row ?? null
  }),

  purgeFreeBusy: protectedProcedure.mutation(async ({ ctx }) => {
    const FREE_BUSY_TITLES = ['פנוי', 'לא פנוי', 'Tentative', 'Free', 'Busy']
    const rows = await ctx.db
      .select({ id: meetings.id })
      .from(meetings)
      .where(and(
        inArray(meetings.title, FREE_BUSY_TITLES),
        eq(meetings.calendarSource, 'google'),
      ))
    if (rows.length > 0) {
      await ctx.db.delete(meetings).where(
        inArray(meetings.id, rows.map((r) => r.id))
      )
    }
    return { deleted: rows.length }
  }),

  syncFromCalendar: protectedProcedure
    .input(z.object({
      startDate: z.string(),
      endDate: z.string(),
      // null means "all calendars"
      calendarIds: z.array(z.string()).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const start = new Date(input.startDate)
      const end = new Date(input.endDate)

      // Invalidate both caches so we get full fresh data (no stale cache / token)
      invalidateAppleCalendarCache()
      invalidateGoogleCalendarCache()

      // Fetch from all available sources in parallel
      const googleConfigured = isGoogleCalendarConfigured()
      const [googleResult, appleResult] = await Promise.allSettled([
        googleConfigured
          ? fetchGoogleCalendarEvents(start, end)
          : Promise.resolve([]),
        fetchAppleCalendarEvents(start, end),
      ])
      const googleEvents = googleResult.status === 'fulfilled' ? googleResult.value : []
      const appleEvents  = appleResult.status  === 'fulfilled' ? appleResult.value  : []

      // Track which sources were successfully fetched so we only delete
      // meetings from sources we actually queried
      const fetchedSources = new Set<string>()
      if (googleConfigured && googleResult.status === 'fulfilled') fetchedSources.add('google')
      if (appleResult.status === 'fulfilled') fetchedSources.add('apple')

      let allEvents = [...googleEvents, ...appleEvents]

      // Filter to only user-selected calendars (if specified)
      if (input.calendarIds && input.calendarIds.length > 0) {
        const allowed = new Set(input.calendarIds)
        allEvents = allEvents.filter((e) => e.calendarId && allowed.has(e.calendarId))
      }

      // Skip all-day, cancelled, and "free/transparent" events — they're not actionable meetings
      allEvents = allEvents.filter((e) =>
        !e.isAllDay &&
        e.status !== 'cancelled' &&
        (e as GoogleCalendarEvent).transparency !== 'transparent'
      )

      // Set of active calendar event IDs (what the calendar considers "current")
      const activeEventIds = new Set(allEvents.map((e) => e.id))

      // Purge previously-synced free/busy placeholder meetings from the DB
      const FREE_BUSY_TITLES = ['פנוי', 'לא פנוי', 'Tentative', 'Free', 'Busy']
      const freeBusyIds = await ctx.db
        .select({ id: meetings.id })
        .from(meetings)
        .where(and(
          inArray(meetings.title, FREE_BUSY_TITLES),
          eq(meetings.calendarSource, 'google'),
        ))
      if (freeBusyIds.length > 0) {
        await ctx.db.delete(meetings).where(
          inArray(meetings.id, freeBusyIds.map((r) => r.id))
        )
      }

      // Fetch ALL existing calendar-synced meetings from the DB
      const existingRows = await ctx.db
        .select({
          id: meetings.id,
          calendarEventId: meetings.calendarEventId,
          calendarSource: meetings.calendarSource,
          date: meetings.date,
        })
        .from(meetings)
        .where(isNotNull(meetings.calendarEventId))

      const existingByCalId = new Map<string, (typeof existingRows)[number]>()
      for (const row of existingRows) {
        if (row.calendarEventId) existingByCalId.set(row.calendarEventId, row)
      }

      const now = new Date().toISOString()
      let created = 0
      let updated = 0
      let deleted = 0

      // ── DELETE: meetings in the DB whose calendar event was cancelled/removed ──
      // Only consider meetings within the sync date range and from sources we fetched.
      const startStr = input.startDate
      const endStr = input.endDate
      for (const row of existingRows) {
        if (!row.calendarEventId || !row.calendarSource) continue
        if (!fetchedSources.has(row.calendarSource)) continue
        if (row.date < startStr || row.date > endStr) continue
        if (activeEventIds.has(row.calendarEventId)) continue

        await ctx.db.delete(meetingPeople).where(eq(meetingPeople.meetingId, row.id))
        await ctx.db.update(tasks).set({ meetingId: null }).where(eq(tasks.meetingId, row.id))
        await ctx.db.delete(meetings).where(eq(meetings.id, row.id))
        deleted++
      }

      // Pre-load all people for attendee matching (avoids N+1 per-attendee lookups)
      const allAttendeeEmails: string[] = []
      for (const ev of allEvents) {
        if ('attendees' in ev && Array.isArray(ev.attendees)) {
          for (const a of ev.attendees) {
            if (a.email && !a.self) allAttendeeEmails.push(a.email)
          }
        }
      }
      const peopleByEmail = new Map<string, { id: string }>()
      if (allAttendeeEmails.length > 0) {
        const uniqueEmails = [...new Set(allAttendeeEmails)]
        const existingPeople = await ctx.db.select({ id: people.id, email: people.email }).from(people).where(inArray(people.email, uniqueEmails))
        for (const p of existingPeople) {
          if (p.email) peopleByEmail.set(p.email, p)
        }
      }

      // ── UPDATE existing + INSERT new ──
      for (const ev of allEvents) {
        const startDate = ev.start.split('T')[0]
        const startTime = ev.start.includes('T') ? ev.start.split('T')[1].slice(0, 5) : '09:00'
        const source = 'source' in ev ? 'apple' : 'google'

        const existing = existingByCalId.get(ev.id)
        if (existing) {
          await ctx.db
            .update(meetings)
            .set({
              title: ev.title,
              date: startDate,
              time: startTime,
              endTime: ev.end ?? null,
              location: ev.location ?? null,
              updatedAt: now,
            })
            .where(eq(meetings.id, existing.id))
          updated++
          continue
        }

        const id = 'm_cal_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)

        await ctx.db.insert(meetings).values({
          id,
          title: ev.title,
          date: startDate,
          time: startTime,
          endTime: ev.end ?? null,
          location: ev.location ?? null,
          calendarEventId: ev.id,
          calendarSource: source,
          notes: null,
          projectId: null,
          recurring: null,
          recurrenceDay: null,
          createdAt: now,
          updatedAt: now,
        })

        if (source === 'google' && 'attendees' in ev && Array.isArray(ev.attendees)) {
          for (const attendee of ev.attendees) {
            if (!attendee.email || attendee.self) continue

            let personId = peopleByEmail.get(attendee.email)?.id

            if (!personId) {
              personId = 'p_cal_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
              await ctx.db.insert(people).values({
                id: personId,
                name: attendee.displayName || attendee.email.split('@')[0],
                email: attendee.email,
                role: null,
                color: '#e8c547',
                createdAt: now,
              })
              peopleByEmail.set(attendee.email, { id: personId })
            }

            await ctx.db.insert(meetingPeople).values({ meetingId: id, personId })
          }
        }

        created++
      }

      return { created, updated, deleted }
    }),

  delete: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(meetingPeople).where(eq(meetingPeople.meetingId, input.id))
    await ctx.db.update(tasks).set({ meetingId: null }).where(eq(tasks.meetingId, input.id))
    await ctx.db.delete(meetings).where(eq(meetings.id, input.id))
    return { ok: true }
  }),
})
