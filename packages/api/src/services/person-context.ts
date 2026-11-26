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
  commitments,
  personEmailThreads,
  whatsappDmMessages,
  whatsappDmSummaries,
  whatsappGroups,
  whatsappMessages,
  whatsappPersonLinks,
  type Commitment,
  type getDb,
} from '@ak-system/database'
import { normalizeParticipantName } from '../lib/calendar-participants'
import { normalizePhone, phoneFromWhatsappJid } from '../lib/phone'
import { circlesForPerson, getCircle, occurrenceAttendance, openLoopsForMeetings, type OpenLoop } from './series-roster'
import { personWarmth, seriesWarmth, type WarmthResult } from './warmth'
import { INTERRUPT_SEVERITY, attentionReasonText, isInterrupting, isOpenFlag, loadAttention, personAttention, type PersonAttention } from './relationship-attention'
import { isSelfPersonName } from '../lib/self-identity'
import { dmJidsForPerson } from './whatsapp-dm'
import { slackCaptureForPerson, type SlackPersonCapture } from './slack-capture'
import { commitmentSourceUrl, gmailThreadUrl, prepCommitmentLines } from './commitments'
import { listVoiceRecordings, type VoiceRecordingSummary } from './voice'
import { extractAddresses } from './email-sync'
import { listPersonEmails, type PersonEmailAddress } from './person-emails'

type Db = ReturnType<typeof getDb>

export interface WhatsAppSnippet {
  id: string
  channel: 'group' | 'dm'
  groupJid: string
  groupName: string | null
  senderName: string
  fromMe: boolean
  text: string
  ts: number
  pinned: boolean
}

export interface DmSummarySnippet {
  summary: string
  fromTs: number
  toTs: number
  messageCount: number
}

export interface EmailThreadSnippet {
  id: string
  subject: string
  from: string
  date: string
  snippet: string | null
  messageCount: number
  /** The latest message in the thread was sent by me */
  fromMe: boolean
  gmailUrl: string | null
}

export type PersonCommitment = Commitment & { sourceUrl: string | null }

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
  /** One status across every channel: good, steady, or needs a 1:1. Null when the relationship is too thin. */
  attention: PersonAttention | null
  captureWhatsapp: boolean
  /** Has a phone or a manual link, so a 1:1 chat can be recognised */
  captureReachable: boolean
  latestDmSummary: DmSummarySnippet | null
  /** Counts only: how many Slack messages with this person were captured */
  slack: SlackPersonCapture
  proposedCommitments: PersonCommitment[]
  emailThreads: EmailThreadSnippet[]
  /** Every address this person is matched by, like `whatsappSenders` for mail */
  emailAddresses: PersonEmailAddress[]
  voiceRecordings: VoiceRecordingSummary[]
}

const SINCE_LIMIT = 20
const OLDER_LIMIT = 10
const EMAIL_LIMIT = 20
const VOICE_LIMIT = 3

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
  if (input.trend === 'cooling') parts.push('נראה שהוא לא במיטבו · כדאי לקבוע 1:1')
  if (input.trend === 'warming') parts.push('הקשר משתפר · המשך כך')
  return parts.length > 0 ? parts.join(' · ') : null
}

/** The recommendation's tone word, from the cross-channel status when there is one. */
function attentionTrend(attention: PersonAttention | null, fallback: WarmthResult['trend']): WarmthResult['trend'] {
  if (!attention || attention.status == null) return fallback
  if (isOpenFlag(attention)) return 'cooling'
  return attention.status === 'good' ? 'warming' : 'stable'
}

