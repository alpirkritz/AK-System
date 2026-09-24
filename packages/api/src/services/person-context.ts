/**
 * One context card per person: Notion meetings and watched-group WhatsApp reconciled into a
 * recommendation, then open loops, WhatsApp since the last Notion meeting, notes, older WhatsApp.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import {
  meetingNotePeople,
  meetingNotes,
  meetingPeople,
  meetingSeries,
  meetings,
  people,
  whatsappGroups,
  whatsappMessages,
  whatsappPersonLinks,
  type getDb,
} from '@ak-system/database'
import { normalizeParticipantName } from '../lib/calendar-participants'
import { normalizePhone, phoneFromWhatsappJid } from '../lib/phone'
import { circlesForPerson, getCircle, occurrenceAttendance, openLoopsForMeetings, type OpenLoop } from './series-roster'
import { personWarmth, seriesWarmth, type WarmthResult } from './warmth'

type Db = ReturnType<typeof getDb>

export interface WhatsAppSnippet {
  id: string
  groupJid: string
  groupName: string | null
  senderName: string
  text: string
  ts: number
}

export interface CircleSummary {
  seriesId: string
  seriesTitle: string
  cadence: string | null
}

export interface PersonContextExtras {
  recommendation: string | null
  lastNotionMeetingDate: string | null
  openLoopsForPerson: OpenLoop[]
  whatsappSinceMeeting: WhatsAppSnippet[]
  olderWhatsapp: WhatsAppSnippet[]
  whatsappSenders: { jid: string; matchedBy: string }[]
  circles: CircleSummary[]
  warmth: WarmthResult
}

const SINCE_LIMIT = 20
const OLDER_LIMIT = 10

/**
 * Sender JIDs that belong to this person: manual links plus phone matches on user JIDs.
 * A phone match is skipped when that JID is linked elsewhere or was rejected (`blocked`).
 */
export async function senderJidsForPerson(db: Db, personId: string, phone: string | null) {
  const links = await db
    .select({ jid: whatsappPersonLinks.whatsappJid, matchedBy: whatsappPersonLinks.matchedBy })
    .from(whatsappPersonLinks)
    .where(eq(whatsappPersonLinks.personId, personId))
  const out = new Map(links.filter((l) => l.matchedBy !== 'blocked').map((l) => [l.jid, l.matchedBy]))
  const target = normalizePhone(phone)
  if (target) {
    const senders = (
      await db
        .select({ sender: whatsappMessages.sender })
        .from(whatsappMessages)
        .where(sql`${whatsappMessages.sender} like ${`%${target.slice(-9)}%`}`)
        .groupBy(whatsappMessages.sender)
    )
      .map((s) => s.sender)
      .filter((jid) => !out.has(jid) && phoneFromWhatsappJid(jid) === target)
    const claimed = senders.length
      ? new Set(
          (await db.select({ jid: whatsappPersonLinks.whatsappJid }).from(whatsappPersonLinks).where(inArray(whatsappPersonLinks.whatsappJid, senders)))
            .map((l) => l.jid),
        )
      : new Set<string>()
    for (const jid of senders) if (!claimed.has(jid)) out.set(jid, 'phone')
  }
  return [...out].map(([jid, matchedBy]) => ({ jid, matchedBy }))
}

function ownerMatchesPerson(owner: string | null, personName: string): boolean {
  if (!owner) return false
  const o = normalizeParticipantName(owner)
  const p = normalizeParticipantName(personName)
  if (!o || !p) return false
  if (o === p) return true
  const first = p.split(' ')[0]
  return first.length >= 2 && o.split(' ').includes(first)
}

function shortDate(date: string): string {
  const [, m, d] = date.split('-')
  return m && d ? `${Number(d)}.${Number(m)}` : date
}

