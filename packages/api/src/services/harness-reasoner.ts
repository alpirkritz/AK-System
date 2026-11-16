/**
 * Harness Cross-Domain Reasoner.
 *
 * Detectors are deterministic and run over the world model plus the source tables. Each
 * one answers a question that needs at least two domains, which is the whole point —
 * "silent in WhatsApp" is noise on its own, "silent in WhatsApp before tomorrow's meeting
 * while owing me something" is a reason to pick up the phone.
 *
 * Gemini only rewrites and ranks what the detectors already found. It is never the source
 * of a fact, and a missing key or a failed call falls back to the Hebrew templates below,
 * so the harness keeps working when the LLM is down.
 */
import { GoogleGenerativeAI, type GenerationConfig } from '@google/generative-ai'
import { and, desc, eq, gte, inArray, isNull, lt, lte, not, notInArray, sql } from 'drizzle-orm'
import {
  commitments,
  financeTransactions,
  harnessInsights,
  meetingNotes,
  meetingPeople,
  meetings,
  people,
  personEmailThreads,
  projects,
  salesDocumentPayments,
  salesDocuments,
  slackMessages,
  tasks,
  vatEntries,
  whatsappDmMessages,
  type getDb,
} from '@ak-system/database'
import { attentionReasonText, isInterrupting, loadAttention } from './relationship-attention'
import { isSelfPersonName } from '../lib/self-identity'
import { nodeId } from './harness-context'
import { writeHarnessStamp } from './harness-stamps'
import { getOwnerProfile } from './owner-profile'
import { listNotionWorldDisagreements, listWorldConflicts } from './world-scope'
import { createHash } from 'node:crypto'
import { classifyAmbiguousReplyNeed, deterministicReplyNeed, type ReplyNeed } from './email-reply-need'

type Db = ReturnType<typeof getDb>

export type InsightSeverity = 'info' | 'attention' | 'urgent'

export interface InsightSource {
  nodeId: string
  kind: string
  label: string
}

export interface HarnessInsightDraft {
  kind: string
  title: string
  body: string
  severity: InsightSeverity
  score: number
  personId: string | null
  sources: InsightSource[]
  dedupeKey: string
  /** Days the insight stays relevant before it drops out of the list. */
  ttlDays: number
}

export interface ReasonResult {
  insights: HarnessInsightDraft[]
  created: number
  updated: number
  model: string | null
}

/** No contact on any channel (meeting, recording, WhatsApp DM or group, email) for this long counts as silence. */
const SILENCE_DAYS = 14
/** An open commitment older than this is stale regardless of other signals. */
const STALE_COMMITMENT_DAYS = 21
/** Monthly spend this far above the trailing average is a spike. */
const SPEND_SPIKE_RATIO = 1.4
/** An email thread with no follow-up for this long is worth surfacing. */
const UNANSWERED_THREAD_DAYS = 5
/** How far ahead "upcoming meeting" reaches. */
const LOOKAHEAD_DAYS = 7
/** Commitments of mine with a due date inside this window, and no task, are one card. */
const DUE_WINDOW_DAYS = 7
/** Proposed commitments older than this, and not already in the due window, pile up. */
const PROPOSED_PILE_DAYS = 3
const PROPOSED_PILE_MIN = 3
/** A meeting this many days back with no notes and no task is unfinished. */
const FOLLOWTHROUGH_DAYS = 3
/** Six meetings or five hours in one day is a full day. */
const OVERLOAD_MEETINGS = 6
const OVERLOAD_MINUTES = 5 * 60
/** An issued invoice with no due date is late after this many days. */
const INVOICE_OPEN_DAYS = 30
/** Past-due by this much is urgent, not just attention. */
const INVOICE_URGENT_DAYS = 14
/** A project with motion in this older band and none recently has gone quiet. */
const PROJECT_QUIET_DAYS = 21
const PROJECT_LOOKBACK_DAYS = 90
/** WhatsApp: their last message, unanswered this long, counts toward the reply pile. */
const WA_REPLY_DAYS = 2
const REPLY_BACKLOG_MIN = 3
/** How many unlabeled threads one run may send to Gemini. The rest wait for the next run. */
const REPLY_CLASSIFY_CAP = 20
/** Bi-monthly VAT reporters file by this day of the month that opens the next period. */
export const VAT_FILING_DAY = 19
const VAT_FILING_MONTHS = new Set([1, 3, 5, 7, 9, 11])

const MAX_INSIGHTS = 30

/** Situation cards. Attention from these kinds is push-eligible; person cards are not. */
export const SITUATION_INSIGHT_KINDS = [
  'meeting_no_followthrough',
  'calendar_overload',
  'commitment_due_no_task',
  'proposed_commitment_pile',
  'unpaid_invoice',
  'project_gone_quiet',
  'reply_backlog',
  'vat_filing_window',
] as const

const SITUATION_KIND_SET = new Set<string>(SITUATION_INSIGHT_KINDS)

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function daysBetween(aIso: string, bIso: string): number {
  return Math.round((new Date(bIso).getTime() - new Date(aIso).getTime()) / 86400000)
}

function shortDate(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-')
  return m && d ? `${Number(d)}.${Number(m)}` : iso
}

// ─── Detectors ─────────────────────────────────────────────────────────────

interface DetectorContext {
  db: Db
  today: string
  horizon: string
  now: Date
  /** Single-message threads, at least UNANSWERED_THREAD_DAYS old, that the gate marked needs_reply. */
  replyNeededThreadIds: Set<string>
  /** `people` rows that are the owner. Never the subject of a person-scoped insight. */
  selfIds: Set<string>
}

