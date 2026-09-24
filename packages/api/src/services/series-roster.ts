/**
 * Circles: a recurring series keeps a standing roster read once from the calendar, so the owner
 * never re-adds the same participants per occurrence. Roster rows are not CRM people until followed.
 */
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import {
  meetingAnalyses,
  meetingNotes,
  meetingRosterExceptions,
  meetingSeries,
  meetings,
  people,
  seriesRoster,
  tasks,
  type getDb,
  type SeriesRosterRow,
  type MeetingRosterException,
} from '@ak-system/database'
import {
  normalizeParticipantName,
  parseStoredParticipants,
  participantKey,
  type CalendarParticipant,
} from '../lib/calendar-participants'
import { seriesWarmth, type WarmthResult } from './warmth'

type Db = ReturnType<typeof getDb>

export interface OpenLoop {
  content: string
  owner: string | null
  meetingId: string
  meetingDate: string
  taskId: string | null
}

export interface CalendarDiff {
  newInCalendar: CalendarParticipant[]
  missingFromCalendar: SeriesRosterRow[]
  signature: string
  /** Latest calendar occurrence the diff was computed against */
  occurrenceId: string | null
}

export interface CircleNote {
  id: string
  title: string
  date: string | null
  snippet: string | null
  notionUrl: string | null
  meetingId: string | null
}

