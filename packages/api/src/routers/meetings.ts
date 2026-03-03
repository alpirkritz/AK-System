import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { meetings, meetingPeople, tasks, people } from '@ak-system/database'
import { eq, inArray, and } from 'drizzle-orm'
import {
  fetchGoogleCalendarEvents,
  isGoogleCalendarConfigured,
  type GoogleCalendarEvent,
} from '../services/google-calendar'
import {
  fetchAppleCalendarEvents,
} from '../services/apple-calendar'

const createInput = z.object({
  title: z.string().min(1),
  date: z.string(),
  time: z.string().optional(),
  recurring: z.string().nullable().optional(),
  recurrenceDay: z.string().nullable().optional(),
  notes: z.string().optional(),
  projectId: z.string().nullable().optional(),
  peopleIds: z.array(z.string()).optional(),
})

const updateInput = createInput.extend({
  id: z.string().min(1),
})

const idInput = z.object({ id: z.string().min(1) })

export const meetingsRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    const list = await ctx.db.select().from(meetings).orderBy(meetings.date)
    const withPeople = await Promise.all(
      list.map(async (m) => {
        const links = await ctx.db.select().from(meetingPeople).where(eq(meetingPeople.meetingId, m.id))
        const taskList = await ctx.db.select().from(tasks).where(eq(tasks.meetingId, m.id))
        return {
          ...m,
          peopleIds: links.map((l) => l.personId),
          taskIds: taskList.map((t) => t.id),
        }
      })
    )
    return withPeople
  }),

  getById: publicProcedure.input(idInput).query(async ({ ctx, input }) => {
    const [meeting] = await ctx.db.select().from(meetings).where(eq(meetings.id, input.id))
    if (!meeting) return null
    const links = await ctx.db.select().from(meetingPeople).where(eq(meetingPeople.meetingId, input.id))
    const taskList = await ctx.db.select().from(tasks).where(eq(tasks.meetingId, input.id))
    return {
      ...meeting,
      peopleIds: links.map((l) => l.personId),
      taskIds: taskList.map((t) => t.id),
    }
  }),

  create: publicProcedure.input(createInput).mutation(async ({ ctx, input }) => {
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

  update: publicProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
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

  purgeFreeBusy: publicProcedure.mutation(async ({ ctx }) => {
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

  syncFromCalendar: publicProcedure
    .input(z.object({
      startDate: z.string(),
      endDate: z.string(),
      // null means "all calendars"
      calendarIds: z.array(z.string()).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const start = new Date(input.startDate)
      const end = new Date(input.endDate)

      // Fetch from all available sources in parallel
      const [googleResult, appleResult] = await Promise.allSettled([
        isGoogleCalendarConfigured()
          ? fetchGoogleCalendarEvents(start, end)
          : Promise.resolve([]),
        fetchAppleCalendarEvents(start, end),
      ])
      const googleEvents = googleResult.status === 'fulfilled' ? googleResult.value : []
      const appleEvents  = appleResult.status  === 'fulfilled' ? appleResult.value  : []

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

      // Collect already-synced calendarEventIds to avoid duplicates
      const existingRows = await ctx.db.select({ calendarEventId: meetings.calendarEventId }).from(meetings)
      const synced = new Set(existingRows.map((r) => r.calendarEventId).filter(Boolean))

      const now = new Date().toISOString()
      let created = 0

      for (const ev of allEvents) {
        if (synced.has(ev.id)) continue

        const id = 'm_cal_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
        const startDate = ev.start.split('T')[0]
        const startTime = ev.start.includes('T') ? ev.start.split('T')[1].slice(0, 5) : '09:00'
        const source = 'source' in ev ? 'apple' : 'google'

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

        // Map attendees (Google only — Apple has no structured attendee list)
        if (source === 'google' && 'attendees' in ev && Array.isArray(ev.attendees)) {
          for (const attendee of ev.attendees) {
            if (!attendee.email || attendee.self) continue

            // Try to match an existing Person by email
            const [existing] = await ctx.db.select().from(people).where(eq(people.email, attendee.email))
            let personId = existing?.id

            if (!personId) {
              // Create a new Person so the attendee appears in the People list
              personId = 'p_cal_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
              await ctx.db.insert(people).values({
                id: personId,
                name: attendee.displayName || attendee.email.split('@')[0],
                email: attendee.email,
                role: null,
                color: '#e8c547',
                createdAt: now,
              })
            }

            await ctx.db.insert(meetingPeople).values({ meetingId: id, personId })
          }
        }

        synced.add(ev.id)
        created++
      }

      return { created }
    }),

  delete: publicProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(meetingPeople).where(eq(meetingPeople.meetingId, input.id))
    await ctx.db.update(tasks).set({ meetingId: null }).where(eq(tasks.meetingId, input.id))
    await ctx.db.delete(meetings).where(eq(meetings.id, input.id))
    return { ok: true }
  }),
})