export async function buildPersonContext(db: Db, personId: string, today = new Date().toISOString().slice(0, 10)): Promise<PersonContextExtras | null> {
  const [person] = await db
    .select({ id: people.id, name: people.name, phone: people.phone, captureWhatsapp: people.captureWhatsapp })
    .from(people)
    .where(eq(people.id, personId))
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
  const fetchLimit = SINCE_LIMIT + OLDER_LIMIT + 20
  const groupRows: WhatsAppSnippet[] = whatsappSenders.length > 0
    ? (
        await db
          .select({
            id: whatsappMessages.id,
            groupJid: whatsappMessages.groupJid,
            groupName: whatsappGroups.name,
            senderName: whatsappMessages.senderName,
            text: whatsappMessages.text,
            ts: whatsappMessages.ts,
            pinned: whatsappMessages.pinned,
          })
          .from(whatsappMessages)
          .leftJoin(whatsappGroups, eq(whatsappGroups.jid, whatsappMessages.groupJid))
          .where(inArray(whatsappMessages.sender, whatsappSenders.map((s) => s.jid)))
          .orderBy(desc(whatsappMessages.ts))
          .limit(fetchLimit)
      ).map((r) => ({ ...r, channel: 'group' as const, fromMe: false, pinned: !!r.pinned }))
    : []
  const dmRows: WhatsAppSnippet[] = (
    await db
      .select({
        id: whatsappDmMessages.id,
        groupJid: whatsappDmMessages.whatsappJid,
        fromMe: whatsappDmMessages.fromMe,
        text: whatsappDmMessages.text,
        ts: whatsappDmMessages.ts,
        pinned: whatsappDmMessages.pinned,
      })
      .from(whatsappDmMessages)
      .where(eq(whatsappDmMessages.personId, personId))
      .orderBy(desc(whatsappDmMessages.ts))
      .limit(fetchLimit)
  ).map((r) => ({
    ...r,
    channel: 'dm' as const,
    groupName: null,
    senderName: r.fromMe ? 'אני' : person.name,
    fromMe: !!r.fromMe,
    pinned: !!r.pinned,
  }))
  const cutoff = lastNotionMeetingDate ? new Date(`${lastNotionMeetingDate}T23:59:59`).getTime() : 0
  const merged = [...groupRows, ...dmRows].sort((a, b) => b.ts - a.ts)
  const whatsappSinceMeeting = merged.filter((r) => r.ts > cutoff).slice(0, SINCE_LIMIT)
  const olderWhatsapp = merged.filter((r) => r.ts <= cutoff).slice(0, OLDER_LIMIT)

  const [latestSummary] = await db
    .select({
      summary: whatsappDmSummaries.summary,
      fromTs: whatsappDmSummaries.fromTs,
      toTs: whatsappDmSummaries.toTs,
      messageCount: whatsappDmSummaries.messageCount,
    })
    .from(whatsappDmSummaries)
    .where(and(eq(whatsappDmSummaries.personId, personId), sql`${whatsappDmSummaries.summary} != ''`))
    .orderBy(desc(whatsappDmSummaries.toTs))
    .limit(1)
  const proposedCommitments = await db
    .select()
    .from(commitments)
    .where(and(eq(commitments.personId, personId), eq(commitments.status, 'proposed')))
    .orderBy(desc(commitments.createdAt))

  const emailRows = await db
    .select({
      id: personEmailThreads.id,
      gmailThreadId: personEmailThreads.gmailThreadId,
      subject: personEmailThreads.subject,
      from: personEmailThreads.from,
      accountEmail: personEmailThreads.accountEmail,
      date: personEmailThreads.date,
      snippet: personEmailThreads.snippet,
      messageCount: personEmailThreads.messageCount,
    })
    .from(personEmailThreads)
    .where(eq(personEmailThreads.personId, personId))
    .orderBy(desc(personEmailThreads.date))
    .limit(EMAIL_LIMIT)
  const { recordings: voiceRecordings } = await listVoiceRecordings(db, { personId, limit: VOICE_LIMIT })

  const circles = await circlesForPerson(db, personId)
  const warmth = await personWarmth(db, personId)
  const attention = await personAttention(db, personId)

  return {
    recommendation: personRecommendation({
      lastNotionMeetingDate,
      latestWhatsapp: merged.find((r) => r.text !== '[expired]') ?? null,
      whatsappSinceCount: whatsappSinceMeeting.length,
      openLoopCount: openLoopsForPerson.length,
      trend: attentionTrend(attention, warmth.trend),
    }),
    lastNotionMeetingDate,
    openLoopsForPerson,
    whatsappSinceMeeting,
    olderWhatsapp,
    whatsappSenders,
    circles,
    warmth,
    attention,
    captureWhatsapp: !!person.captureWhatsapp,
    captureReachable: (await dmJidsForPerson(db, personId, person.phone)).length > 0,
    latestDmSummary: latestSummary ?? null,
    slack: await slackCaptureForPerson(db, personId),
    proposedCommitments: proposedCommitments.map((c) => ({ ...c, sourceUrl: commitmentSourceUrl(c) })),
    emailThreads: emailRows.map(({ gmailThreadId, accountEmail, ...t }) => ({
      ...t,
      fromMe: extractAddresses(t.from).includes(accountEmail.toLowerCase()),
      gmailUrl: gmailThreadUrl(gmailThreadId),
    })),
    emailAddresses: await listPersonEmails(db, personId),
    voiceRecordings,
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

/** Open commitments for a circle meeting's confirmed attendees (first few people only). */
async function attendeeCommitmentLines(db: Db, meetingId: string): Promise<string[]> {
  const attendees = await db
    .select({ id: people.id, name: people.name })
    .from(meetingPeople)
    .innerJoin(people, eq(people.id, meetingPeople.personId))
    .where(and(eq(meetingPeople.meetingId, meetingId), eq(people.status, 'confirmed')))
  const lines: string[] = []
  for (const p of attendees.slice(0, PREP_MAX_PEOPLE)) lines.push(...(await prepCommitmentLines(db, p.id, p.name, 2)))
  return lines
}

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
      lines.push(...(await attendeeCommitmentLines(db, meetingId)))
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
  const followed = links.filter((l) => l.status === 'confirmed' && !isSelfPersonName(l.name)).slice(0, PREP_MAX_PEOPLE)
  const lines: string[] = []
  for (const p of followed) {
    const ctx = await buildPersonContext(db, p.personId)
    if (!ctx) continue
    const rec = personRecommendation({
      lastNotionMeetingDate: ctx.lastNotionMeetingDate,
      latestWhatsapp: ctx.whatsappSinceMeeting[0] ?? ctx.olderWhatsapp[0] ?? null,
      whatsappSinceCount: ctx.whatsappSinceMeeting.length,
      openLoopCount: ctx.openLoopsForPerson.length,
      trend: attentionTrend(ctx.attention, ctx.warmth.trend),
      quoteChat: false,
    })
    if (rec) lines.push(`${p.name}: ${rec}`)
    for (const loop of ctx.openLoopsForPerson.slice(0, 3)) lines.push(`${p.name} · משימה פתוחה: ${loop.content}`)
    if (ctx.circles.length > 0) lines.push(`${p.name} · חוגים: ${ctx.circles.map((c) => c.seriesTitle).join(', ')}`)
    if (ctx.attention && isOpenFlag(ctx.attention)) {
      lines.push(`שים לב: כדאי לקבוע 1:1 עם ${p.name} · ${attentionReasonText(ctx.attention).join(' · ')}.`)
    }
    lines.push(...(await prepCommitmentLines(db, p.personId, p.name)))
  }
  return { kind: lines.length > 0 ? 'people' : 'none', lines, circleTitle: null, rosterCount: null }
}

export interface CoolingFlag {
  meetingId: string
  calendarEventId: string | null
  title: string
  /** Followed people on this meeting who need a 1:1 (sharp enough to interrupt) */
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
  const needsByPerson = new Map<string, boolean>()
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
    const followed = attendees.filter((a) => !isSelfPersonName(a.name)).slice(0, 10)
    const unseen = followed.filter((p) => !needsByPerson.has(p.id)).map((p) => p.id)
    if (unseen.length > 0) {
      const loaded = await loadAttention(db, { personIds: unseen })
      for (const id of unseen) {
        const a = loaded.get(id)
        // A 1:1 booked for today is the moment to act, so "scheduled" doesn't hide it here.
        needsByPerson.set(id, !!a && (isInterrupting(a) || (a.suppressed === 'scheduled' && a.severity >= INTERRUPT_SEVERITY)))
      }
    }
    for (const p of followed) if (needsByPerson.get(p.id)) coolingPeople.push(p.name)
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