export interface CircleView {
  series: Awaited<ReturnType<typeof seriesOrThrow>>
  roster: SeriesRosterRow[]
  rosterCount: number
  calendarParticipants: CalendarParticipant[]
  diff: CalendarDiff | null
  notes: CircleNote[]
  openLoops: OpenLoop[]
  recommendation: string | null
  warmth: WarmthResult
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function rosterKeys(r: { displayName: string; email: string | null }): string[] {
  const keys = [`n:${normalizeParticipantName(r.displayName)}`]
  if (r.email) keys.unshift(`e:${r.email.toLowerCase()}`)
  return keys
}

function participantKeys(p: CalendarParticipant): string[] {
  const keys = [`n:${normalizeParticipantName(p.name)}`]
  if (p.email) keys.unshift(`e:${p.email.toLowerCase()}`)
  return keys
}

async function seriesOrThrow(db: Db, seriesId: string) {
  const [series] = await db.select().from(meetingSeries).where(eq(meetingSeries.id, seriesId)).limit(1)
  if (!series) throw new Error('Series not found')
  return series
}

/** Next upcoming occurrence with a participant snapshot, else the latest past one. */
export async function latestCalendarOccurrence(
  db: Db,
  seriesId: string,
  today = new Date().toISOString().slice(0, 10),
): Promise<{ id: string; participants: CalendarParticipant[] } | null> {
  const rows = await db
    .select({ id: meetings.id, date: meetings.date, calendarParticipants: meetings.calendarParticipants })
    .from(meetings)
    .where(and(eq(meetings.seriesId, seriesId), isNotNull(meetings.calendarParticipants)))
    .orderBy(asc(meetings.date))
  if (rows.length === 0) return null
  const pick = rows.find((r) => r.date >= today) ?? rows[rows.length - 1]
  return { id: pick.id, participants: parseStoredParticipants(pick.calendarParticipants) }
}

export async function listRoster(db: Db, seriesId: string, includeInactive = false): Promise<SeriesRosterRow[]> {
  const rows = await db
    .select()
    .from(seriesRoster)
    .where(eq(seriesRoster.seriesId, seriesId))
    .orderBy(asc(seriesRoster.displayName))
  return includeInactive ? rows : rows.filter((r) => !r.inactive)
}

export function diffRoster(
  roster: SeriesRosterRow[],
  participants: CalendarParticipant[],
  occurrenceId: string | null,
): CalendarDiff {
  const active = roster.filter((r) => !r.inactive)
  const rosterKeySet = new Set(active.flatMap(rosterKeys))
  const participantKeySet = new Set(participants.flatMap(participantKeys))
  const newInCalendar = participants.filter((p) => !participantKeys(p).some((k) => rosterKeySet.has(k)))
  const missingFromCalendar = active.filter(
    (r) => r.source !== 'manual' && !rosterKeys(r).some((k) => participantKeySet.has(k)),
  )
  const signature = [
    ...newInCalendar.map((p) => `+${participantKey(p)}`),
    ...missingFromCalendar.map((r) => `-${r.id}`),
  ].sort().join('|')
  return { newInCalendar, missingFromCalendar, signature, occurrenceId }
}

async function peopleByEmail(db: Db, emails: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const wanted = [...new Set(emails.filter(Boolean).map((e) => e.toLowerCase()))]
  if (wanted.length === 0) return out
  const rows = await db
    .select({ id: people.id, email: people.email, status: people.status })
    .from(people)
    .where(inArray(sql`lower(${people.email})`, wanted))
  for (const r of rows) {
    if (r.email && r.status !== 'ignored') out.set(r.email.toLowerCase(), r.id)
  }
  return out
}

async function insertRosterRows(db: Db, seriesId: string, participants: CalendarParticipant[], now: string) {
  if (participants.length === 0) return
  const known = await peopleByEmail(db, participants.map((p) => p.email ?? ''))
  await db.insert(seriesRoster).values(
    participants.map((p) => ({
      id: newId('sr'),
      seriesId,
      displayName: p.name,
      email: p.email,
      source: p.source,
      personId: p.email ? (known.get(p.email.toLowerCase()) ?? null) : null,
      inactive: false,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

/** First save: copy the latest calendar occurrence's participants into the roster. */
export async function saveRosterFromCalendar(db: Db, seriesId: string): Promise<{ added: number }> {
  await seriesOrThrow(db, seriesId)
  const occurrence = await latestCalendarOccurrence(db, seriesId)
  const participants = occurrence?.participants ?? []
  const roster = await listRoster(db, seriesId, true)
  const now = new Date().toISOString()
  const existingKeys = new Set(roster.flatMap(rosterKeys))
  const toAdd = participants.filter((p) => !participantKeys(p).some((k) => existingKeys.has(k)))
  await insertRosterRows(db, seriesId, toAdd, now)
  await db
    .update(meetingSeries)
    .set({ rosterSavedAt: now, rosterDismissedSig: null, updatedAt: now })
    .where(eq(meetingSeries.id, seriesId))
  return { added: toAdd.length }
}

/** Accept the calendar diff: add newcomers, retire people no longer invited. */
export async function applyCalendarDiff(db: Db, seriesId: string): Promise<{ added: number; retired: number }> {
  await seriesOrThrow(db, seriesId)
  const occurrence = await latestCalendarOccurrence(db, seriesId)
  const roster = await listRoster(db, seriesId, true)
  const diff = diffRoster(roster, occurrence?.participants ?? [], occurrence?.id ?? null)
  const now = new Date().toISOString()

  // Newcomers that match a retired row are reactivated rather than duplicated.
  const retiredByKey = new Map<string, SeriesRosterRow>()
  for (const r of roster.filter((r) => r.inactive)) for (const k of rosterKeys(r)) retiredByKey.set(k, r)
  const fresh: CalendarParticipant[] = []
  for (const p of diff.newInCalendar) {
    const retired = participantKeys(p).map((k) => retiredByKey.get(k)).find(Boolean)
    if (retired) {
      await db.update(seriesRoster).set({ inactive: false, updatedAt: now }).where(eq(seriesRoster.id, retired.id))
    } else {
      fresh.push(p)
    }
  }
  await insertRosterRows(db, seriesId, fresh, now)
  if (diff.missingFromCalendar.length > 0) {
    await db
      .update(seriesRoster)
      .set({ inactive: true, updatedAt: now })
      .where(inArray(seriesRoster.id, diff.missingFromCalendar.map((r) => r.id)))
  }
  await db
    .update(meetingSeries)
    .set({ rosterSavedAt: now, rosterDismissedSig: null, updatedAt: now })
    .where(eq(meetingSeries.id, seriesId))
  return { added: diff.newInCalendar.length, retired: diff.missingFromCalendar.length }
}

export async function dismissCalendarDiff(db: Db, seriesId: string): Promise<void> {
  const occurrence = await latestCalendarOccurrence(db, seriesId)
  const roster = await listRoster(db, seriesId, true)
  const diff = diffRoster(roster, occurrence?.participants ?? [], occurrence?.id ?? null)
  await db
    .update(meetingSeries)
    .set({ rosterDismissedSig: diff.signature, updatedAt: new Date().toISOString() })
    .where(eq(meetingSeries.id, seriesId))
}

export async function addRosterMember(
  db: Db,
  seriesId: string,
  input: { name: string; email?: string | null },
): Promise<SeriesRosterRow> {
  await seriesOrThrow(db, seriesId)
  const now = new Date().toISOString()
  const email = input.email?.trim().toLowerCase() || null
  const known = await peopleByEmail(db, email ? [email] : [])
  const row = {
    id: newId('sr'),
    seriesId,
    displayName: input.name.trim(),
    email,
    source: 'manual',
    personId: email ? (known.get(email) ?? null) : null,
    inactive: false,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(seriesRoster).values(row)
  return row
}

export async function retireRosterMember(db: Db, rosterId: string): Promise<void> {
  await db.update(seriesRoster).set({ inactive: true, updatedAt: new Date().toISOString() }).where(eq(seriesRoster.id, rosterId))
}

/** "עקוב": promote a roster row to a confirmed CRM person (reusing one with the same email). */
export async function followRosterMember(db: Db, rosterId: string): Promise<{ personId: string; created: boolean }> {
  const [row] = await db.select().from(seriesRoster).where(eq(seriesRoster.id, rosterId)).limit(1)
  if (!row) throw new Error('Roster member not found')
  const now = new Date().toISOString()
  if (row.personId) {
    await db.update(people).set({ status: 'confirmed' }).where(eq(people.id, row.personId))
    return { personId: row.personId, created: false }
  }
  const known = row.email ? (await peopleByEmail(db, [row.email])).get(row.email.toLowerCase()) : undefined
  let personId = known
  if (personId) {
    await db.update(people).set({ status: 'confirmed' }).where(eq(people.id, personId))
  } else {
    personId = newId('p_circle')
    await db.insert(people).values({
      id: personId,
      name: row.displayName,
      email: row.email,
      role: null,
      color: '#e8c547',
      status: 'confirmed',
      source: 'calendar',
      createdAt: now,
    })
  }
  await db.update(seriesRoster).set({ personId, updatedAt: now }).where(eq(seriesRoster.id, rosterId))
  return { personId, created: !known }
}

export async function listExceptions(db: Db, meetingId: string): Promise<MeetingRosterException[]> {
  return db.select().from(meetingRosterExceptions).where(eq(meetingRosterExceptions.meetingId, meetingId))
}

export async function markAbsent(db: Db, meetingId: string, rosterId: string): Promise<void> {
  const [row] = await db.select().from(seriesRoster).where(eq(seriesRoster.id, rosterId)).limit(1)
  if (!row) throw new Error('Roster member not found')
  const existing = await listExceptions(db, meetingId)
  if (existing.some((e) => e.kind === 'absent' && e.rosterId === rosterId)) return
  await db.insert(meetingRosterExceptions).values({
    id: newId('mre'),
    meetingId,
    kind: 'absent',
    rosterId,
    displayName: row.displayName,
    email: row.email,
    createdAt: new Date().toISOString(),
  })
}

export async function addGuest(db: Db, meetingId: string, input: { name: string; email?: string | null }): Promise<void> {
  await db.insert(meetingRosterExceptions).values({
    id: newId('mre'),
    meetingId,
    kind: 'guest',
    rosterId: null,
    displayName: input.name.trim(),
    email: input.email?.trim().toLowerCase() || null,
    createdAt: new Date().toISOString(),
  })
}

export async function removeException(db: Db, exceptionId: string): Promise<void> {
  await db.delete(meetingRosterExceptions).where(eq(meetingRosterExceptions.id, exceptionId))
}

/** Who is expected at one occurrence: roster − absent + guests. */
export async function occurrenceAttendance(db: Db, meetingId: string) {
  const [meeting] = await db
    .select({ id: meetings.id, seriesId: meetings.seriesId })
    .from(meetings)
    .where(eq(meetings.id, meetingId))
    .limit(1)
  if (!meeting?.seriesId) return null
  const [series] = await db
    .select({ rosterSavedAt: meetingSeries.rosterSavedAt })
    .from(meetingSeries)
    .where(eq(meetingSeries.id, meeting.seriesId))
    .limit(1)
  if (!series?.rosterSavedAt) return null
  const roster = await listRoster(db, meeting.seriesId)
  const exceptions = await listExceptions(db, meetingId)
  const absentIds = new Set(exceptions.filter((e) => e.kind === 'absent').map((e) => e.rosterId))
  const present = roster.filter((r) => !absentIds.has(r.id))
  const guests = exceptions.filter((e) => e.kind === 'guest')
  return {
    seriesId: meeting.seriesId,
    present,
    absent: exceptions.filter((e) => e.kind === 'absent'),
    guests,
    expectedCount: present.length + guests.length,
  }
}

function parseActionItems(json: string | null): { content: string; owner: string | null; taskId: string | null }[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((i) => i && typeof i.content === 'string' && i.content.trim())
      .map((i) => ({
        content: i.content.trim(),
        owner: typeof i.owner === 'string' && i.owner.trim() ? i.owner.trim() : null,
        taskId: typeof i.taskId === 'string' ? i.taskId : null,
      }))
  } catch {
    return []
  }
}

/** Action items from the given meetings' latest analyses whose linked task is not done. */
export async function openLoopsForMeetings(
  db: Db,
  meetingIds: string[],
  filter?: (item: { owner: string | null }) => boolean,
): Promise<OpenLoop[]> {
  if (meetingIds.length === 0) return []
  const rows = await db
    .select({
      meetingId: meetings.id,
      date: meetings.date,
      actionItemsJson: meetingAnalyses.actionItemsJson,
    })
    .from(meetingAnalyses)
    .innerJoin(meetings, eq(meetings.id, meetingAnalyses.meetingId))
    .where(inArray(meetings.id, meetingIds))
    .orderBy(desc(meetings.date))
  const loops: OpenLoop[] = []
  for (const r of rows) {
    for (const item of parseActionItems(r.actionItemsJson)) {
      if (filter && !filter(item)) continue
      loops.push({ ...item, meetingId: r.meetingId, meetingDate: r.date })
    }
  }
  const taskIds = loops.map((l) => l.taskId).filter((id): id is string => !!id)
  if (taskIds.length === 0) return loops
  const done = new Set(
    (await db.select({ id: tasks.id, done: tasks.done }).from(tasks).where(inArray(tasks.id, taskIds)))
      .filter((t) => t.done)
      .map((t) => t.id),
  )
  return loops.filter((l) => !l.taskId || !done.has(l.taskId))
}

function formatDateHe(date: string): string {
  const [y, m, d] = date.split('-')
  return y && m && d ? `${Number(d)}.${Number(m)}` : date
}

export function circleRecommendation(input: {
  rosterSaved: boolean
  latestNote: CircleNote | null
  latestInsight: string | null
  openLoops: OpenLoop[]
  trend: WarmthResult['trend']
}): string | null {
  if (!input.rosterSaved) return null
  const parts: string[] = []
  if (input.latestNote) {
    const when = input.latestNote.date ? ` (${formatDateHe(input.latestNote.date)})` : ''
    const gist = input.latestInsight || input.latestNote.snippet?.trim().slice(0, 120)
    parts.push(gist ? `בפגישה האחרונה${when}: ${gist}` : `הסיכום האחרון${when} מחכה לקריאה`)
  }
  if (input.openLoops.length > 0) parts.push(`${input.openLoops.length} משימות פתוחות מהפגישות הקודמות`)
  if (input.trend === 'cooling') parts.push('האווירה נעשית פחות פרודוקטיבית · כדאי לבדוק מה קורה')
  if (input.trend === 'warming') parts.push('הפגישה משתפרת · הצוות יותר מעורב')
  if (parts.length === 0) return 'אין עדיין סיכום לפגישה הזו · שווה לתעד את הבאה'
  return parts.join(' · ')
}

export async function getCircle(db: Db, seriesId: string): Promise<CircleView> {
  const series = await seriesOrThrow(db, seriesId)
  const roster = await listRoster(db, seriesId, true)
  const active = roster.filter((r) => !r.inactive)
  const occurrence = await latestCalendarOccurrence(db, seriesId)
  const calendarParticipants = occurrence?.participants ?? []

  let diff: CalendarDiff | null = null
  if (series.rosterSavedAt && occurrence) {
    const d = diffRoster(roster, calendarParticipants, occurrence.id)
    const hasChanges = d.newInCalendar.length > 0 || d.missingFromCalendar.length > 0
    if (hasChanges && d.signature !== series.rosterDismissedSig) diff = d
  }

  const instances = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(eq(meetings.seriesId, seriesId))
  const instanceIds = instances.map((i) => i.id)
  const notes: CircleNote[] = instanceIds.length
    ? await db
        .select({
          id: meetingNotes.id,
          title: meetingNotes.title,
          date: meetingNotes.date,
          snippet: meetingNotes.snippet,
          notionUrl: meetingNotes.notionUrl,
          meetingId: meetingNotes.meetingId,
        })
        .from(meetingNotes)
        .where(inArray(meetingNotes.meetingId, instanceIds))
        .orderBy(desc(meetingNotes.date))
        .limit(10)
    : []

  const [latestAnalysis] = instanceIds.length
    ? await db
        .select({ meetingId: meetingAnalyses.meetingId, keyInsight: meetingAnalyses.keyInsight })
        .from(meetingAnalyses)
        .innerJoin(meetings, eq(meetings.id, meetingAnalyses.meetingId))
        .where(inArray(meetingAnalyses.meetingId, instanceIds))
        .orderBy(desc(meetings.date))
        .limit(1)
    : []
  const openLoops = latestAnalysis ? await openLoopsForMeetings(db, [latestAnalysis.meetingId]) : []
  const warmth = await seriesWarmth(db, seriesId)

  return {
    series,
    roster: active,
    rosterCount: active.length,
    calendarParticipants,
    diff,
    notes,
    openLoops,
    recommendation: circleRecommendation({
      rosterSaved: !!series.rosterSavedAt,
      latestNote: notes[0] ?? null,
      latestInsight: latestAnalysis?.keyInsight?.trim() || null,
      openLoops,
      trend: warmth.trend,
    }),
    warmth,
  }
}

/** Series a person belongs to via a followed roster row. */
export async function circlesForPerson(db: Db, personId: string) {
  const rows = await db
    .select({ seriesId: meetingSeries.id, seriesTitle: meetingSeries.title, cadence: meetingSeries.cadence })
    .from(seriesRoster)
    .innerJoin(meetingSeries, eq(meetingSeries.id, seriesRoster.seriesId))
    .where(and(eq(seriesRoster.personId, personId), eq(seriesRoster.inactive, false)))
  const seen = new Set<string>()
  return rows.filter((r) => (seen.has(r.seriesId) ? false : (seen.add(r.seriesId), true)))
}