/** Upcoming meeting + attendee gone quiet + an open commitment between you. */
async function detectSilentBeforeMeeting(ctx: DetectorContext): Promise<HarnessInsightDraft[]> {
  const { db, today, horizon } = ctx
  const upcoming = await db
    .select({ id: meetings.id, title: meetings.title, date: meetings.date })
    .from(meetings)
    .where(and(gte(meetings.date, today), lte(meetings.date, horizon)))
    .orderBy(meetings.date)
  if (upcoming.length === 0) return []

  const links = await db
    .select({ meetingId: meetingPeople.meetingId, personId: meetingPeople.personId })
    .from(meetingPeople)
    .where(inArray(meetingPeople.meetingId, upcoming.map((m) => m.id)))
  if (links.length === 0) return []

  const personIds = [...new Set(links.map((l) => l.personId))].filter((id) => !ctx.selfIds.has(id))
  if (personIds.length === 0) return []
  const peopleRows = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(and(inArray(people.id, personIds), eq(people.status, 'confirmed')))
  const nameById = new Map(peopleRows.map((p) => [p.id, p.name]))

  const openCommitments = await db
    .select({ id: commitments.id, personId: commitments.personId, content: commitments.content, owner: commitments.owner })
    .from(commitments)
    .where(and(inArray(commitments.status, ['accepted']), inArray(commitments.personId, personIds)))
  const commitmentsByPerson = new Map<string, typeof openCommitments>()
  for (const c of openCommitments) {
    if (!c.personId) continue
    const list = commitmentsByPerson.get(c.personId) ?? []
    list.push(c)
    commitmentsByPerson.set(c.personId, list)
  }

  // Last contact across every channel, not just WhatsApp DMs — a meeting, a recording or a
  // word in a shared group all count as talking.
  const attention = await loadAttention(db, { personIds: [...commitmentsByPerson.keys()], now: ctx.now })
  const out: HarnessInsightDraft[] = []
  const seen = new Set<string>()

  for (const link of links) {
    if (ctx.selfIds.has(link.personId)) continue
    const name = nameById.get(link.personId)
    if (!name) continue
    const personCommitments = commitmentsByPerson.get(link.personId) ?? []
    if (personCommitments.length === 0) continue

    const key = `${link.meetingId}:${link.personId}`
    if (seen.has(key)) continue
    seen.add(key)

    const lastContact = attention.get(link.personId)?.lastContact?.date ?? null
    const silentDays = lastContact ? daysBetween(lastContact, today) : null
    if (silentDays != null && silentDays < SILENCE_DAYS) continue

    const meeting = upcoming.find((m) => m.id === link.meetingId)
    if (!meeting) continue
    const owed = personCommitments.filter((c) => c.owner === 'me').length

    out.push({
      kind: 'silent_before_meeting',
      title: `${name} — פגישה ב-${shortDate(meeting.date)} אחרי שתיקה`,
      body: [
        silentDays ? `אין שום קשר ${silentDays} ימים` : 'אין קשר מתועד כלל',
        `${personCommitments.length} התחייבויות פתוחות${owed > 0 ? ` (${owed} שלך)` : ''}`,
        `פגישה: ${meeting.title}`,
      ].join(' · '),
      severity: owed > 0 ? 'urgent' : 'attention',
      score: Math.min(1, 0.6 + personCommitments.length * 0.1 + (owed > 0 ? 0.2 : 0)),
      personId: link.personId,
      sources: [
        { nodeId: nodeId('person', link.personId), kind: 'person', label: name },
        { nodeId: nodeId('meeting', meeting.id), kind: 'meeting', label: meeting.title },
        ...personCommitments.slice(0, 3).map((c) => ({
          nodeId: nodeId('commitment', c.id),
          kind: 'commitment',
          label: c.content.slice(0, 60),
        })),
      ],
      dedupeKey: `silent_before_meeting:${link.meetingId}:${link.personId}`,
      ttlDays: Math.max(1, daysBetween(today, meeting.date) + 1),
    })
  }
  return out
}

/** Someone who needs a 1:1 while something is still owed between you. */
async function detectCoolingWithOpenLoop(ctx: DetectorContext): Promise<HarnessInsightDraft[]> {
  const { db } = ctx
  const openCommitments = await db
    .select({ id: commitments.id, personId: commitments.personId, content: commitments.content, owner: commitments.owner })
    .from(commitments)
    .where(inArray(commitments.status, ['accepted']))
  const personIds = [...new Set(openCommitments.map((c) => c.personId).filter((id): id is string => !!id && !ctx.selfIds.has(id)))]
  if (personIds.length === 0) return []

  const peopleRows = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(and(inArray(people.id, personIds), eq(people.status, 'confirmed')))

  const attention = await loadAttention(db, { personIds: peopleRows.map((p) => p.id) })
  const out: HarnessInsightDraft[] = []
  for (const p of peopleRows) {
    const a = attention.get(p.id)
    // Only a flag sharp enough to interrupt is worth a card; milder ones live on the relationships page.
    if (!a || !isInterrupting(a)) continue
    const theirs = openCommitments.filter((c) => c.personId === p.id)
    out.push({
      kind: 'cooling_with_open_loop',
      title: `כדאי לקבוע 1:1 עם ${p.name} · יש לולאה פתוחה`,
      body: `${theirs.length} התחייבויות פתוחות · ${attentionReasonText(a).join(' · ')}`,
      severity: 'attention',
      score: Math.min(1, 0.5 + theirs.length * 0.1),
      personId: p.id,
      sources: [
        { nodeId: nodeId('person', p.id), kind: 'person', label: p.name },
        ...theirs.slice(0, 3).map((c) => ({
          nodeId: nodeId('commitment', c.id),
          kind: 'commitment',
          label: c.content.slice(0, 60),
        })),
      ],
      dedupeKey: `cooling_with_open_loop:${p.id}`,
      ttlDays: 7,
    })
  }
  return out
}

/** Commitments nobody closed and nobody dismissed. */
async function detectStaleCommitments(ctx: DetectorContext): Promise<HarnessInsightDraft[]> {
  const { db, today } = ctx
  const cutoff = `${addDays(today, -STALE_COMMITMENT_DAYS)}T00:00:00.000Z`
  const rows = await db
    .select({
      id: commitments.id,
      personId: commitments.personId,
      senderName: commitments.senderName,
      content: commitments.content,
      owner: commitments.owner,
      createdAt: commitments.createdAt,
      dueInferred: commitments.dueInferred,
      taskId: commitments.taskId,
    })
    .from(commitments)
    .where(and(inArray(commitments.status, ['accepted']), lte(commitments.createdAt, cutoff)))
    .orderBy(commitments.createdAt)
    .limit(20)
  if (rows.length === 0) return []

  const personIds = [...new Set(rows.map((r) => r.personId).filter((id): id is string => !!id))]
  const nameById = new Map(
    personIds.length > 0
      ? (await db.select({ id: people.id, name: people.name }).from(people).where(inArray(people.id, personIds))).map(
          (p) => [p.id, p.name] as const,
        )
      : [],
  )

  return rows
    .filter((r) => !(r.personId && ctx.selfIds.has(r.personId)) && !isSelfPersonName(r.senderName))
    .filter((r) => !(r.taskId == null && inDueWindow(r.dueInferred, today)))
    .map((r) => {
    const who = r.personId ? nameById.get(r.personId) ?? r.senderName : r.senderName
    const ageDays = Math.round((Date.now() - new Date(r.createdAt).getTime()) / 86400000)
    return {
      kind: 'stale_commitment',
      title: `התחייבות פתוחה ${ageDays} ימים${who ? ` · ${who}` : ''}`,
      body: `${r.owner === 'me' ? 'אתה הבטחת' : 'הובטח לך'}: ${r.content.slice(0, 120)}`,
      severity: ageDays > STALE_COMMITMENT_DAYS * 2 ? 'urgent' : ('attention' as InsightSeverity),
      score: Math.min(1, 0.4 + ageDays / 100),
      personId: r.personId,
      sources: [
        { nodeId: nodeId('commitment', r.id), kind: 'commitment', label: r.content.slice(0, 60) },
        ...(r.personId && who ? [{ nodeId: nodeId('person', r.personId), kind: 'person', label: who }] : []),
      ],
      dedupeKey: `stale_commitment:${r.id}`,
      ttlDays: 14,
    }
  })
}

