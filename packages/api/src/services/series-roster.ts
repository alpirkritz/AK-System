/**
 * Circles: a recurring series keeps a standing roster read once from the calendar, so the owner
 * never re-adds the same participants per occurrence. Every roster row is a People record: picked from
 * People, created there from the circle, or matched/created (unconfirmed) when imported from the calendar.
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
  normalizeDisplayName,
  normalizeParticipantName,
  parseStoredParticipants,
  participantKey,
  type CalendarParticipant,
} from '../lib/calendar-participants'
import { seriesInsight, seriesWarmth, type WarmthResult } from './warmth'
import { resolvePerson } from './person-resolution'

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
  roster: CircleRosterRow[]
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

export interface RosterPerson {
  id: string
  name: string
  status: string
}

export type CircleRosterRow = SeriesRosterRow & { person: RosterPerson | null }

/** Existing (non-ignored) person by email, then exact alias or name. Never fuzzy. */
async function matchPerson(db: Db, p: { name: string; email: string | null }): Promise<string | null> {
  const hit = await resolvePerson(db, { name: p.name, email: p.email })
  return hit.kind === 'match' ? hit.personId : null
}

/**
 * The People record for a calendar attendee: an existing match, else a new `unconfirmed` person
 * (source calendar) so they wait in the People review queue instead of the main list.
 */
async function personForAttendee(db: Db, p: { name: string; email: string | null }, now: string): Promise<string> {
  const known = await matchPerson(db, p)
  if (known) return known
  const id = newId('p_circle')
  await db.insert(people).values({
    id,
    name: normalizeDisplayName(p.name) || p.name,
    email: p.email,
    role: null,
    color: '#e8c547',
    status: 'unconfirmed',
    source: 'calendar',
    createdAt: now,
  })
  return id
}

