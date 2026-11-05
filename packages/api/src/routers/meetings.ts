import { z } from 'zod'
import { router, protectedProcedure, type Context } from '../trpc'
import {
  meetings,
  meetingPeople,
  meetingSeries,
  meetingNotes,
  tasks,
  people,
  workspaces,
  MEETING_CATEGORIES,
} from '@ak-system/database'
import { eq, inArray, and, isNotNull, isNull, desc, or } from 'drizzle-orm'
import { expandWorkspaceFilter } from '../services/workspace-scope'
import { upsertPersonExternalId } from '../services/person-external-ids'
import { resolvePerson } from '../services/person-resolution'
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
import { pushMeetingProperties, type MeetingWriteBackResult } from '../services/notion-meeting-writeback'
import {
  acceptAnalysisParticipant,
  attachPersonToMeeting,
  detachPersonFromMeeting,
  linkAnalysisParticipant as linkAnalysisParticipantRecord,
  removeAnalysisParticipant,
  resolvePersonForMeeting,
} from '../services/meeting-attendees'
import { TRPCError } from '@trpc/server'
import {
  parseCalendarParticipants,
  seriesTitleKey,
  type CalendarParticipant,
} from '../lib/calendar-participants'
import { ensureSelfPerson, getSelfPersonName, isSelfPersonName, omitSelfParticipants } from '../services/self-person'
import { getMeetingPrep } from '../services/meeting-preps'
import { withPersonNames } from '../services/people-resolve'
import { mergeRecordingNotes } from '../lib/recording-notes'

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
  list: protectedProcedure
    .input(
      z.object({
        timeRange: z.enum(['today', 'tomorrow', 'week', 'all']).optional(),
        withTasks: z.boolean().optional(),
        projectId: z.string().optional(),
        personId: z.string().optional(),
        status: z.enum(['scheduled', 'completed', 'cancelled']).optional(),
        workspaceId: z.string().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      // Build WHERE conditions based on filters
      const conditions = []
      
      if (input?.projectId) {
        conditions.push(eq(meetings.projectId, input.projectId))
      }

      if (input?.workspaceId) {
        const ids = await expandWorkspaceFilter(ctx.db, input.workspaceId)
        conditions.push(or(inArray(meetings.workspaceId, ids), isNull(meetings.workspaceId))!)
      }
      
      if (input?.status) {
        // Note: status field doesn't exist in schema yet, so we'll skip this for now
        // This can be added when the status column is added to the schema
      }

      // Base query
      let list = await ctx.db
        .select()
        .from(meetings)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(meetings.date)
      
      if (list.length === 0) return []

      // Filter by time range
      if (input?.timeRange) {
        const now = new Date()
        const today = now.toISOString().split('T')[0]
        const tomorrow = new Date(now.getTime() + 86400000).toISOString().split('T')[0]
        const weekEnd = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0]
        
        switch (input.timeRange) {
          case 'today':
            list = list.filter(m => m.date === today)
            break
          case 'tomorrow':
            list = list.filter(m => m.date === tomorrow)
            break
          case 'week':
            list = list.filter(m => m.date >= today && m.date <= weekEnd)
            break
          // 'all' = no filter
        }
      }

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

      let result = list.map((m) => ({
        ...m,
        peopleIds: peopleByMeeting.get(m.id) ?? [],
        taskIds: tasksByMeeting.get(m.id) ?? [],
      }))

      // Filter by person if specified
      if (input?.personId) {
        result = result.filter(m => m.peopleIds.includes(input.personId))
      }

      // Filter by tasks if specified
      if (input?.withTasks) {
        result = result.filter(m => m.taskIds.length > 0)
      }

      return result
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

  setWorkspace: protectedProcedure
    .input(z.object({ meetingId: z.string().min(1), workspaceId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const [meeting] = await ctx.db.select().from(meetings).where(eq(meetings.id, input.meetingId))
      if (!meeting) throw new TRPCError({ code: 'BAD_REQUEST', message: 'הפגישה לא נמצאה' })
      if (input.workspaceId) {
        const [world] = await ctx.db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, input.workspaceId))
        if (!world) throw new TRPCError({ code: 'BAD_REQUEST', message: 'העולם לא נמצא' })
      }
      await ctx.db
        .update(meetings)
        .set({
          workspaceId: input.workspaceId,
          workspaceSource: input.workspaceId ? 'manual' : null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(meetings.id, input.meetingId))
      const [row] = await ctx.db.select().from(meetings).where(eq(meetings.id, input.meetingId))
      return row!
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
    const id = 'm' + Date.now() + Math.random().toString(36).slice(2, 7)
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
    
    // Read old row for change detection
    const [oldRow] = await ctx.db
      .select()
      .from(meetings)
      .where(eq(meetings.id, input.id))
    
    // Calendar-synced meetings keep the series assigned by sync; only manual meetings
    // (re)compute their series from the recurring flag.
    const seriesId = oldRow?.calendarEventId
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
    
    // Write back changed fields to Notion
    let notionSync: MeetingWriteBackResult | null = null
    if (row?.notionPageId && oldRow) {
      const changedFields: Parameters<typeof pushMeetingProperties>[0] = {
        notionPageId: row.notionPageId,
      }
      let hasChanges = false
      
      if (input.title !== oldRow.title) {
        changedFields.title = input.title
        hasChanges = true
      }
      if (input.date !== oldRow.date || (input.time ?? oldRow.time) !== oldRow.time) {
        // Skip sentinel dates
        if (input.date !== '9999-12-31' && input.date) {
          changedFields.date = input.date
          changedFields.time = input.time ?? '09:00'
          hasChanges = true
        }
      }
      
      if (hasChanges) {
        notionSync = await pushMeetingProperties(changedFields)
      }
    }
    
    return { ...row, notionSync }
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

      // ── Participants snapshot per event (attendees, or the Dragontail description block) ──
      const ownerEmails = new Set<string>()
      for (const ev of allEvents) {
        const acct = (ev as GoogleCalendarEvent).accountEmail
        if (acct) ownerEmails.add(acct.toLowerCase())
      }
      const ownerName = getSelfPersonName()
      const participantsByEventId = new Map<string, CalendarParticipant[]>()
      for (const ev of allEvents) {
        participantsByEventId.set(ev.id, parseCalendarParticipants({
          attendees: 'attendees' in ev && Array.isArray(ev.attendees) ? ev.attendees : [],
          description: (ev as { description?: string | null }).description ?? null,
          ownerEmails: [...ownerEmails],
          ownerName,
        }))
      }

      // ── Title-based series for events that repeat without a recurring id (Outlook bridge) ──
      const seriesByTitleKey = new Map<string, string>()
      const titleKeyByEventId = new Map<string, string>()
      const titleKeyCounts = new Map<string, number>()
      for (const ev of allEvents) {
        if ((ev as GoogleCalendarEvent).recurringEventId || !ev.calendarId) continue
        if ((participantsByEventId.get(ev.id) ?? []).length === 0) continue
        const key = seriesTitleKey(ev.calendarId, ev.title)
        titleKeyByEventId.set(ev.id, key)
        titleKeyCounts.set(key, (titleKeyCounts.get(key) ?? 0) + 1)
      }
      if (titleKeyCounts.size > 0) {
        const existingTitleSeries = await ctx.db
          .select({ id: meetingSeries.id, titleKey: meetingSeries.titleKey })
          .from(meetingSeries)
          .where(inArray(meetingSeries.titleKey, [...titleKeyCounts.keys()]))
        for (const s of existingTitleSeries) {
          if (s.titleKey) seriesByTitleKey.set(s.titleKey, s.id)
        }
        for (const ev of allEvents) {
          const key = titleKeyByEventId.get(ev.id)
          if (!key || seriesByTitleKey.has(key) || (titleKeyCounts.get(key) ?? 0) < 2) continue
          const sid = 'ms_cal_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
          const weekday = new Date(ev.start.split('T')[0] + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' })
          await ctx.db.insert(meetingSeries).values({
            id: sid,
            title: ev.title,
            cadence: 'weekly',
            recurrenceDay: weekday,
            rollingNotes: null,
            titleKey: key,
            createdAt: now,
            updatedAt: now,
          })
          seriesByTitleKey.set(key, sid)
        }
      }

      // Series with a saved roster never flood the review queue with their attendees.
      const allSeriesIds = [...seriesByRecurringId.values(), ...seriesByTitleKey.values()]
      const rosteredSeriesIds = new Set<string>()
      if (allSeriesIds.length > 0) {
        const rostered = await ctx.db
          .select({ id: meetingSeries.id })
          .from(meetingSeries)
          .where(and(inArray(meetingSeries.id, allSeriesIds), isNotNull(meetingSeries.rosterSavedAt)))
        for (const r of rostered) rosteredSeriesIds.add(r.id)
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
        knownOnly: boolean,
      ) => {
        const attendees = ('attendees' in ev && Array.isArray(ev.attendees)) ? ev.attendees : []
        const linked = new Set<string>()
        for (const attendee of attendees) {
          const email = (attendee as { email?: string }).email?.trim()
          if (!email || (attendee as { self?: boolean }).self) continue
          const key = email.toLowerCase()
          const match = peopleByEmail.get(key)
          if (match) {
            if (match.status === 'ignored' || linked.has(match.id)) continue
            linked.add(match.id)
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
          if (knownOnly) continue
          const attendeeName = (attendee as { displayName?: string }).displayName
          const byName = attendeeName ? await resolvePerson(ctx.db, { name: attendeeName }) : null
          if (byName?.kind === 'match') {
            if (!linked.has(byName.personId)) {
              linked.add(byName.personId)
              await ctx.db.insert(meetingPeople).values({ meetingId, personId: byName.personId })
              await upsertPersonExternalId(ctx.db, {
                personId: byName.personId,
                provider: 'email',
                accountKey: calendarSource,
                externalId: key,
                displayName: attendeeName || email,
              })
            }
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
          linked.add(personId)
        }
        // Description-listed participants link only when already a known person.
        for (const p of participantsByEventId.get(ev.id) ?? []) {
          if (p.source !== 'description' || !p.email) continue
          const match = peopleByEmail.get(p.email)
          if (!match || match.status === 'ignored' || linked.has(match.id)) continue
          linked.add(match.id)
          await ctx.db.insert(meetingPeople).values({ meetingId, personId: match.id })
        }
      }

      // ── UPDATE existing + INSERT new ──
      for (const ev of allEvents) {
        const startDate = ev.start.split('T')[0]
        const startTime = ev.start.includes('T') ? ev.start.split('T')[1].slice(0, 5) : '09:00'
        const source = 'source' in ev ? 'apple' : 'google'
        const rid = (ev as GoogleCalendarEvent).recurringEventId
        const titleKey = titleKeyByEventId.get(ev.id)
        const seriesId = rid
          ? (seriesByRecurringId.get(rid) ?? null)
          : (titleKey ? (seriesByTitleKey.get(titleKey) ?? null) : null)
        const isRecurring = Boolean(seriesId)
        const participants = participantsByEventId.get(ev.id) ?? []
        const calendarParticipants = participants.length > 0 ? JSON.stringify(participants) : null
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
              calendarParticipants,
              calendarId: ev.calendarId ?? null,
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
          calendarId: ev.calendarId ?? null,
          notes: null,
          projectId: null,
          seriesId,
          recurring: isRecurring ? 'weekly' : null,
          recurrenceDay,
          calendarParticipants,
          createdAt: now,
          updatedAt: now,
        })

        await linkAttendees(id, ev, source, seriesId ? rosteredSeriesIds.has(seriesId) : false)

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
            participantsJson: JSON.stringify(omitSelfParticipants(result.participants ?? [])),
            actionItemsJson: JSON.stringify(result.actionItems),
            model: 'gemini-2.5-flash',
            status: 'completed',
            updatedAt: now,
          })
          .where(eq(meetingAnalyses.id, analysisId))

        const { proposeCommitmentsFromAnalysis } = await import('../services/commitments')
        await proposeCommitmentsFromAnalysis(ctx.db, analysisId)
        const { notifyAnalysisOnWhatsApp } = await import('../services/analysis-whatsapp')
        await notifyAnalysisOnWhatsApp(ctx.db, analysisId).catch((err) => {
          console.warn('[meetings] analysis WhatsApp failed:', err)
        })

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

  getInsight: protectedProcedure
    .input(z.object({ meetingId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { meetingInsight } = await import('../services/warmth')
      return meetingInsight(ctx.db, input.meetingId)
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
        // Linked items (personId) carry the current People name — docs/specs/recording-uses-chosen-people.md.
        participants: analysis.participantsJson
          ? await withPersonNames(
              ctx.db,
              omitSelfParticipants(JSON.parse(analysis.participantsJson) as { name: string; confirmed?: boolean; personId?: string }[]),
            )
          : [],
        actionItems: analysis.actionItemsJson
          ? await withPersonNames(
              ctx.db,
              JSON.parse(analysis.actionItemsJson) as { content: string; owner?: string; taskId?: string; personId?: string }[],
            )
          : [],
        status: analysis.status,
        error: analysis.error,
        createdAt: analysis.createdAt,
      }
    }),

  attachPerson: protectedProcedure
    .input(
      z.object({
        meetingId: z.string().min(1),
        personId: z.string().min(1).optional(),
        name: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const hasId = Boolean(input.personId)
      const hasName = Boolean(input.name?.trim())
      if (hasId === hasName) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'יש לבחור איש קשר או להקליד שם' })
      }
      const resolved = await resolvePersonForMeeting(ctx.db, {
        personId: input.personId,
        name: input.name,
      })
      await attachPersonToMeeting(ctx.db, input.meetingId, resolved.id)
      return { personId: resolved.id, name: resolved.name, created: resolved.created }
    }),

  detachPerson: protectedProcedure
    .input(
      z.object({
        meetingId: z.string().min(1),
        personId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await detachPersonFromMeeting(ctx.db, input.meetingId, input.personId)
      return { ok: true as const }
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
      return linkAnalysisParticipantRecord(ctx.db, input)
    }),

  acceptAnalysisParticipant: protectedProcedure
    .input(
      z.object({
        analysisId: z.string().min(1),
        participantIndex: z.number(),
        personId: z.string().min(1).optional(),
        name: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const resolved = await acceptAnalysisParticipant(ctx.db, input)
      return { personId: resolved.id, name: resolved.name, created: resolved.created }
    }),

  removeAnalysisParticipant: protectedProcedure
    .input(
      z.object({
        analysisId: z.string().min(1),
        participantIndex: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return removeAnalysisParticipant(ctx.db, input)
    }),

  confirmAnalysisParticipant: protectedProcedure
    .input(
      z.object({
        analysisId: z.string().min(1),
        participantIndex: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const resolved = await acceptAnalysisParticipant(ctx.db, input)
      return { success: true as const, personId: resolved.id, name: resolved.name, created: resolved.created }
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

        // His own action items stay assigned to him. They are not a task of the
        // Alpir Kritzler contact.
        let assigneeId: string | null = null
        if (item.owner && isSelfPersonName(item.owner)) {
          assigneeId = (await ensureSelfPerson(ctx.db)).id
        } else if (item.owner) {
          const [match] = await ctx.db
            .select({ id: people.id, name: people.name })
            .from(people)
            .where(eq(people.name, item.owner))
            .limit(1)
          assigneeId = match && !isSelfPersonName(match.name) ? match.id : null
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
        await (await import('../services/commitments')).acceptCommitmentsForActionItem(ctx.db, analysis.meetingId, item.content, taskId)
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

  linkActionItemTasks: protectedProcedure
    .input(
      z.object({
        analysisId: z.string().min(1),
        links: z.array(
          z.object({
            actionItemIndex: z.number(),
            taskId: z.string().min(1),
          })
        ),
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

      let linked = 0
      for (const link of input.links) {
        if (link.actionItemIndex < 0 || link.actionItemIndex >= actionItems.length) {
          throw new Error(`Invalid action item index: ${link.actionItemIndex}`)
        }

        const item = actionItems[link.actionItemIndex]
        // Skip if already set to the same ID
        if (item.taskId === link.taskId) {
          continue
        }

        item.taskId = link.taskId
        linked++
        await (await import('../services/commitments')).acceptCommitmentsForActionItem(ctx.db, analysis.meetingId, item.content, link.taskId)
      }

      // Update analysis with task IDs
      await ctx.db
        .update(meetingAnalyses)
        .set({
          actionItemsJson: JSON.stringify(actionItems),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(meetingAnalyses.id, input.analysisId))

      return { linked }
    }),

  /** The pre-meeting brief the herald stored for this meeting, or null when none was generated. */
  getPrep: protectedProcedure
    .input(z.object({ meetingId: z.string().min(1) }))
    .query(async ({ ctx, input }) => getMeetingPrep(ctx.db, input.meetingId)),

  /**
   * Notes typed during a web recording. Only `notes` is written — `update` would also
   * rewrite title, project, type, and recurrence.
   */
  saveRecordingNotes: protectedProcedure
    .input(z.object({ meetingId: z.string().min(1), notes: z.string().max(20000) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ notes: meetings.notes })
        .from(meetings)
        .where(eq(meetings.id, input.meetingId))
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' })
      const notes = mergeRecordingNotes(row.notes, input.notes)
      await ctx.db
        .update(meetings)
        .set({ notes, updatedAt: new Date().toISOString() })
        .where(eq(meetings.id, input.meetingId))
      return { notes }
    }),

  /**
   * Home for a recording started without a calendar event, so notes typed while recording
   * have a meeting to land on. `source = 'manual'` keeps calendar sync away from it.
   */
  createManual: protectedProcedure
    .input(z.object({
      title: z.string().min(1).max(200),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      time: z.string().regex(/^\d{2}:\d{2}$/),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = 'm_manual_' + Date.now() + Math.random().toString(36).slice(2, 7)
      const now = new Date().toISOString()
      await ctx.db.insert(meetings).values({
        id,
        title: input.title,
        date: input.date,
        time: input.time,
        source: 'manual',
        createdAt: now,
        updatedAt: now,
      })
      return { id }
    }),

  /**
   * Removes a manual meeting that ended up with nothing attached (recording cancelled, too
   * short, or linked to a calendar meeting instead). Notes typed during the recording do not
   * count as content: they are re-saved onto whichever meeting the recording ends up on.
   */
  deleteIfEmpty: protectedProcedure
    .input(z.object({ meetingId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ source: meetings.source, notes: meetings.notes })
        .from(meetings)
        .where(eq(meetings.id, input.meetingId))
      if (!row || row.source !== 'manual') return { deleted: false }
      if (mergeRecordingNotes(row.notes, '')) return { deleted: false }
      const { meetingAnalyses, voiceRecordings } = await import('@ak-system/database')
      const [rec, analysis, task] = await Promise.all([
        ctx.db.select({ id: voiceRecordings.id }).from(voiceRecordings).where(eq(voiceRecordings.meetingId, input.meetingId)).limit(1),
        ctx.db.select({ id: meetingAnalyses.id }).from(meetingAnalyses).where(eq(meetingAnalyses.meetingId, input.meetingId)).limit(1),
        ctx.db.select({ id: tasks.id }).from(tasks).where(eq(tasks.meetingId, input.meetingId)).limit(1),
      ])
      if (rec.length || analysis.length || task.length) return { deleted: false }
      await ctx.db.delete(meetingPeople).where(eq(meetingPeople.meetingId, input.meetingId))
      await ctx.db.delete(meetings).where(eq(meetings.id, input.meetingId))
      return { deleted: true }
    }),

  linkOrphanedNotes: protectedProcedure.mutation(async () => {
    const { linkOrphanedNotes } = await import('../services/notion-meeting-sync')
    const result = await linkOrphanedNotes()
    return result
  }),

  /** Returns calendar-sourced meetings from a given date, for the attach-to-calendar picker. */
  calendarOnDate: protectedProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ id: meetings.id, title: meetings.title, time: meetings.time, endTime: meetings.endTime })
        .from(meetings)
        .where(and(eq(meetings.date, input.date), eq(meetings.source, 'calendar')))
        .orderBy(meetings.time)
      return { meetings: rows }
    }),

  /**
   * Moves analyses, voice recordings, tasks, and voice commitments from a
   * voice/notion/manual meeting onto a calendar meeting from the same date.
   * The source placeholder meeting is deleted if it was auto-created by the recording pipeline.
   */
  attachToCalendar: protectedProcedure
    .input(z.object({
      meetingId: z.string().min(1),
      calendarMeetingId: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const { meetingId, calendarMeetingId } = input
      if (meetingId === calendarMeetingId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'אותה פגישה' })

      const [src, dst] = await Promise.all([
        ctx.db.select({ id: meetings.id, source: meetings.source, date: meetings.date }).from(meetings).where(eq(meetings.id, meetingId)).then(r => r[0]),
        ctx.db.select({ id: meetings.id, source: meetings.source, date: meetings.date }).from(meetings).where(eq(meetings.id, calendarMeetingId)).then(r => r[0]),
      ])
      if (!src) throw new TRPCError({ code: 'NOT_FOUND', message: 'פגישת מקור לא נמצאה' })
      if (!dst) throw new TRPCError({ code: 'NOT_FOUND', message: 'פגישת יעד לא נמצאה' })
      if (src.source === 'calendar') throw new TRPCError({ code: 'BAD_REQUEST', message: 'פגישת המקור כבר אירוע יומן' })
      if (dst.source !== 'calendar') throw new TRPCError({ code: 'BAD_REQUEST', message: 'פגישת היעד אינה אירוע יומן' })

      const { meetingAnalyses, voiceRecordings, commitments } = await import('@ak-system/database')

      // Move meeting analyses
      await ctx.db.update(meetingAnalyses).set({ meetingId: calendarMeetingId }).where(eq(meetingAnalyses.meetingId, meetingId))
      // Move voice recordings
      const recRows = await ctx.db
        .select({ id: voiceRecordings.id, createdMeetingId: voiceRecordings.createdMeetingId })
        .from(voiceRecordings)
        .where(eq(voiceRecordings.meetingId, meetingId))
      for (const rec of recRows) {
        const wasPlaceholder = rec.createdMeetingId === meetingId
        await ctx.db.update(voiceRecordings)
          .set({ meetingId: calendarMeetingId, ...(wasPlaceholder ? { createdMeetingId: null } : {}) })
          .where(eq(voiceRecordings.id, rec.id))
      }
      // Move tasks
      await ctx.db.update(tasks).set({ meetingId: calendarMeetingId }).where(eq(tasks.meetingId, meetingId))
      // Move voice commitments whose sourceId pointed at the source meeting
      await ctx.db.update(commitments)
        .set({ sourceId: calendarMeetingId })
        .where(and(eq(commitments.source, 'voice'), eq(commitments.sourceId, meetingId)))
      // Move meeting people to the calendar meeting (merge — don't overwrite existing attendees)
      const existingPeople = await ctx.db
        .select({ personId: meetingPeople.personId })
        .from(meetingPeople)
        .where(eq(meetingPeople.meetingId, calendarMeetingId))
      const existingSet = new Set(existingPeople.map(r => r.personId))
      const srcPeople = await ctx.db
        .select({ personId: meetingPeople.personId })
        .from(meetingPeople)
        .where(eq(meetingPeople.meetingId, meetingId))
      for (const { personId } of srcPeople) {
        if (!existingSet.has(personId)) {
          await ctx.db.insert(meetingPeople).values({ meetingId: calendarMeetingId, personId })
        }
      }
      // Delete the source meeting if it was a voice placeholder (source='voice')
      if (src.source === 'voice') {
        await ctx.db.delete(meetings).where(eq(meetings.id, meetingId))
      }

      return { calendarMeetingId }
    }),
})