/** Spending well above the trailing average, read next to this month's meeting load. */
async function detectSpendSpike(ctx: DetectorContext): Promise<HarnessInsightDraft[]> {
  const { db, today } = ctx
  const monthStart = `${today.slice(0, 7)}-01`
  const trailingStart = addDays(monthStart, -90)

  const rows = await db
    .select({
      amount: financeTransactions.amount,
      category: financeTransactions.category,
      transactionDate: financeTransactions.transactionDate,
    })
    .from(financeTransactions)
    .where(and(eq(financeTransactions.direction, 'out'), gte(financeTransactions.transactionDate, trailingStart)))
  if (rows.length === 0) return []

  const thisMonth = rows.filter((r) => r.transactionDate >= monthStart)
  const trailing = rows.filter((r) => r.transactionDate < monthStart)
  if (thisMonth.length === 0 || trailing.length === 0) return []

  const sum = (list: typeof rows) => list.reduce((acc, r) => acc + (Number(r.amount) || 0), 0)
  const monthTotal = sum(thisMonth)
  // Trailing window is 3 months, so a per-month baseline is a third of it.
  const baseline = sum(trailing) / 3
  if (baseline <= 0 || monthTotal < baseline * SPEND_SPIKE_RATIO) return []

  const meetingCount = (
    await db
      .select({ id: meetings.id })
      .from(meetings)
      .where(and(gte(meetings.date, monthStart), lte(meetings.date, today)))
  ).length

  const pct = Math.round((monthTotal / baseline - 1) * 100)
  return [
    {
      kind: 'spend_spike_vs_meetings',
      title: `ההוצאות החודש גבוהות ב-${pct}% מהממוצע`,
      body: `${Math.round(monthTotal).toLocaleString('he-IL')} ₪ מול ממוצע ${Math.round(
        baseline,
      ).toLocaleString('he-IL')} ₪ · ${meetingCount} פגישות החודש`,
      severity: pct > 80 ? 'urgent' : ('attention' as InsightSeverity),
      score: Math.min(1, 0.5 + pct / 200),
      personId: null,
      sources: [{ nodeId: `month:${today.slice(0, 7)}`, kind: 'financial_event', label: `הוצאות ${today.slice(0, 7)}` }],
      dedupeKey: `spend_spike_vs_meetings:${today.slice(0, 7)}`,
      ttlDays: 7,
    },
  ]
}

/** A one-message email thread that went nowhere, with that person on the calendar soon. */
async function detectUnansweredThread(ctx: DetectorContext): Promise<HarnessInsightDraft[]> {
  const { db, today, horizon } = ctx
  const upcoming = await db
    .select({ id: meetings.id, title: meetings.title, date: meetings.date })
    .from(meetings)
    .where(and(gte(meetings.date, today), lte(meetings.date, horizon)))
  if (upcoming.length === 0) return []

  const links = await db
    .select({ meetingId: meetingPeople.meetingId, personId: meetingPeople.personId })
    .from(meetingPeople)
    .where(inArray(meetingPeople.meetingId, upcoming.map((m) => m.id)))
  const personIds = [...new Set(links.map((l) => l.personId))].filter((id) => !ctx.selfIds.has(id))
  if (personIds.length === 0) return []

  const cutoff = addDays(today, -UNANSWERED_THREAD_DAYS)
  const threads = await db
    .select({
      id: personEmailThreads.id,
      personId: personEmailThreads.personId,
      subject: personEmailThreads.subject,
      date: personEmailThreads.date,
      messageCount: personEmailThreads.messageCount,
    })
    .from(personEmailThreads)
    .where(and(inArray(personEmailThreads.personId, personIds), lte(personEmailThreads.date, cutoff)))
    .orderBy(desc(personEmailThreads.date))
    .limit(20)

  const single = threads.filter((t) => (t.messageCount ?? 1) <= 1 && ctx.replyNeededThreadIds.has(t.id))
  if (single.length === 0) return []

  const nameById = new Map(
    (await db.select({ id: people.id, name: people.name }).from(people).where(inArray(people.id, personIds))).map(
      (p) => [p.id, p.name] as const,
    ),
  )

  const out: HarnessInsightDraft[] = []
  for (const t of single) {
    const name = nameById.get(t.personId)
    if (!name) continue
    const link = links.find((l) => l.personId === t.personId)
    const meeting = upcoming.find((m) => m.id === link?.meetingId)
    if (!meeting) continue
    out.push({
      kind: 'unanswered_thread',
      title: `מייל ל${name} ללא המשך — פגישה ב-${shortDate(meeting.date)}`,
      body: `"${t.subject.slice(0, 80)}" מ-${shortDate(t.date)} · אין תגובה בשרשור`,
      severity: 'attention',
      score: 0.55,
      personId: t.personId,
      sources: [
        { nodeId: nodeId('person', t.personId), kind: 'person', label: name },
        { nodeId: nodeId('email_thread', t.id), kind: 'email_thread', label: t.subject.slice(0, 60) },
        { nodeId: nodeId('meeting', meeting.id), kind: 'meeting', label: meeting.title },
      ],
      dedupeKey: `unanswered_thread:${t.id}:${meeting.id}`,
      ttlDays: Math.max(1, daysBetween(today, meeting.date) + 1),
    })
  }
  return out
}

function inDueWindow(due: string | null, today: string): boolean {
  if (!due) return false
  const day = due.slice(0, 10)
  return day >= addDays(today, -DUE_WINDOW_DAYS) && day <= addDays(today, DUE_WINDOW_DAYS)
}