function quote(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export function personRecommendation(input: {
  lastNotionMeetingDate: string | null
  latestWhatsapp: WhatsAppSnippet | null
  whatsappSinceCount: number
  openLoopCount: number
  trend: WarmthResult['trend']
  /** Meeting prep never carries raw chat text. */
  quoteChat?: boolean
}): string | null {
  const parts: string[] = []
  const { lastNotionMeetingDate: noteDate, latestWhatsapp: wa } = input
  const quoteChat = input.quoteChat ?? true
  if (noteDate && input.whatsappSinceCount > 0 && wa) {
    parts.push(`הוואטסאפ חדש יותר מהפגישה ב-${shortDate(noteDate)} · הסיכום בנושן לא מעודכן`)
    if (quoteChat) parts.push(`התחל מ: "${quote(wa.text)}"`)
  } else if (noteDate) {
    parts.push(`הסיכום מהפגישה ב-${shortDate(noteDate)} עדיין העדכני ביותר`)
  } else if (wa) {
    parts.push(quoteChat ? `אין פגישה מתועדת · התחל מהוואטסאפ: "${quote(wa.text)}"` : 'אין פגישה מתועדת · השיחה האחרונה בוואטסאפ')
  }
  if (input.openLoopCount > 0) parts.push(`${input.openLoopCount} משימות פתוחות מולו`)
  if (input.trend === 'cooling') parts.push('השיחות האחרונות פחות חמות · כדאי לברר')
  if (input.trend === 'warming') parts.push('הקשר משתפר · המשך כך')
  return parts.length > 0 ? parts.join(' · ') : null
}

export async function buildPersonContext(db: Db, personId: string, today = new Date().toISOString().slice(0, 10)): Promise<PersonContextExtras | null> {
  const [person] = await db.select({ id: people.id, name: people.name, phone: people.phone }).from(people).where(eq(people.id, personId))
  if (!person) return null

  const meetingLinks = await db.select({ meetingId: meetingPeople.meetingId }).from(meetingPeople).where(eq(meetingPeople.personId, personId))
  const meetingIds = [...new Set(meetingLinks.map((l) => l.meetingId))]

  const [noteByLink] = await db
    .select({ date: meetingNotes.date })
    .from(meetingNotePeople)
    .innerJoin(meetingNotes, eq(meetingNotePeople.meetingNoteId, meetingNotes.id))
    .where(and(eq(meetingNotePeople.personId, personId), sql`${meetingNotes.date} <= ${today}`))
    .orderBy(desc(meetingNotes.date))
    .limit(1)
  const [noteByMeeting] = meetingIds.length
    ? await db
        .select({ date: meetings.date })
        .from(meetingNotes)
        .innerJoin(meetings, eq(meetings.id, meetingNotes.meetingId))
        .where(and(inArray(meetings.id, meetingIds), sql`${meetings.date} <= ${today}`))
        .orderBy(desc(meetings.date))
        .limit(1)
    : []
  const lastNotionMeetingDate = [noteByLink?.date, noteByMeeting?.date].filter((d): d is string => !!d).sort().pop() ?? null

  const openLoopsForPerson = await openLoopsForMeetings(db, meetingIds, (item) => ownerMatchesPerson(item.owner, person.name))

  const whatsappSenders = await senderJidsForPerson(db, personId, person.phone)
  let whatsappSinceMeeting: WhatsAppSnippet[] = []
  let olderWhatsapp: WhatsAppSnippet[] = []
  if (whatsappSenders.length > 0) {
    const cutoff = lastNotionMeetingDate ? new Date(`${lastNotionMeetingDate}T23:59:59`).getTime() : 0
    const rows = await db
      .select({
        id: whatsappMessages.id,
        groupJid: whatsappMessages.groupJid,
        groupName: whatsappGroups.name,
        senderName: whatsappMessages.senderName,
        text: whatsappMessages.text,
        ts: whatsappMessages.ts,
      })
      .from(whatsappMessages)
      .leftJoin(whatsappGroups, eq(whatsappGroups.jid, whatsappMessages.groupJid))
      .where(inArray(whatsappMessages.sender, whatsappSenders.map((s) => s.jid)))
      .orderBy(desc(whatsappMessages.ts))
      .limit(SINCE_LIMIT + OLDER_LIMIT + 20)
    whatsappSinceMeeting = rows.filter((r) => r.ts > cutoff).slice(0, SINCE_LIMIT)
    olderWhatsapp = rows.filter((r) => r.ts <= cutoff).slice(0, OLDER_LIMIT)
  }

  const circles = await circlesForPerson(db, personId)
  const warmth = await personWarmth(db, personId)

  return {
    recommendation: personRecommendation({
      lastNotionMeetingDate,
      latestWhatsapp: whatsappSinceMeeting[0] ?? olderWhatsapp[0] ?? null,
      whatsappSinceCount: whatsappSinceMeeting.length,
      openLoopCount: openLoopsForPerson.length,
      trend: warmth.trend,
    }),
    lastNotionMeetingDate,
    openLoopsForPerson,
    whatsappSinceMeeting,
    olderWhatsapp,
    whatsappSenders,
    circles,
    warmth,
  }
}

export interface MeetingPrepRelationship {
  kind: 'circle' | 'people' | 'none'
  lines: string[]
  /** Circle meetings list a count instead of every participant. */
  circleTitle: string | null
  rosterCount: number | null
}

const PREP_MAX_PEOPLE = 5
const PREP_MAX_LOOPS = 5

/**
 * Structured relationship lines for meeting prep: circle recommendation for rostered series,
 * otherwise one line per linked person. Never includes raw WhatsApp text.
 */
export async function meetingPrepRelationship(db: Db, meetingId: string): Promise<MeetingPrepRelationship> {
  const [meeting] = await db
    .select({ id: meetings.id, seriesId: meetings.seriesId })
    .from(meetings)
    .where(eq(meetings.id, meetingId))
    .limit(1)
  if (!meeting) return { kind: 'none', lines: [], circleTitle: null, rosterCount: null }

  if (meeting.seriesId) {
    const circle = await getCircle(db, meeting.seriesId)
    if (circle.series.rosterSavedAt) {
      const attendance = await occurrenceAttendance(db, meetingId)
      const lines: string[] = []
      if (circle.recommendation) lines.push(`המלצה לחוג: ${circle.recommendation}`)
      for (const loop of circle.openLoops.slice(0, PREP_MAX_LOOPS)) {
        lines.push(`משימה פתוחה: ${loop.content}${loop.owner ? ` (${loop.owner})` : ''}`)
      }
      if (attendance && attendance.absent.length > 0) {
        lines.push(`חסרים היום: ${attendance.absent.map((a) => a.displayName).join(', ')}`)
      }
      if (attendance && attendance.guests.length > 0) {
        lines.push(`אורחים היום: ${attendance.guests.map((g) => g.displayName).join(', ')}`)
      }
      if (circle.warmth.trend === 'cooling') lines.push('שים לב: אווירת הפגישה מתדרדרת לפי הסיכומים האחרונים')
      return {
        kind: 'circle',
        lines,
        circleTitle: circle.series.title,
        rosterCount: attendance?.expectedCount ?? circle.rosterCount,
      }
    }
  }

  const links = await db
    .select({ personId: people.id, name: people.name, status: people.status })
    .from(meetingPeople)
    .innerJoin(people, eq(people.id, meetingPeople.personId))
    .where(eq(meetingPeople.meetingId, meetingId))
  const followed = links.filter((l) => l.status === 'confirmed').slice(0, PREP_MAX_PEOPLE)
  const lines: string[] = []
  for (const p of followed) {
    const ctx = await buildPersonContext(db, p.personId)
    if (!ctx) continue
    const rec = personRecommendation({
      lastNotionMeetingDate: ctx.lastNotionMeetingDate,
      latestWhatsapp: ctx.whatsappSinceMeeting[0] ?? ctx.olderWhatsapp[0] ?? null,
      whatsappSinceCount: ctx.whatsappSinceMeeting.length,
      openLoopCount: ctx.openLoopsForPerson.length,
      trend: ctx.warmth.trend,
      quoteChat: false,
    })
    if (rec) lines.push(`${p.name}: ${rec}`)
    for (const loop of ctx.openLoopsForPerson.slice(0, 3)) lines.push(`${p.name} · משימה פתוחה: ${loop.content}`)
    if (ctx.circles.length > 0) lines.push(`${p.name} · חוגים: ${ctx.circles.map((c) => c.seriesTitle).join(', ')}`)
    if (ctx.warmth.trend === 'cooling') lines.push(`שים לב: הקשר עם ${p.name} נראה מתקרר.`)
  }
  return { kind: lines.length > 0 ? 'people' : 'none', lines, circleTitle: null, rosterCount: null }
}

export interface CoolingFlag {
  meetingId: string
  calendarEventId: string | null
  title: string
  /** Followed people on this meeting whose relationship is cooling */
  coolingPeople: string[]
  /** The recurring meeting itself (saved circle) is cooling */
  circleCooling: boolean
}

/** Meetings on `date` that involve a cooling relationship or a cooling circle, for the morning brief. */
export async function coolingFlagsForDate(db: Db, date: string): Promise<CoolingFlag[]> {
  const dayMeetings = await db
    .select({ id: meetings.id, title: meetings.title, seriesId: meetings.seriesId, calendarEventId: meetings.calendarEventId })
    .from(meetings)
    .where(eq(meetings.date, date))
  const warmthByPerson = new Map<string, WarmthResult['trend']>()
  const warmthBySeries = new Map<string, boolean>()
  const flags: CoolingFlag[] = []
  for (const m of dayMeetings) {
    let circleCooling = false
    if (m.seriesId) {
      if (!warmthBySeries.has(m.seriesId)) {
        const [series] = await db
          .select({ rosterSavedAt: meetingSeries.rosterSavedAt })
          .from(meetingSeries)
          .where(eq(meetingSeries.id, m.seriesId))
        warmthBySeries.set(m.seriesId, !!series?.rosterSavedAt && (await seriesWarmth(db, m.seriesId)).trend === 'cooling')
      }
      circleCooling = warmthBySeries.get(m.seriesId)!
    }
    const attendees = await db
      .select({ id: people.id, name: people.name })
      .from(meetingPeople)
      .innerJoin(people, eq(people.id, meetingPeople.personId))
      .where(and(eq(meetingPeople.meetingId, m.id), eq(people.status, 'confirmed')))
    const coolingPeople: string[] = []
    for (const p of attendees.slice(0, 10)) {
      if (!warmthByPerson.has(p.id)) warmthByPerson.set(p.id, (await personWarmth(db, p.id)).trend)
      if (warmthByPerson.get(p.id) === 'cooling') coolingPeople.push(p.name)
    }
    if (circleCooling || coolingPeople.length > 0) {
      flags.push({ meetingId: m.id, calendarEventId: m.calendarEventId, title: m.title, coolingPeople, circleCooling })
    }
  }
  return flags
}

/** Sender JIDs seen in watched groups that nobody is linked to yet, for the manual link picker. */
export async function unlinkedWhatsappSenders(db: Db, query?: string) {
  const rows = await db
    .select({
      jid: whatsappMessages.sender,
      senderName: sql<string>`max(${whatsappMessages.senderName})`,
      count: sql<number>`count(*)`,
      lastTs: sql<number>`max(${whatsappMessages.ts})`,
    })
    .from(whatsappMessages)
    .leftJoin(whatsappPersonLinks, eq(whatsappPersonLinks.whatsappJid, whatsappMessages.sender))
    .where(sql`${whatsappPersonLinks.id} is null or ${whatsappPersonLinks.matchedBy} = 'blocked'`)
    .groupBy(whatsappMessages.sender)
    .orderBy(sql`max(${whatsappMessages.ts}) desc`)
    .limit(200)
  const q = query?.trim().toLowerCase()
  return rows
    .map((r) => ({ ...r, count: Number(r.count), lastTs: Number(r.lastTs) }))
    .filter((r) => !q || r.senderName.toLowerCase().includes(q) || r.jid.includes(q))
    .slice(0, 50)
}

export async function linkWhatsappSender(db: Db, personId: string, jid: string, matchedBy: 'manual' | 'phone' | 'blocked' = 'manual') {
  await db.delete(whatsappPersonLinks).where(eq(whatsappPersonLinks.whatsappJid, jid))
  await db.insert(whatsappPersonLinks).values({
    id: `wpl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    personId,
    whatsappJid: jid,
    matchedBy,
    createdAt: new Date().toISOString(),
  })
}

/** Removes a manual link; for an automatic phone match, records a `blocked` row so it stays off. */
export async function unlinkWhatsappSender(db: Db, personId: string, jid: string) {
  const [existing] = await db
    .select({ id: whatsappPersonLinks.id, personId: whatsappPersonLinks.personId })
    .from(whatsappPersonLinks)
    .where(eq(whatsappPersonLinks.whatsappJid, jid))
  if (existing?.personId === personId) {
    await db.delete(whatsappPersonLinks).where(eq(whatsappPersonLinks.id, existing.id))
    return
  }
  if (!existing) await linkWhatsappSender(db, personId, jid, 'blocked')
}
