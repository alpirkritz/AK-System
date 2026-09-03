import { z } from 'zod'
import { router, protectedProcedure, type Context } from '../trpc'
import {
  meetings,
  meetingPeople,
  meetingSeries,
  meetingNotes,
  tasks,
  people,
  MEETING_CATEGORIES,
} from '@ak-system/database'
import { eq, inArray, and, isNotNull, isNull, desc } from 'drizzle-orm'
import { upsertPersonExternalId } from '../services/person-external-ids'
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
import { FREE_BUSY_PLACEHOLDER_TITLES_FOR_DB } from '../lib/calendar-filters'
import { localDateRangeToUtc } from '../lib/calendar-dates'

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
  typeId: z.string().nullable().optional(),
  peopleIds: z.array(z.string()).optional(),
})

const updateInput = createInput.extend({
  id: z.string().min(1),
})

/**
 * Find or create a manual (non-calendar) series for a recurring meeting, keyed by
 * title + recurrenceDay. Returns the series id, or null when the meeting is not recurring.
 */
async function ensureManualSeries(
  ctx: { db: Context['db'] },
  args: { title: string; recurring: string | null; recurrenceDay: string | null },
): Promise<string | null> {
  if (!args.recurring) return null
  const existing = await ctx.db
    .select({ id: meetingSeries.id, recurrenceDay: meetingSeries.recurrenceDay })
    .from(meetingSeries)
    .where(and(
      eq(meetingSeries.title, args.title),
      isNull(meetingSeries.googleRecurringEventId),
    ))
  const match = existing.find((s) => (s.recurrenceDay ?? null) === (args.recurrenceDay ?? null))
  if (match) return match.id
  const id = 'ms' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
  const now = new Date().toISOString()
  await ctx.db.insert(meetingSeries).values({
    id,
    title: args.title,
    cadence: args.recurring,
    recurrenceDay: args.recurrenceDay ?? null,
    rollingNotes: null,
    googleRecurringEventId: null,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

type SyncCalendarEvent = GoogleCalendarEvent | Awaited<ReturnType<typeof fetchAppleCalendarEvents>>[number]

/** Prefer Google (Dragontail bridge) over Apple Exchange for the same slot. */
function dedupeSyncEvents(events: SyncCalendarEvent[]): SyncCalendarEvent[] {
  const bySlot = new Map<string, SyncCalendarEvent>()
  for (const ev of events) {
    const slotKey = `${ev.title}|${ev.start.slice(0, 16)}`
    const isApple = 'source' in ev && ev.source === 'apple'
    const existing = bySlot.get(slotKey)
    if (!existing) bySlot.set(slotKey, ev)
    else if (!isApple) bySlot.set(slotKey, ev)
  }
  return [...bySlot.values()]
}

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
    const [[meeting], links, taskList, notes] = await Promise.all([
      ctx.db.select().from(meetings).where(eq(meetings.id, input.id)),
      ctx.db.select().from(meetingPeople).where(eq(meetingPeople.meetingId, input.id)),
      ctx.db.select({ id: tasks.id }).from(tasks).where(eq(tasks.meetingId, input.id)),
      ctx.db
        .select({
          id: meetingNotes.id,
          title: meetingNotes.title,
          date: meetingNotes.date,
          snippet: meetingNotes.snippet,
          bodyText: meetingNotes.bodyText,
          notionUrl: meetingNotes.notionUrl,
          sourceKind: meetingNotes.sourceKind,
        })
        .from(meetingNotes)
        .where(eq(meetingNotes.meetingId, input.id))
        .orderBy(desc(meetingNotes.date)),
    ])
    if (!meeting) return null
    return {
      ...meeting,
      peopleIds: links.map((l) => l.personId),
      taskIds: taskList.map((t) => t.id),
      meetingNotes: notes,
    }
  }),

  listSeries: protectedProcedure.query(async ({ ctx }) => {
    const series = await ctx.db.select().from(meetingSeries).orderBy(meetingSeries.title)
    if (series.length === 0) return []
    const seriesIds = series.map((s) => s.id)
    const instances = await ctx.db
      .select({ id: meetings.id, seriesId: meetings.seriesId, date: meetings.date, time: meetings.time })
      .from(meetings)
      .where(inArray(meetings.seriesId, seriesIds))
    const links = await ctx.db
      .select({ meetingId: meetingPeople.meetingId, personId: meetingPeople.personId })
      .from(meetingPeople)
      .where(inArray(meetingPeople.meetingId, instances.map((i) => i.id).length ? instances.map((i) => i.id) : ['']))

    const peopleByMeeting = new Map<string, string[]>()
    for (const l of links) {
      const arr = peopleByMeeting.get(l.meetingId) ?? []
      arr.push(l.personId)
      peopleByMeeting.set(l.meetingId, arr)
    }

    const today = new Date().toISOString().slice(0, 10)
    return series.map((s) => {
      const own = instances.filter((i) => i.seriesId === s.id)
      const sortedDates = own.map((i) => i.date).sort()
      const peopleIds = new Set<string>()
      for (const i of own) for (const pid of peopleByMeeting.get(i.id) ?? []) peopleIds.add(pid)
      const upcoming = sortedDates.filter((d) => d >= today)
      return {
        ...s,
        instanceCount: own.length,
        instanceIds: own.map((i) => i.id),
        peopleIds: [...peopleIds],
        nextDate: upcoming[0] ?? null,
        lastDate: sortedDates[sortedDates.length - 1] ?? null,
      }
    })
  }),

  getSeries: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const [series] = await ctx.db.select().from(meetingSeries).where(eq(meetingSeries.id, input.id))
    if (!series) return null
    const instances = await ctx.db
      .select()
      .from(meetings)
      .where(eq(meetings.seriesId, input.id))
      .orderBy(desc(meetings.date))
    const instanceIds = instances.map((i) => i.id)
    const links = instanceIds.length
      ? await ctx.db.select().from(meetingPeople).where(inArray(meetingPeople.meetingId, instanceIds))
      : []
    const peopleIds = [...new Set(links.map((l) => l.personId))]
    return { ...series, instances, peopleIds }
  }),

  updateSeriesNotes: protectedProcedure
    .input(z.object({ id: z.string().min(1), rollingNotes: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(meetingSeries)
        .set({ rollingNotes: input.rollingNotes, updatedAt: new Date().toISOString() })
        .where(eq(meetingSeries.id, input.id))
      const [row] = await ctx.db.select().from(meetingSeries).where(eq(meetingSeries.id, input.id))
      return row ?? null
    }),

  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    const id = 'm' + Date.now()
    const now = new Date().toISOString()
    const seriesId = await ensureManualSeries(ctx, {
      title: input.title,
      recurring: input.recurring ?? null,
      recurrenceDay: input.recurrenceDay ?? null,
    })
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
      typeId: input.typeId ?? null,
      seriesId,
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
    // Calendar-synced meetings keep the series assigned by sync; only manual meetings
    // (re)compute their series from the recurring flag.
    const [existing] = await ctx.db
      .select({ calendarEventId: meetings.calendarEventId })
      .from(meetings)
      .where(eq(meetings.id, input.id))
    const seriesId = existing?.calendarEventId
      ? undefined
      : await ensureManualSeries(ctx, {
          title: input.title,
          recurring: input.recurring ?? null,
          recurrenceDay: input.recurrenceDay ?? null,
        })
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
        typeId: input.typeId ?? null,
        seriesId,
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
    const rows = await ctx.db
      .select({ id: meetings.id })
      .from(meetings)
      .where(and(
        inArray(meetings.title, FREE_BUSY_PLACEHOLDER_TITLES_FOR_DB),
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
      const { timeMin, timeMax } = localDateRangeToUtc(input.startDate, input.endDate)

      // Invalidate both caches so we get full fresh data (no stale cache / token)
      invalidateAppleCalendarCache()
      invalidateGoogleCalendarCache()

      // Fetch from all available sources in parallel
      const googleConfigured = isGoogleCalendarConfigured()
      const [googleResult, appleResult] = await Promise.allSettled([
        googleConfigured
          ? fetchGoogleCalendarEvents(timeMin, timeMax)
          : Promise.resolve({ events: [], errors: [] }),
        fetchAppleCalendarEvents(timeMin, timeMax),
      ])
      const googleEvents = googleResult.status === 'fulfilled' ? googleResult.value.events : []
      const appleEvents  = appleResult.status  === 'fulfilled' ? appleResult.value  : []

      // Track which sources were successfully fetched so we only delete
      // meetings from sources we actually queried
      const fetchedSources = new Set<string>()
      if (googleConfigured && googleResult.status === 'fulfilled') fetchedSources.add('google')
      if (appleResult.status === 'fulfilled') fetchedSources.add('apple')

      let allEvents = dedupeSyncEvents([...googleEvents, ...appleEvents])

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
      const freeBusyIds = await ctx.db
        .select({ id: meetings.id })
        .from(meetings)
        .where(and(
          inArray(meetings.title, FREE_BUSY_PLACEHOLDER_TITLES_FOR_DB),
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

      // ── Build meeting series for recurring Google events ──
      // Group all instances that share a recurringEventId under one series row.
      const seriesByRecurringId = new Map<string, string>()
      const recurringIds = new Set<string>()
      for (const ev of allEvents) {
        const rid = (ev as GoogleCalendarEvent).recurringEventId
        if (rid) recurringIds.add(rid)
      }
      if (recurringIds.size > 0) {
        const ids = [...recurringIds]
        const existingSeries = await ctx.db
          .select({ id: meetingSeries.id, googleRecurringEventId: meetingSeries.googleRecurringEventId })
          .from(meetingSeries)
          .where(inArray(meetingSeries.googleRecurringEventId, ids))
        for (const s of existingSeries) {
          if (s.googleRecurringEventId) seriesByRecurringId.set(s.googleRecurringEventId, s.id)
        }
        for (const ev of allEvents) {
          const rid = (ev as GoogleCalendarEvent).recurringEventId
          if (!rid || seriesByRecurringId.has(rid)) continue
          const sid = 'ms_cal_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
          const evDate = ev.start.split('T')[0]
          const weekday = new Date(evDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' })
          await ctx.db.insert(meetingSeries).values({
            id: sid,
            title: ev.title,
            cadence: 'weekly',
            recurrenceDay: weekday,
            rollingNotes: null,
            googleRecurringEventId: rid,
            createdAt: now,
            updatedAt: now,
          })
          seriesByRecurringId.set(rid, sid)
        }
      }

      // Pre-load all people for attendee matching (case-insensitive by email)
      const peopleByEmail = new Map<string, { id: string; status: string }>()
      const allPeople = await ctx.db.select({ id: people.id, email: people.email, status: people.status }).from(people)
      for (const p of allPeople) {
        if (p.email) peopleByEmail.set(p.email.toLowerCase(), { id: p.id, status: p.status ?? 'confirmed' })
      }

      // Link a meeting to its attendees; unknown emails become unconfirmed people (review queue).
      const linkAttendees = async (
        meetingId: string,
        ev: SyncCalendarEvent,
        calendarSource: string,
      ) => {
        const attendees = ('attendees' in ev && Array.isArray(ev.attendees)) ? ev.attendees : []
        for (const attendee of attendees) {
          const email = (attendee as { email?: string }).email?.trim()
          if (!email || (attendee as { self?: boolean }).self) continue
          const key = email.toLowerCase()
          const match = peopleByEmail.get(key)
          if (match) {
            if (match.status === 'ignored') continue
            await ctx.db.insert(meetingPeople).values({ meetingId, personId: match.id })
            await upsertPersonExternalId(ctx.db, {
              personId: match.id,
              provider: 'email',
              accountKey: calendarSource,
              externalId: key,
              displayName: (attendee as { displayName?: string }).displayName || email,
            })
            continue
          }
          const personId = 'p_cal_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
          await ctx.db.insert(people).values({
            id: personId,
            name: (attendee as { displayName?: string }).displayName || email.split('@')[0],
            email,
            role: null,
            color: '#e8c547',
            status: 'unconfirmed',
            source: 'calendar',
            createdAt: now,
          })
          peopleByEmail.set(key, { id: personId, status: 'unconfirmed' })
          await upsertPersonExternalId(ctx.db, {
            personId,
            provider: 'email',
            accountKey: calendarSource,
            externalId: key,
            displayName: (attendee as { displayName?: string }).displayName || email,
          })
          await ctx.db.insert(meetingPeople).values({ meetingId, personId })
        }
      }

      // ── UPDATE existing + INSERT new ──
      for (const ev of allEvents) {
        const startDate = ev.start.split('T')[0]
        const startTime = ev.start.includes('T') ? ev.start.split('T')[1].slice(0, 5) : '09:00'
        const source = 'source' in ev ? 'apple' : 'google'
        const rid = (ev as GoogleCalendarEvent).recurringEventId
        const seriesId = rid ? (seriesByRecurringId.get(rid) ?? null) : null
        const isRecurring = Boolean(rid)
        const recurrenceDay = isRecurring
          ? new Date(startDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' })
          : null

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
              seriesId,
              recurring: isRecurring ? 'weekly' : null,
              recurrenceDay,
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
          seriesId,
          recurring: isRecurring ? 'weekly' : null,
          recurrenceDay,
          createdAt: now,
          updatedAt: now,
        })

        await linkAttendees(id, ev, source)

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

  analyzeTranscript: protectedProcedure
    .input(
      z.object({
        meetingId: z.string().min(1),
        force: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { analyzeTranscript } = await import('../services/meeting-analysis')
      const { meetingAnalyses } = await import('@ak-system/database')

      // Check if analysis already exists
      const existing = await ctx.db
        .select()
        .from(meetingAnalyses)
        .where(eq(meetingAnalyses.meetingId, input.meetingId))
        .limit(1)

      if (existing.length > 0 && !input.force) {
        return { analysisId: existing[0].id }
      }

      // Fetch meeting and transcript
      const [meeting] = await ctx.db
        .select()
        .from(meetings)
        .where(eq(meetings.id, input.meetingId))
        .limit(1)

      if (!meeting) {
        throw new Error('Meeting not found')
      }

      const [note] = await ctx.db
        .select()
        .from(meetingNotes)
        .where(eq(meetingNotes.meetingId, input.meetingId))
        .limit(1)

      const transcriptText = note?.bodyText || ''
      if (!transcriptText || transcriptText.trim().length < 100) {
        throw new Error('No transcript available or transcript too short')
      }

      // Fetch participants
      const participantRows = await ctx.db
        .select({ name: people.name })
        .from(meetingPeople)
        .leftJoin(people, eq(people.id, meetingPeople.personId))
        .where(eq(meetingPeople.meetingId, input.meetingId))

      const participantNames = participantRows
        .map((p) => p.name)
        .filter(Boolean) as string[]

      // Create analysis record
      const now = new Date().toISOString()
      const analysisId = 'ma_' + Date.now()

      await ctx.db.insert(meetingAnalyses).values({
        id: analysisId,
        meetingId: input.meetingId,
        meetingNoteId: note?.id || null,
        source: 'notion_transcript',
        transcriptText,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      })

      // Run analysis
      try {
        const result = await analyzeTranscript({
          transcriptText,
          meetingTitle: meeting.title,
          meetingDate: meeting.date,
          participantNames,
        })

        await ctx.db
          .update(meetingAnalyses)
          .set({
            hatName: result.hatName,
            topic: result.topic,
            mood: result.mood,
            subtext: result.subtext,
            keyInsight: result.keyInsight,
            score: result.score,
            scoreRationale: result.scoreRationale,
            kaizenKeep: result.kaizenKeep,
            kaizenImprove: result.kaizenImprove,
            openQuestion: result.openQuestion,
            participantsJson: JSON.stringify(result.participants),
            actionItemsJson: JSON.stringify(result.actionItems),
            model: 'gemini-2.5-flash',
            status: 'completed',
            updatedAt: now,
          })
          .where(eq(meetingAnalyses.id, analysisId))

        return { analysisId }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        await ctx.db
          .update(meetingAnalyses)
          .set({
            status: 'failed',
            error: errorMessage,
            updatedAt: now,
          })
          .where(eq(meetingAnalyses.id, analysisId))

        throw new Error(`Analysis failed: ${errorMessage}`)
      }
    }),

  getAnalysis: protectedProcedure
    .input(z.object({ meetingId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { meetingAnalyses } = await import('@ak-system/database')

      const [analysis] = await ctx.db
        .select()
        .from(meetingAnalyses)
        .where(eq(meetingAnalyses.meetingId, input.meetingId))
        .orderBy(desc(meetingAnalyses.createdAt))
        .limit(1)

      if (!analysis) {
        return null
      }

      return {
        id: analysis.id,
        hatName: analysis.hatName,
        topic: analysis.topic,
        mood: analysis.mood,
        subtext: analysis.subtext,
        keyInsight: analysis.keyInsight,
        score: analysis.score,
        scoreRationale: analysis.scoreRationale,
        kaizenKeep: analysis.kaizenKeep,
        kaizenImprove: analysis.kaizenImprove,
        openQuestion: analysis.openQuestion,
        participants: analysis.participantsJson
          ? JSON.parse(analysis.participantsJson)
          : [],
        actionItems: analysis.actionItemsJson
          ? JSON.parse(analysis.actionItemsJson)
          : [],
        status: analysis.status,
        error: analysis.error,
        createdAt: analysis.createdAt,
      }
    }),

  linkAnalysisParticipant: protectedProcedure
    .input(
      z.object({
        analysisId: z.string().min(1),
        participantIndex: z.number(),
        personId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { meetingAnalyses } = await import('@ak-system/database')

      // 1. Fetch the analysis
      const [analysis] = await ctx.db
        .select()
        .from(meetingAnalyses)
        .where(eq(meetingAnalyses.id, input.analysisId))
        .limit(1)

      if (!analysis) {
        throw new Error('Analysis not found')
      }

      // 2. Parse participants JSON
      const participants = analysis.participantsJson
        ? JSON.parse(analysis.participantsJson)
        : []

      if (input.participantIndex < 0 || input.participantIndex >= participants.length) {
        throw new Error('Invalid participant index')
      }

      // 3. Update the participant
      participants[input.participantIndex] = {
        ...participants[input.participantIndex],
        personId: input.personId,
        confirmed: true,
      }

      // 4. Update the analysis record
      await ctx.db
        .update(meetingAnalyses)
        .set({
          participantsJson: JSON.stringify(participants),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(meetingAnalyses.id, input.analysisId))

      // 5. Auto-add person to meeting if not already present
      const [meeting] = await ctx.db
        .select()
        .from(meetings)
        .where(eq(meetings.id, analysis.meetingId))
        .limit(1)

      if (meeting) {
        const currentPeopleIds = meeting.peopleIds ? JSON.parse(meeting.peopleIds) : []
        if (!currentPeopleIds.includes(input.personId)) {
          currentPeopleIds.push(input.personId)
          await ctx.db
            .update(meetings)
            .set({
              peopleIds: JSON.stringify(currentPeopleIds),
              updatedAt: new Date().toISOString(),
            })
            .where(eq(meetings.id, analysis.meetingId))
        }
      }

      return { success: true }
    }),

  confirmAnalysisParticipant: protectedProcedure
    .input(
      z.object({
        analysisId: z.string().min(1),
        participantIndex: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { meetingAnalyses } = await import('@ak-system/database')

      // 1. Fetch the analysis
      const [analysis] = await ctx.db
        .select()
        .from(meetingAnalyses)
        .where(eq(meetingAnalyses.id, input.analysisId))
        .limit(1)

      if (!analysis) {
        throw new Error('Analysis not found')
      }

      // 2. Parse participants JSON
      const participants = analysis.participantsJson
        ? JSON.parse(analysis.participantsJson)
        : []

      if (input.participantIndex < 0 || input.participantIndex >= participants.length) {
        throw new Error('Invalid participant index')
      }

      // 3. Mark participant as confirmed
      participants[input.participantIndex] = {
        ...participants[input.participantIndex],
        confirmed: true,
      }

      // 4. Update the analysis record
      await ctx.db
        .update(meetingAnalyses)
        .set({
          participantsJson: JSON.stringify(participants),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(meetingAnalyses.id, input.analysisId))

      return { success: true }
    }),

  createTasksFromAnalysis: protectedProcedure
    .input(
      z.object({
        analysisId: z.string().min(1),
        indices: z.array(z.number()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { meetingAnalyses } = await import('@ak-system/database')

      const [analysis] = await ctx.db
        .select()
        .from(meetingAnalyses)
        .where(eq(meetingAnalyses.id, input.analysisId))
        .limit(1)

      if (!analysis) {
        throw new Error('Analysis not found')
      }

      const actionItems: Array<{ content: string; owner?: string; taskId?: string }> =
        analysis.actionItemsJson ? JSON.parse(analysis.actionItemsJson) : []

      const itemsToCreate = input.indices
        ? input.indices.map((i) => actionItems[i]).filter(Boolean)
        : actionItems

      const createdTaskIds: string[] = []
      const now = new Date().toISOString()

      for (const item of itemsToCreate) {
        if (item.taskId) continue // Already created

        // Try to match owner to existing person
        let assigneeId: string | null = null
        if (item.owner) {
          const [match] = await ctx.db
            .select({ id: people.id })
            .from(people)
            .where(eq(people.name, item.owner))
            .limit(1)
          assigneeId = match?.id || null
        }

        const taskId = 't' + Date.now() + Math.random().toString(36).slice(2, 7)

        await ctx.db.insert(tasks).values({
          id: taskId,
          title: item.content,
          meetingId: analysis.meetingId,
          assigneeId,
          projectId: null,
          workspaceId: null,
          dueDate: null,
          done: false,
          status: 'not_started',
          priority: 'medium',
          source: 'meeting_analysis',
          createdAt: now,
          updatedAt: now,
        })

        item.taskId = taskId
        createdTaskIds.push(taskId)
      }

      // Update analysis with task IDs
      await ctx.db
        .update(meetingAnalyses)
        .set({
          actionItemsJson: JSON.stringify(actionItems),
          updatedAt: now,
        })
        .where(eq(meetingAnalyses.id, input.analysisId))

      return { createdTaskIds }
    }),

  linkOrphanedNotes: protectedProcedure.mutation(async () => {
    const { linkOrphanedNotes } = await import('../services/notion-meeting-sync')
    const result = await linkOrphanedNotes()
    return result
  }),
})