function minutesOf(hhmm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(hhmm)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function closedVatPeriod(today: string): { year: number; period: number; day: number } | null {
  const [year, month, day] = today.split('-').map(Number)
  if (!year || !month || !day) return null
  if (!VAT_FILING_MONTHS.has(month) || day > VAT_FILING_DAY) return null
  const current = Math.ceil(month / 2)
  if (current === 1) return { year: year - 1, period: 6, day }
  return { year, period: current - 1, day }
}

/** Meetings that ended in the last few days, had someone in the room, and produced nothing. */
async function detectMeetingNoFollowthrough(ctx: DetectorContext): Promise<HarnessInsightDraft[]> {
  const { db, today } = ctx
  const start = addDays(today, -FOLLOWTHROUGH_DAYS)
  const recent = await db
    .select({ id: meetings.id, title: meetings.title, date: meetings.date, notes: meetings.notes })
    .from(meetings)
    .where(and(gte(meetings.date, start), lt(meetings.date, today)))
  if (recent.length === 0) return []

  const ids = recent.map((m) => m.id)
  const [attendees, notes, taskRows] = await Promise.all([
    db.select({ meetingId: meetingPeople.meetingId }).from(meetingPeople).where(inArray(meetingPeople.meetingId, ids)),
    db.select({ meetingId: meetingNotes.meetingId }).from(meetingNotes).where(inArray(meetingNotes.meetingId, ids)),
    db.select({ meetingId: tasks.meetingId }).from(tasks).where(inArray(tasks.meetingId, ids)),
  ])
  const attended = new Set(attendees.map((r) => r.meetingId))
  const noted = new Set(notes.map((r) => r.meetingId).filter((id): id is string => !!id))
  const tasked = new Set(taskRows.map((r) => r.meetingId).filter((id): id is string => !!id))
  const bare = recent.filter((m) => attended.has(m.id) && !m.notes?.trim() && !noted.has(m.id) && !tasked.has(m.id))
  if (bare.length === 0) return []

  const title = bare.length === 1
    ? `${bare[0].title} — בלי סיכום ובלי משימה`
    : `${bare.length} פגישות מהימים האחרונים בלי סיכום ובלי משימה`
  return [{
    kind: 'meeting_no_followthrough',
    title,
    body: bare.slice(0, 3).map((m) => m.title).join(' · '),
    severity: 'attention',
    score: Math.min(1, 0.45 + bare.length * 0.1),
    personId: null,
    sources: bare.slice(0, 3).map((m) => ({ nodeId: nodeId('meeting', m.id), kind: 'meeting', label: m.title })),
    dedupeKey: 'meeting_no_followthrough',
    ttlDays: 3,
  }]
}

/** Today or tomorrow is either double-booked or simply too full. */
async function detectCalendarOverload(ctx: DetectorContext): Promise<HarnessInsightDraft[]> {
  const { db, today } = ctx
  const tomorrow = addDays(today, 1)
  const rows = await db
    .select({ id: meetings.id, title: meetings.title, date: meetings.date, time: meetings.time, endTime: meetings.endTime })
    .from(meetings)
    .where(and(gte(meetings.date, today), lte(meetings.date, tomorrow)))

  for (const day of [today, tomorrow]) {
    const timed = rows.flatMap((m) => {
      if (m.date !== day || !m.endTime) return []
      const start = minutesOf(m.time)
      const end = minutesOf(m.endTime)
      if (start == null || end == null || end <= start) return []
      return [{ ...m, start, end }]
    })
    if (timed.length === 0) continue
    let overlap = false
    for (let i = 0; i < timed.length && !overlap; i++) {
      for (let j = i + 1; j < timed.length; j++) {
        if (timed[i].start < timed[j].end && timed[j].start < timed[i].end) {
          overlap = true
          break
        }
      }
    }
    const minutes = timed.reduce((sum, m) => sum + (m.end - m.start), 0)
    if (!overlap && timed.length < OVERLOAD_MEETINGS && minutes < OVERLOAD_MINUTES) continue
    const why = overlap ? 'יש חפיפה' : timed.length >= OVERLOAD_MEETINGS ? `${timed.length} פגישות` : `${Math.round(minutes / 60)} שעות פגישות`
    return [{
      kind: 'calendar_overload',
      title: overlap ? `חפיפה ביומן ב-${shortDate(day)}` : `יום עמוס ב-${shortDate(day)}`,
      body: `${why} · ${timed.map((m) => m.title).slice(0, 3).join(' · ')}`,
      severity: overlap ? 'urgent' : 'attention',
      score: overlap ? 0.85 : 0.6,
      personId: null,
      sources: [{ nodeId: `day:${day}`, kind: 'calendar_day', label: shortDate(day) }],
      dedupeKey: `calendar_overload:${day}`,
      ttlDays: Math.max(1, daysBetween(today, day) + 1),
    }]
  }
  return []
}

/** Promises I made that have a date and were never turned into a task. */
async function detectCommitmentDueNoTask(ctx: DetectorContext): Promise<HarnessInsightDraft[]> {
  const { db, today } = ctx
  const rows = await db
    .select({ id: commitments.id, content: commitments.content, dueInferred: commitments.dueInferred })
    .from(commitments)
    .where(and(
      eq(commitments.owner, 'me'),
      isNull(commitments.taskId),
      inArray(commitments.status, ['proposed', 'accepted']),
    ))
  const due = rows.filter((r) => inDueWindow(r.dueInferred, today))
  if (due.length === 0) return []
  const overdue = due.some((r) => (r.dueInferred ?? '').slice(0, 10) < today)
  return [{
    kind: 'commitment_due_no_task',
    title: overdue ? `${due.length} התחייבויות שלך באיחור בלי משימה` : `${due.length} התחייבויות שלך מגיעות למועד בלי משימה`,
    body: due.slice(0, 3).map((r) => r.content.slice(0, 60)).join(' · '),
    severity: overdue ? 'urgent' : 'attention',
    score: overdue ? 0.8 : 0.6,
    personId: null,
    sources: due.slice(0, 3).map((r) => ({ nodeId: nodeId('commitment', r.id), kind: 'commitment', label: r.content.slice(0, 40) })),
    dedupeKey: 'commitment_due_no_task',
    ttlDays: 7,
  }]
}

/** A pile of proposed commitments nobody accepted or dismissed. */
async function detectProposedPile(ctx: DetectorContext): Promise<HarnessInsightDraft[]> {
  const { db, today } = ctx
  const cutoff = `${addDays(today, -PROPOSED_PILE_DAYS)}T00:00:00.000Z`
  const rows = await db
    .select({
      id: commitments.id,
      content: commitments.content,
      owner: commitments.owner,
      dueInferred: commitments.dueInferred,
      taskId: commitments.taskId,
    })
    .from(commitments)
    .where(and(eq(commitments.status, 'proposed'), lte(commitments.createdAt, cutoff)))
  const pile = rows.filter((r) => !(r.owner === 'me' && r.taskId == null && inDueWindow(r.dueInferred, today)))
  if (pile.length < PROPOSED_PILE_MIN) return []
  return [{
    kind: 'proposed_commitment_pile',
    title: `${pile.length} התחייבויות מחכות להחלטה`,
    body: pile.slice(0, 3).map((r) => r.content.slice(0, 60)).join(' · '),
    severity: 'attention',
    score: Math.min(1, 0.4 + pile.length * 0.05),
    personId: null,
    sources: pile.slice(0, 3).map((r) => ({ nodeId: nodeId('commitment', r.id), kind: 'commitment', label: r.content.slice(0, 40) })),
    dedupeKey: 'proposed_commitment_pile',
    ttlDays: 7,
  }]
}

/** Issued invoices whose payments do not cover the total. */
async function detectUnpaidInvoice(ctx: DetectorContext): Promise<HarnessInsightDraft[]> {
  const { db, today } = ctx
  const docs = await db
    .select({
      id: salesDocuments.id,
      docType: salesDocuments.docType,
      clientName: salesDocuments.clientName,
      total: salesDocuments.total,
      dueDate: salesDocuments.dueDate,
      issueDate: salesDocuments.issueDate,
    })
    .from(salesDocuments)
    .where(eq(salesDocuments.status, 'issued'))
  const open = docs.filter((d) => d.docType !== 'credit_invoice')
  if (open.length === 0) return []

  const payments = await db
    .select({ documentId: salesDocumentPayments.documentId, amount: salesDocumentPayments.amount })
    .from(salesDocumentPayments)
    .where(inArray(salesDocumentPayments.documentId, open.map((d) => d.id)))
  const paid = new Map<string, number>()
  for (const payment of payments) {
    paid.set(payment.documentId, (paid.get(payment.documentId) ?? 0) + (Number(payment.amount) || 0))
  }
  const staleBefore = addDays(today, -INVOICE_OPEN_DAYS)
  const unpaid = open.filter((d) => {
    const total = Number(d.total) || 0
    if ((paid.get(d.id) ?? 0) >= total) return false
    if (d.dueDate) return d.dueDate.slice(0, 10) < today
    return d.issueDate.slice(0, 10) <= staleBefore
  })
  if (unpaid.length === 0) return []
  const urgentBefore = addDays(today, -INVOICE_URGENT_DAYS)
  const urgent = unpaid.some((d) => (d.dueDate ?? d.issueDate).slice(0, 10) <= urgentBefore)
  return [{
    kind: 'unpaid_invoice',
    title: `${unpaid.length} חשבוניות שהונפקו ולא שולמו`,
    body: unpaid.slice(0, 3).map((d) => d.clientName || d.id).join(' · '),
    severity: urgent ? 'urgent' : 'attention',
    score: urgent ? 0.9 : 0.65,
    personId: null,
    sources: unpaid.slice(0, 3).map((d) => ({
      nodeId: `invoice:${d.id}`,
      kind: 'invoice',
      label: d.clientName || d.id,
    })),
    dedupeKey: 'unpaid_invoice',
    ttlDays: 14,
  }]
}

/** Projects that moved recently, then stopped. */
async function detectProjectGoneQuiet(ctx: DetectorContext): Promise<HarnessInsightDraft[]> {
  const { db, today } = ctx
  const recentCut = addDays(today, -PROJECT_QUIET_DAYS)
  const oldCut = addDays(today, -PROJECT_LOOKBACK_DAYS)
  const projectRows = await db.select({ id: projects.id, name: projects.name }).from(projects)
  if (projectRows.length === 0) return []

  const meetingRows = await db
    .select({ projectId: meetings.projectId, date: meetings.date })
    .from(meetings)
    .where(and(gte(meetings.date, oldCut), not(isNull(meetings.projectId))))
  const taskRows = await db
    .select({ projectId: tasks.projectId, updatedAt: tasks.updatedAt })
    .from(tasks)
    .where(gte(tasks.updatedAt, `${oldCut}T00:00:00.000Z`))

  const quiet: { id: string; name: string }[] = []
  for (const project of projectRows) {
    const dates = [
      ...meetingRows.filter((m) => m.projectId === project.id).map((m) => m.date),
      ...taskRows.filter((t) => t.projectId === project.id).map((t) => t.updatedAt.slice(0, 10)),
    ]
    const hadPrior = dates.some((d) => d >= oldCut && d < recentCut)
    const hadRecent = dates.some((d) => d >= recentCut)
    if (hadPrior && !hadRecent) quiet.push(project)
  }
  if (quiet.length === 0) return []
  const names = quiet.slice(0, 3).map((p) => p.name)
  return [{
    kind: 'project_gone_quiet',
    title: quiet.length === 1 ? `${quiet[0].name} בלי תנועה` : `${quiet.length} פרויקטים בלי תנועה`,
    body: names.join(' · '),
    severity: 'attention',
    score: 0.5,
    personId: null,
    sources: quiet.slice(0, 3).map((p) => ({ nodeId: nodeId('project', p.id), kind: 'project', label: p.name })),
    dedupeKey: 'project_gone_quiet',
    ttlDays: 14,
  }]
}

/** One card for emails that need a reply plus WhatsApp threads waiting on me. */
async function detectReplyBacklog(ctx: DetectorContext): Promise<HarnessInsightDraft[]> {
  const { db, replyNeededThreadIds, now } = ctx
  const emailCount = replyNeededThreadIds.size

  const messages = await db
    .select({ personId: whatsappDmMessages.personId, fromMe: whatsappDmMessages.fromMe, ts: whatsappDmMessages.ts })
    .from(whatsappDmMessages)
    .orderBy(desc(whatsappDmMessages.ts))
  const latest = new Map<string, { fromMe: boolean; ts: number }>()
  for (const message of messages) {
    if (ctx.selfIds.has(message.personId)) continue
    if (!latest.has(message.personId)) latest.set(message.personId, { fromMe: !!message.fromMe, ts: message.ts })
  }
  const waCutoff = now.getTime() - WA_REPLY_DAYS * 86400000
  let waCount = 0
  for (const row of latest.values()) {
    if (!row.fromMe && row.ts <= waCutoff) waCount++
  }

  // Slack: count enabled channels with messages in the last WA_REPLY_DAYS window that haven't been responded to
  // (simple heuristic: channel had activity but no message from the owner's own user — approximate)
  const slackCutoff = now.getTime() - WA_REPLY_DAYS * 86400000
  const recentSlack = await db
    .select({ channelId: slackMessages.channelId, ts: slackMessages.ts })
    .from(slackMessages)
    .where(and(gte(slackMessages.ts, slackCutoff), sql`${slackMessages.deleted} = 0`))
    .orderBy(desc(slackMessages.ts))
  const slackActive = new Set(recentSlack.map((r) => r.channelId))
  const slackCount = slackActive.size

  const total = emailCount + waCount + slackCount
  if (total < REPLY_BACKLOG_MIN) return []
  const parts = [
    emailCount > 0 ? `${emailCount} מיילים` : null,
    waCount > 0 ? `${waCount} שיחות וואטסאפ` : null,
    slackCount > 0 ? `${slackCount} ערוצי Slack פעילים` : null,
  ].filter(Boolean) as string[]
  return [{
    kind: 'reply_backlog',
    title: `${total} שיחות מחכות לתשובה`,
    body: parts.join(' · '),
    severity: 'attention',
    score: Math.min(1, 0.4 + total * 0.05),
    personId: null,
    sources: [{ nodeId: 'reply_queue', kind: 'reply_queue', label: `${total}` }],
    dedupeKey: 'reply_backlog',
    ttlDays: 3,
  }]
}

/** Reminder while the previous bimonthly VAT period is still inside the filing window. */
async function detectVatFilingWindow(ctx: DetectorContext): Promise<HarnessInsightDraft[]> {
  const { db, today } = ctx
  const closed = closedVatPeriod(today)
  if (!closed) return []
  const rows = await db
    .select({ id: vatEntries.id })
    .from(vatEntries)
    .where(and(eq(vatEntries.year, closed.year), eq(vatEntries.period, closed.period)))
  const left = VAT_FILING_DAY - closed.day
  const urgent = closed.day >= VAT_FILING_DAY - 2
  return [{
    kind: 'vat_filing_window',
    title: !urgent
      ? `חלון דיווח מע״מ פתוח עד ה-${VAT_FILING_DAY}`
      : left <= 0
        ? 'חלון המע״מ נסגר היום'
        : `חלון המע״מ נסגר בעוד ${left} ימים`,
    body: `${rows.length} רשומות לתקופה ${closed.period}/${closed.year}. תזכורת לבדוק את התקופה, לא ייעוץ מס.`,
    severity: urgent ? 'urgent' : 'attention',
    score: urgent ? 0.9 : 0.55,
    personId: null,
    sources: [{ nodeId: `vat:${closed.year}:${closed.period}`, kind: 'vat_period', label: `${closed.period}/${closed.year}` }],
    dedupeKey: `vat_filing_window:${closed.year}:${closed.period}`,
    ttlDays: Math.max(1, VAT_FILING_DAY - closed.day + 1),
  }]
}

export const PRIORITY_QUIET_DAYS = 7

function isoWeek(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  const dayNum = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** A stated priority whose project had no meeting or task change for a week (spec: owner-priorities-profile). */
async function detectPriorityNeglected(ctx: DetectorContext): Promise<HarnessInsightDraft[]> {
  const { db, today } = ctx
  const profile = await getOwnerProfile(db)
  const linked = profile.priorities.filter((p) => p.projectId && (!p.until || p.until >= today))
  if (linked.length === 0) return []
  const cut = addDays(today, -PRIORITY_QUIET_DAYS)
  const ids = linked.map((p) => p.projectId as string)
  const [meetingRows, taskRows, projectRows] = await Promise.all([
    db.select({ projectId: meetings.projectId }).from(meetings).where(and(inArray(meetings.projectId, ids), gte(meetings.date, cut), lte(meetings.date, today))),
    db.select({ projectId: tasks.projectId }).from(tasks).where(and(inArray(tasks.projectId, ids), gte(tasks.updatedAt, `${cut}T00:00:00.000Z`))),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, ids)),
  ])
  const active = new Set([...meetingRows, ...taskRows].map((r) => r.projectId))
  const names = new Map(projectRows.map((p) => [p.id, p.name]))
  const week = isoWeek(today)
  return linked
    .filter((p) => names.has(p.projectId as string) && !active.has(p.projectId as string))
    .map((p) => {
      const rank = profile.priorities.findIndex((x) => x.id === p.id) + 1
      const name = names.get(p.projectId as string) as string
      return {
        kind: 'priority_neglected',
        title: `עדיפות ${rank} בלי תנועה: ${p.title}`,
        body: `${name} — אין פגישה או שינוי במשימות ${PRIORITY_QUIET_DAYS} ימים.`,
        severity: 'attention' as const,
        score: Math.max(0.4, 0.8 - rank * 0.05),
        personId: null,
        sources: [{ nodeId: nodeId('project', p.projectId as string), kind: 'project', label: name }],
        dedupeKey: `priority_neglected:${p.id}:${week}`,
        ttlDays: 7,
      }
    })
}