async function insertRosterRows(
  db: Db,
  seriesId: string,
  participants: { name: string; email: string | null; source: 'attendees' | 'description' | 'manual'; personId?: string }[],
  now: string,
) {
  if (participants.length === 0) return
  const rows = []
  for (const p of participants) {
    rows.push({
      id: newId('sr'),
      seriesId,
      displayName: p.name,
      email: p.email,
      source: p.source,
      personId: p.personId ?? (await personForAttendee(db, p, now)),
      inactive: false,
      createdAt: now,
      updatedAt: now,
    })
  }
  await db.insert(seriesRoster).values(rows)
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

async function usablePeople(db: Db, ids: string[]): Promise<Map<string, { id: string; name: string; email: string | null; status: string }>> {
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({ id: people.id, name: people.name, email: people.email, status: people.status })
    .from(people)
    .where(inArray(people.id, ids))
  return new Map(rows.filter((r) => r.status !== 'ignored').map((r) => [r.id, r]))
}

export class CirclePersonError extends Error {}

/**
 * Replace the active roster with people picked from People. A row already linked to a picked
 * person is kept (or reactivated), so its history and exceptions stay; everyone else is retired.
 */
export async function saveRosterFromPeople(
  db: Db,
  seriesId: string,
  personIds: string[],
): Promise<{ saved: number; added: number; retired: number }> {
  await seriesOrThrow(db, seriesId)
  const wanted = [...new Set(personIds)]
  if (wanted.length === 0) throw new CirclePersonError('No people')
  const found = await usablePeople(db, wanted)
  const missing = wanted.filter((id) => !found.has(id))
  if (missing.length > 0) throw new CirclePersonError(`Unknown people: ${missing.join(', ')}`)

  const roster = await listRoster(db, seriesId, true)
  const now = new Date().toISOString()
  const keep = new Set<string>()
  let added = 0
  for (const personId of wanted) {
    const person = found.get(personId)!
    const match = roster
      .filter((r) => r.personId === personId && !keep.has(r.id))
      .sort((a, b) => Number(a.inactive) - Number(b.inactive))[0]
    if (match) {
      keep.add(match.id)
      if (match.inactive || match.displayName !== person.name) {
        await db
          .update(seriesRoster)
          .set({ inactive: false, displayName: person.name, updatedAt: now })
          .where(eq(seriesRoster.id, match.id))
      }
    } else {
      await insertRosterRows(db, seriesId, [{ name: person.name, email: person.email, source: 'manual', personId }], now)
      added++
    }
  }
  const toRetire = roster.filter((r) => !r.inactive && !keep.has(r.id)).map((r) => r.id)
  if (toRetire.length > 0) {
    await db.update(seriesRoster).set({ inactive: true, updatedAt: now }).where(inArray(seriesRoster.id, toRetire))
  }
  await db
    .update(meetingSeries)
    .set({ rosterSavedAt: now, rosterDismissedSig: null, updatedAt: now })
    .where(eq(meetingSeries.id, seriesId))
  return { saved: wanted.length, added, retired: toRetire.length }
}

/** "צור באנשים" from the circle picker: a confirmed person, or the existing one with that email. */
export async function createPersonForCircle(
  db: Db,
  input: { name: string; email?: string | null },
): Promise<{ id: string; name: string; created: boolean }> {
  const email = input.email?.trim().toLowerCase() || null
  if (email) {
    const hit = await resolvePerson(db, { email })
    if (hit.kind === 'match' && hit.via === 'email') {
      const [row] = await db.select({ id: people.id, name: people.name }).from(people).where(eq(people.id, hit.personId))
      if (row) return { ...row, created: false }
    }
  }
  const name = normalizeDisplayName(input.name.trim()) || input.name.trim()
  const id = newId('p_circle')
  await db.insert(people).values({
    id,
    name,
    email,
    role: null,
    color: '#e8c547',
    status: 'confirmed',
    source: 'manual',
    createdAt: new Date().toISOString(),
  })
  return { id, name, created: true }
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
      const personId = retired.personId ?? (await personForAttendee(db, p, now))
      await db.update(seriesRoster).set({ inactive: false, personId, updatedAt: now }).where(eq(seriesRoster.id, retired.id))
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

export async function retireRosterMember(db: Db, rosterId: string): Promise<void> {
  await db.update(seriesRoster).set({ inactive: true, updatedAt: new Date().toISOString() }).where(eq(seriesRoster.id, rosterId))
}

/** Link a legacy (unlinked) row to a person; a duplicate of an active member is retired instead. */
export async function linkRosterMember(db: Db, rosterId: string, personId: string): Promise<void> {
  const [row] = await db.select().from(seriesRoster).where(eq(seriesRoster.id, rosterId)).limit(1)
  if (!row) throw new Error('Roster member not found')
  const person = (await usablePeople(db, [personId])).get(personId)
  if (!person) throw new CirclePersonError('Unknown person')
  const now = new Date().toISOString()
  const [dup] = await db
    .select({ id: seriesRoster.id })
    .from(seriesRoster)
    .where(and(eq(seriesRoster.seriesId, row.seriesId), eq(seriesRoster.personId, personId), eq(seriesRoster.inactive, false)))
    .limit(1)
  if (dup && dup.id !== row.id) {
    await db.update(seriesRoster).set({ inactive: true, updatedAt: now }).where(eq(seriesRoster.id, row.id))
    return
  }
  await db
    .update(seriesRoster)
    .set({ personId, displayName: person.name, email: row.email ?? person.email, updatedAt: now })
    .where(eq(seriesRoster.id, rosterId))
}

/** "אשר באנשים": confirm the (unconfirmed, calendar-created) person behind a roster row. */
export async function confirmRosterMember(db: Db, rosterId: string): Promise<{ personId: string }> {
  const [row] = await db.select().from(seriesRoster).where(eq(seriesRoster.id, rosterId)).limit(1)
  if (!row?.personId) throw new Error('Roster member not found')
  await db.update(people).set({ status: 'confirmed' }).where(eq(people.id, row.personId))
  return { personId: row.personId }
}

/** Match legacy unlinked active rows to existing People (no creation). */
async function backfillRosterLinks(db: Db, roster: SeriesRosterRow[]): Promise<SeriesRosterRow[]> {
  const now = new Date().toISOString()
  const linked = new Set(roster.filter((r) => !r.inactive && r.personId).map((r) => r.personId))
  const out: SeriesRosterRow[] = []
  for (const r of roster) {
    if (r.inactive || r.personId) {
      out.push(r)
      continue
    }
    const personId = await matchPerson(db, { name: r.displayName, email: r.email })
    if (personId && !linked.has(personId)) {
      linked.add(personId)
      await db.update(seriesRoster).set({ personId, updatedAt: now }).where(eq(seriesRoster.id, r.id))
      out.push({ ...r, personId })
    } else {
      out.push(r)
    }
  }
  return out
}

/** Roster rows with their People record; the name shown is always the person's current name. */
async function withPeople(db: Db, rows: SeriesRosterRow[]): Promise<CircleRosterRow[]> {
  const ids = [...new Set(rows.map((r) => r.personId).filter((id): id is string => !!id))]
  const found = ids.length
    ? await db.select({ id: people.id, name: people.name, status: people.status }).from(people).where(inArray(people.id, ids))
    : []
  const byId = new Map(found.map((p) => [p.id, p]))
  return rows
    .map((r) => {
      const person = r.personId ? byId.get(r.personId) ?? null : null
      return { ...r, displayName: person?.name ?? r.displayName, person }
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'he'))
}

/** Circle summary for a meeting (calendar event panel). Null when the meeting is not in a series. */
export async function circleForMeeting(db: Db, meetingId: string) {
  const [meeting] = await db
    .select({ id: meetings.id, seriesId: meetings.seriesId })
    .from(meetings)
    .where(eq(meetings.id, meetingId))
    .limit(1)
  if (!meeting?.seriesId) return null
  const [series] = await db
    .select({ rosterSavedAt: meetingSeries.rosterSavedAt, title: meetingSeries.title })
    .from(meetingSeries)
    .where(eq(meetingSeries.id, meeting.seriesId))
    .limit(1)
  if (!series) return null
  const roster = series.rosterSavedAt ? await withPeople(db, await listRoster(db, meeting.seriesId)) : []
  return {
    seriesId: meeting.seriesId,
    meetingId,
    title: series.title,
    saved: !!series.rosterSavedAt,
    count: roster.length,
    names: roster.slice(0, 5).map((r) => r.displayName),
  }
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
  const roster = await backfillRosterLinks(db, await listRoster(db, seriesId, true))
  const active = await withPeople(db, roster.filter((r) => !r.inactive))
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
    insight: await seriesInsight(db, seriesId),
  }
}

/** Series a person belongs to via an active roster row. */
export async function circlesForPerson(db: Db, personId: string) {
  const rows = await db
    .select({ seriesId: meetingSeries.id, seriesTitle: meetingSeries.title, cadence: meetingSeries.cadence })
    .from(seriesRoster)
    .innerJoin(meetingSeries, eq(meetingSeries.id, seriesRoster.seriesId))
    .where(and(eq(seriesRoster.personId, personId), eq(seriesRoster.inactive, false)))
  const seen = new Set<string>()
  return rows.filter((r) => (seen.has(r.seriesId) ? false : (seen.add(r.seriesId), true)))
}