/** Meetings/tasks linked to a project of another world (spec: project-world-scoping). One per world pair. */
async function detectProjectWorldConflict(ctx: DetectorContext): Promise<HarnessInsightDraft[]> {
  const conflicts = await listWorldConflicts(ctx.db)
  const byPair = new Map<string, typeof conflicts>()
  for (const c of conflicts) {
    const key = [c.itemWorld, c.projectWorld].sort().join(':')
    byPair.set(key, [...(byPair.get(key) ?? []), c])
  }
  return [...byPair.entries()].map(([pair, list]) => {
    const first = list[0]
    return {
      kind: 'project_world_conflict',
      title: `${list.length} קישורים בין ${first.itemWorldName} ל-${first.projectWorldName}`,
      body: list.slice(0, 5).map((c) => `${c.title} ← ${c.projectName}`).join(' · '),
      severity: 'attention' as const,
      score: 0.45,
      personId: null,
      sources: list.slice(0, 5).flatMap((c) => [
        { nodeId: nodeId('project', c.projectId), kind: 'project', label: c.projectName },
        ...(c.kind === 'meeting' ? [{ nodeId: nodeId('meeting', c.id), kind: 'meeting', label: c.title }] : []),
      ]),
      dedupeKey: `project_world_conflict:${pair}`,
      ttlDays: 7,
    }
  })
}

/** Notion files a meeting under a different world than ARO does. ARO's stays; the owner decides. */
async function detectNotionWorldDisagreement(ctx: DetectorContext): Promise<HarnessInsightDraft[]> {
  const list = await listNotionWorldDisagreements(ctx.db)
  if (list.length === 0) return []
  return [{
    kind: 'notion_world_disagreement',
    title: `${list.length} פגישות ש-Notion משייך לעולם אחר`,
    body: list.slice(0, 5).map((d) => `${d.title}: ARO ${d.aroWorldName} · Notion ${d.notionWorldName}`).join(' · '),
    severity: 'info' as const,
    score: 0.3,
    personId: null,
    sources: list.slice(0, 5).map((d) => ({ nodeId: nodeId('meeting', d.meetingId), kind: 'meeting', label: d.title })),
    dedupeKey: 'notion_world_disagreement',
    ttlDays: 7,
  }]
}

const DETECTORS = [
  detectSilentBeforeMeeting,
  detectCoolingWithOpenLoop,
  detectStaleCommitments,
  detectSpendSpike,
  detectUnansweredThread,
  detectMeetingNoFollowthrough,
  detectCalendarOverload,
  detectCommitmentDueNoTask,
  detectProposedPile,
  detectUnpaidInvoice,
  detectProjectGoneQuiet,
  detectReplyBacklog,
  detectVatFilingWindow,
  detectPriorityNeglected,
  detectProjectWorldConflict,
  detectNotionWorldDisagreement,
]

async function loadReplyNeededThreadIds(db: Db, today: string, now: Date): Promise<Set<string>> {
  const cutoff = addDays(today, -UNANSWERED_THREAD_DAYS)
  const threads = await db
    .select({
      id: personEmailThreads.id,
      gmailThreadId: personEmailThreads.gmailThreadId,
      from: personEmailThreads.from,
      subject: personEmailThreads.subject,
      snippet: personEmailThreads.snippet,
      messageCount: personEmailThreads.messageCount,
      date: personEmailThreads.date,
      replyNeed: personEmailThreads.replyNeed,
    })
    .from(personEmailThreads)
    .where(and(lte(personEmailThreads.messageCount, 1), lte(personEmailThreads.date, cutoff)))
  if (threads.length === 0) return new Set()

  const keys = threads.map((t) => t.gmailThreadId)
  const linked = new Set(
    (await db
      .select({ sourceId: commitments.sourceId })
      .from(commitments)
      .where(and(
        eq(commitments.source, 'email'),
        inArray(commitments.status, ['proposed', 'accepted']),
        inArray(commitments.sourceId, keys),
      )))
      .map((row) => row.sourceId)
      .filter((id): id is string => !!id),
  )

  const needed = new Set<string>()
  let classified = 0
  const nowIso = now.toISOString()
  for (const thread of threads) {
    const stored = thread.replyNeed
    if (stored === 'needs_reply') {
      needed.add(thread.id)
      continue
    }
    if (stored === 'fyi' || stored === 'chatter') continue

    const decided = deterministicReplyNeed({
      from: thread.from,
      subject: thread.subject,
      snippet: thread.snippet,
      commitmentLinked: linked.has(thread.gmailThreadId),
    })
    let label: ReplyNeed | null = decided
    if (!label) {
      if (classified >= REPLY_CLASSIFY_CAP) continue
      classified++
      label = await classifyAmbiguousReplyNeed(thread.subject, thread.snippet)
    }
    if (!label) continue
    await db.update(personEmailThreads).set({ replyNeed: label, replyNeedAt: nowIso }).where(eq(personEmailThreads.id, thread.id))
    if (label === 'needs_reply') needed.add(thread.id)
  }
  return needed
}

/** Runs every detector. One failing detector must not take the whole run down. */
export async function runDetectors(db: Db, now = new Date()): Promise<HarnessInsightDraft[]> {
  const today = isoDate(now)
  let replyNeededThreadIds = new Set<string>()
  try {
    replyNeededThreadIds = await loadReplyNeededThreadIds(db, today, now)
  } catch (err) {
    console.warn('[harness-reasoner] reply-need gate failed:', err)
  }
  let selfIds = new Set<string>()
  try {
    const rows = await db.select({ id: people.id, name: people.name }).from(people)
    selfIds = new Set(rows.filter((r) => isSelfPersonName(r.name)).map((r) => r.id))
  } catch (err) {
    console.warn('[harness-reasoner] owner lookup failed:', err)
  }
  const ctx: DetectorContext = {
    db,
    today,
    horizon: addDays(today, LOOKAHEAD_DAYS),
    now,
    replyNeededThreadIds,
    selfIds,
  }

  const results = await Promise.all(
    DETECTORS.map(async (detector) => {
      try {
        return await detector(ctx)
      } catch (err) {
        console.warn(`[harness-reasoner] detector ${detector.name} failed:`, err)
        return [] as HarnessInsightDraft[]
      }
    }),
  )
  return onePerPerson(results.flat().filter((d) => !(d.personId && selfIds.has(d.personId))))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_INSIGHTS)
}

/**
 * One card per person. A single contact can trip several detectors at once (silent before a
 * meeting, an old commitment, an unanswered email), and three cards about the same name read as
 * noise. The strongest wins; the others retire on this run because their dedupeKey is not kept.
 * Insights with no person (finance, calendar, queues) are untouched.
 */
export function onePerPerson(drafts: HarnessInsightDraft[]): HarnessInsightDraft[] {
  const best = new Map<string, HarnessInsightDraft>()
  for (const d of drafts) {
    if (!d.personId) continue
    const cur = best.get(d.personId)
    if (!cur || d.score > cur.score) best.set(d.personId, d)
  }
  return drafts.filter((d) => !d.personId || best.get(d.personId) === d)
}

// ─── Gemini phrasing ───────────────────────────────────────────────────────

function geminiModelId(): string {
  return process.env.GEMINI_MODEL || 'gemini-2.5-flash'
}

function geminiGenerationConfig(): GenerationConfig {
  const model = geminiModelId()
  if (model.startsWith('gemini-3')) {
    const level = (process.env.GEMINI_THINKING_LEVEL || 'high').toLowerCase()
    return { thinkingConfig: { thinkingLevel: level } } as GenerationConfig
  }
  if (model.includes('2.5')) {
    const raw = process.env.GEMINI_THINKING_BUDGET?.trim()
    const budget = raw !== undefined && raw !== '' ? Number(raw) : -1
    return { thinkingConfig: { thinkingBudget: Number.isFinite(budget) ? budget : -1 } } as GenerationConfig
  }
  return {}
}

const PHRASING_PROMPT = `אתה עוזר אישי שמנסח תובנות בעברית עבור מנהל עסוק.

קיבלת רשימת תובנות שזוהו דטרמיניסטית ממספר מקורות (פגישות, וואטסאפ, התחייבויות, פיננסים, מייל).

המשימה שלך: לנסח מחדש כל תובנה כך שתהיה חדה, אישית ומעשית — ולדרג אותה.

חוקים קשיחים:
- אל תמציא עובדות. השתמש אך ורק בנתונים שבתובנה.
- אל תמציא מספרים, תאריכים או שמות שלא מופיעים בקלט.
- title: עד 60 תווים. body: משפט אחד עד שניים, עם המלצה לפעולה.
- score בין 0 ל-1 לפי דחיפות אמיתית.
- שמור על אותו dedupeKey בדיוק.

החזר JSON בלבד במבנה:
{"insights":[{"dedupeKey":"...","title":"...","body":"...","score":0.8}]}`

function parseJsonBlock(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const text = (fenced ? fenced[1] : raw).trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('no JSON object in response')
  return JSON.parse(text.slice(start, end + 1))
}

/**
 * Rewrites the drafts through Gemini. Returns the input untouched when there is no key
 * or the call fails — the deterministic Hebrew text is already shippable.
 */
export async function phraseInsights(
  drafts: HarnessInsightDraft[],
): Promise<{ insights: HarnessInsightDraft[]; model: string | null }> {
  if (drafts.length === 0) return { insights: drafts, model: null }
  const key = process.env.GEMINI_API_KEY
  if (!key) return { insights: drafts, model: null }

  try {
    const genAI = new GoogleGenerativeAI(key)
    const model = genAI.getGenerativeModel({
      model: geminiModelId(),
      generationConfig: geminiGenerationConfig(),
    })
    const payload = drafts.map((d) => ({
      dedupeKey: d.dedupeKey,
      kind: d.kind,
      title: d.title,
      body: d.body,
      severity: d.severity,
      score: d.score,
    }))
    const raw = (await model.generateContent(`${PHRASING_PROMPT}\n\n${JSON.stringify(payload, null, 2)}`)).response.text()
    const parsed = parseJsonBlock(raw) as { insights?: Array<{ dedupeKey?: string; title?: string; body?: string; score?: number }> }

    const byKey = new Map((parsed.insights ?? []).filter((i) => i.dedupeKey).map((i) => [i.dedupeKey as string, i]))
    const insights = drafts.map((d) => {
      const better = byKey.get(d.dedupeKey)
      if (!better) return d
      return {
        ...d,
        title: better.title?.trim() || d.title,
        body: better.body?.trim() || d.body,
        score: typeof better.score === 'number' && better.score >= 0 && better.score <= 1 ? better.score : d.score,
      }
    })
    return { insights: insights.sort((a, b) => b.score - a.score), model: geminiModelId() }
  } catch (err) {
    console.warn('[harness-reasoner] Gemini phrasing failed, using deterministic text:', err)
    return { insights: drafts, model: null }
  }
}

// ─── Persistence ───────────────────────────────────────────────────────────

/**
 * Writes drafts to `harness_insights` keyed by `dedupeKey`. A re-fire refreshes the text
 * and the expiry but leaves `status` alone, so something the user dismissed stays dismissed.
 */
export async function persistInsights(
  db: Db,
  drafts: HarnessInsightDraft[],
  now = new Date(),
): Promise<{ created: number; updated: number }> {
  if (drafts.length === 0) return { created: 0, updated: 0 }
  const nowIso = now.toISOString()
  const keys = drafts.map((d) => d.dedupeKey)

  const existing = new Map(
    (
      await db
        .select({ id: harnessInsights.id, dedupeKey: harnessInsights.dedupeKey })
        .from(harnessInsights)
        .where(inArray(harnessInsights.dedupeKey, keys))
    ).map((r) => [r.dedupeKey, r.id] as const),
  )

  let created = 0
  let updated = 0
  for (const d of drafts) {
    const expiresAt = new Date(now.getTime() + d.ttlDays * 86400000).toISOString()
    const fields = {
      kind: d.kind,
      factsHash: insightFactsHash(d),
      title: d.title,
      body: d.body,
      severity: d.severity,
      score: d.score,
      personId: d.personId,
      sources: JSON.stringify(d.sources),
      generatedAt: nowIso,
      expiresAt,
      updatedAt: nowIso,
    }
    const id = existing.get(d.dedupeKey)
    if (id) {
      await db.update(harnessInsights).set(fields).where(eq(harnessInsights.id, id))
      updated++
    } else {
      await db.insert(harnessInsights).values({
        ...fields,
        id: `hi_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
        dedupeKey: d.dedupeKey,
        status: 'open',
        createdAt: nowIso,
      })
      created++
    }
  }
  return { created, updated }
}

/** Retire open insights whose dedupeKey is not among the current run's output — they are no longer supported by live data. */
async function retireStaleInsights(db: Db, activeKeys: string[], now: Date): Promise<number> {
  if (activeKeys.length === 0) {
    // No drafts this run: retire everything open.
    const rows = await db.select({ id: harnessInsights.id }).from(harnessInsights).where(eq(harnessInsights.status, 'open'))
    if (rows.length === 0) return 0
    await db
      .update(harnessInsights)
      .set({ status: 'retired', updatedAt: now.toISOString() })
      .where(eq(harnessInsights.status, 'open'))
    return rows.length
  }
  const rows = await db
    .select({ id: harnessInsights.id })
    .from(harnessInsights)
    .where(and(eq(harnessInsights.status, 'open'), notInArray(harnessInsights.dedupeKey, activeKeys)))
  if (rows.length === 0) return 0
  await db
    .update(harnessInsights)
    .set({ status: 'retired', updatedAt: now.toISOString() })
    .where(and(eq(harnessInsights.status, 'open'), notInArray(harnessInsights.dedupeKey, activeKeys)))
  return rows.length
}

/** What a draft asserts, independent of wording: same hash → no need to re-phrase. */
export function insightFactsHash(d: Pick<HarnessInsightDraft, 'kind' | 'severity' | 'sources'>): string {
  const ids = d.sources.map((s) => s.nodeId).sort()
  return createHash('sha1').update(JSON.stringify([d.kind, d.severity, ids])).digest('hex').slice(0, 16)
}

// ─── Feedback-driven downgrade (spec: agent-episodes) ──────────────────────

export const DOWNGRADE_WINDOW_DAYS = 30
export const DOWNGRADE_MIN_RESOLVED = 6
export const DOWNGRADE_DISMISS_RATE = 0.75

export interface KindStat {
  kind: string
  dismissed: number
  acted: number
  downgraded: boolean
}

/** Per detector kind: how often the owner dismissed vs acted on it in the last 30 days. */
export async function insightKindStats(db: Db, now = new Date()): Promise<KindStat[]> {
  const since = new Date(now.getTime() - DOWNGRADE_WINDOW_DAYS * 86400000).toISOString()
  const rows = await db
    .select({ kind: harnessInsights.kind, status: harnessInsights.status })
    .from(harnessInsights)
    .where(and(inArray(harnessInsights.status, ['dismissed', 'acted']), gte(harnessInsights.updatedAt, since)))
  const byKind = new Map<string, { dismissed: number; acted: number }>()
  for (const r of rows) {
    const s = byKind.get(r.kind) ?? { dismissed: 0, acted: 0 }
    if (r.status === 'dismissed') s.dismissed++
    else s.acted++
    byKind.set(r.kind, s)
  }
  return [...byKind.entries()].map(([kind, s]) => {
    const total = s.dismissed + s.acted
    return {
      kind,
      ...s,
      downgraded: total >= DOWNGRADE_MIN_RESOLVED && s.dismissed / total >= DOWNGRADE_DISMISS_RATE,
    }
  })
}

const SEVERITY_DOWN: Record<InsightSeverity, InsightSeverity> = { urgent: 'attention', attention: 'info', info: 'info' }

export function applyDowngrades(drafts: HarnessInsightDraft[], stats: KindStat[]): HarnessInsightDraft[] {
  const down = new Set(stats.filter((s) => s.downgraded).map((s) => s.kind))
  return drafts.map((d) => (down.has(d.kind) ? { ...d, severity: SEVERITY_DOWN[d.severity] } : d))
}

/**
 * Keep stored wording for drafts whose facts did not change; return only the changed ones for
 * Gemini. Unchanged drafts get their stored title/body so persist does not overwrite good text.
 */
async function splitByChangedFacts(
  db: Db,
  drafts: HarnessInsightDraft[],
): Promise<{ changed: HarnessInsightDraft[]; unchanged: HarnessInsightDraft[] }> {
  if (drafts.length === 0) return { changed: [], unchanged: [] }
  const stored = new Map(
    (
      await db
        .select({
          dedupeKey: harnessInsights.dedupeKey,
          factsHash: harnessInsights.factsHash,
          title: harnessInsights.title,
          body: harnessInsights.body,
          score: harnessInsights.score,
        })
        .from(harnessInsights)
        .where(inArray(harnessInsights.dedupeKey, drafts.map((d) => d.dedupeKey)))
    ).map((r) => [r.dedupeKey, r] as const),
  )
  const changed: HarnessInsightDraft[] = []
  const unchanged: HarnessInsightDraft[] = []
  for (const d of drafts) {
    const prev = stored.get(d.dedupeKey)
    if (prev && prev.factsHash && prev.factsHash === insightFactsHash(d)) {
      unchanged.push({ ...d, title: prev.title, body: prev.body, score: prev.score })
    } else {
      changed.push(d)
    }
  }
  return { changed, unchanged }
}

/** Detect, phrase, persist, and retire stale insights. */
export async function reasonAndPersist(
  db: Db,
  now = new Date(),
  options: { phraseChangedOnly?: boolean } = {},
): Promise<ReasonResult> {
  const stats = await insightKindStats(db, now)
  const drafts = applyDowngrades(await runDetectors(db, now), stats)
  let insights: HarnessInsightDraft[]
  let model: string | null
  if (options.phraseChangedOnly) {
    const { changed, unchanged } = await splitByChangedFacts(db, drafts)
    const phrased = await phraseInsights(changed)
    insights = [...phrased.insights, ...unchanged].sort((a, b) => b.score - a.score)
    model = phrased.model
  } else {
    ;({ insights, model } = await phraseInsights(drafts))
  }
  const { created, updated } = await persistInsights(db, insights, now)
  await retireStaleInsights(db, insights.map((i) => i.dedupeKey), now)
  await writeHarnessStamp(db, 'harnessReasonedAt', now.toISOString())
  return { insights, created, updated, model }
}

export async function markInsightActed(db: Db, id: string): Promise<boolean> {
  const [row] = await db.select({ id: harnessInsights.id }).from(harnessInsights).where(eq(harnessInsights.id, id))
  if (!row) return false
  await db
    .update(harnessInsights)
    .set({ status: 'acted', updatedAt: new Date().toISOString() })
    .where(eq(harnessInsights.id, id))
  return true
}

export interface StoredInsight {
  id: string
  kind: string
  title: string
  body: string
  severity: string
  score: number
  personId: string | null
  sources: InsightSource[]
  generatedAt: string
  /** ISO timestamp of the last push that included this insight; null = never pushed. */
  notifiedAt: string | null
}

/** Open, unexpired insights, highest score first. */
export async function listOpenInsights(
  db: Db,
  options: { limit?: number; severity?: InsightSeverity; now?: Date } = {},
): Promise<StoredInsight[]> {
  const now = (options.now ?? new Date()).toISOString()
  const rows = await db
    .select()
    .from(harnessInsights)
    .where(eq(harnessInsights.status, 'open'))
    .orderBy(desc(harnessInsights.score))

  const severityRank: Record<string, number> = { info: 0, attention: 1, urgent: 2 }
  const minRank = options.severity ? severityRank[options.severity] ?? 0 : 0

  return rows
    .filter((r) => !r.expiresAt || r.expiresAt > now)
    .filter((r) => (severityRank[r.severity] ?? 0) >= minRank)
    .slice(0, options.limit ?? 20)
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      severity: r.severity,
      score: r.score,
      personId: r.personId,
      sources: parseSources(r.sources),
      generatedAt: r.generatedAt,
      notifiedAt: r.notifiedAt ?? null,
    }))
}

function parseSources(raw: string | null): InsightSource[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as InsightSource[]) : []
  } catch {
    return []
  }
}

export async function dismissInsight(db: Db, id: string): Promise<boolean> {
  const [row] = await db.select({ id: harnessInsights.id }).from(harnessInsights).where(eq(harnessInsights.id, id))
  if (!row) return false
  await db
    .update(harnessInsights)
    .set({ status: 'dismissed', updatedAt: new Date().toISOString() })
    .where(eq(harnessInsights.id, id))
  return true
}

/**
 * When a commitment is rejected, immediately close any open insights whose `sources` JSON
 * contains a reference to that commitment (`commitment:<id>`). This prevents a dismissed
 * commitment from keeping a cross-domain insight alive until it expires naturally.
 */
export async function closeInsightsForCommitment(db: Db, commitmentId: string): Promise<void> {
  const target = `commitment:${commitmentId}`
  const open = await db.select({ id: harnessInsights.id, sources: harnessInsights.sources })
    .from(harnessInsights)
    .where(eq(harnessInsights.status, 'open'))
  const toClose = open.filter((r) => {
    try {
      const srcs = JSON.parse(r.sources ?? '[]') as { nodeId?: string }[]
      return srcs.some((s) => s.nodeId === target)
    } catch { return false }
  })
  if (toClose.length === 0) return
  const ids = toClose.map((r) => r.id)
  await db
    .update(harnessInsights)
    .set({ status: 'dismissed', updatedAt: new Date().toISOString() })
    .where(inArray(harnessInsights.id, ids))
}

/** Urgent cards (up to 5) plus unpushed situation-level attention (up to 3). Person attention stays on the dashboard. */
export function selectInsightsToPush<T extends { severity: string; kind: string; notifiedAt: string | null }>(
  insights: T[],
): T[] {
  const unpushed = insights.filter((insight) => !insight.notifiedAt)
  const urgent = unpushed.filter((insight) => insight.severity === 'urgent').slice(0, 5)
  const attention = unpushed
    .filter((insight) => insight.severity === 'attention' && SITUATION_KIND_SET.has(insight.kind))
    .slice(0, 3)
  return [...urgent, ...attention]
}

/** Hebrew lines for the morning brief. */
export function formatInsightLines(insights: StoredInsight[]): string[] {
  return insights.map((i) => `${i.severity === 'urgent' ? '❗' : '•'} ${i.title} — ${i.body}`)
}
