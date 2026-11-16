/**
 * One status per person: in good shape, steady, or "needs a 1:1". Reads every channel — meetings
 * (analysed or not), WhatsApp DMs, email threads, the manual last-contact date — so "last contact"
 * is the real one. Computed on read; no LLM. Spec: docs/specs/relationship-needs-1on1.md
 */
import { and, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm'
import {
  meetingAnalyses,
  meetingPeople,
  meetings,
  people,
  personEmailThreads,
  voiceRecordingPeople,
  voiceRecordings,
  whatsappDmMessages,
  whatsappMessages,
  whatsappPersonLinks,
  type getDb,
} from '@ak-system/database'
import { normalizeParticipantName, parseStoredParticipants } from '../lib/calendar-participants'
import { isSelfPersonName } from '../lib/self-identity'
import { analysisSentiment, relationshipBoard, type RelationshipCard } from './warmth'

type Db = ReturnType<typeof getDb>

export type AttentionStatus = 'needs_1on1' | 'steady' | 'good'
export type AttentionReason = 'tone_drop' | 'low_1on1' | 'quiet'
export type ContactChannel = 'meeting' | 'whatsapp' | 'whatsapp_group' | 'recording' | 'email' | 'manual'
export type InteractionKind = 'one_on_one' | 'group' | 'direct'

export interface Interaction {
  date: string
  kind: InteractionKind
  channel: ContactChannel
  meetingId?: string
  title?: string
  score?: number | null
  /** −1…+1 from the meeting analysis; null when the meeting was never analysed */
  sentiment?: number | null
}

export interface AttentionEvidence {
  meetingId: string
  date: string
  title: string
  kind: 'one_on_one' | 'group'
  score: number | null
  sentiment: number
}

export interface PersonAttention {
  /** Null when the relationship is too thin to judge (see `isEligible`). */
  status: AttentionStatus | null
  reasons: AttentionReason[]
  /** Ranking weight for needs_1on1; ≥ 1 per reason, ≥ 2 interrupts the dashboard. */
  severity: number
  tone: number | null
  baseline: number | null
  quietDays: number | null
  expectedGapDays: number
  lastContact: { date: string; channel: ContactChannel } | null
  last1on1Date: string | null
  last1on1Score: number | null
  next1on1Date: string | null
  acknowledgedAt: string | null
  /** A needs_1on1 that is hidden for now: a 1:1 is booked, or the owner already saw it. */
  suppressed: 'scheduled' | 'acknowledged' | null
  /** Analysed meetings behind the tone, newest first. */
  evidence: AttentionEvidence[]
}

export const WINDOW_DAYS = 180
/** How far back the last personal contact is looked up. */
const LOOKBACK_DAYS = 365
const HALF_LIFE_DAYS = 30
const GROUP_WEIGHT = 0.5
const TONE_THRESHOLD = 0.2
const MIN_ANALYSED_FOR_TONE = 3
const MIN_INTERACTIONS = 4
const DEFAULT_GAP_DAYS = 21
const MIN_GAP_DAYS = 7
const QUIET_FACTOR = 2
const LOW_1ON1_SCORE = 5
const GOOD_1ON1_SCORE = 8
const SCHEDULED_AHEAD_DAYS = 7
const ACK_EXPIRY_DAYS = 30
/** The dashboard, the brief and the harness interrupt only at this severity. */
export const INTERRUPT_SEVERITY = 2

const DAY_MS = 86_400_000

function dayNumber(date: string): number {
  return Math.floor(new Date(`${date.slice(0, 10)}T00:00:00Z`).getTime() / DAY_MS)
}

function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from)
}

export function addDays(date: string, days: number): string {
  return new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10)
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

const RESOURCE = /(^|[-_\s])(cr|room|mtr|hall|zoom|teams)([-_\s]|$)/i

/** People on a meeting other than the owner, from linked contacts and the calendar invite. */
export function otherAttendeeCount(linkedNames: string[], calendarParticipants: string | null): number {
  const linked = new Set(linkedNames.filter((n) => !isSelfPersonName(n)).map(normalizeParticipantName))
  const invited = new Set(
    parseStoredParticipants(calendarParticipants)
      .filter((p) => !isSelfPersonName(p.name) && !RESOURCE.test(p.name))
      .map((p) => (p.email ?? p.name).toLowerCase()),
  )
  return Math.max(linked.size, invited.size)
}

export function isEligible(interactions: Interaction[], today: string, contactFrequencyDays: number | null): boolean {
  if (contactFrequencyDays != null && contactFrequencyDays > 0) return true
  const start = addDays(today, -WINDOW_DAYS)
  return interactions.filter((i) => i.date >= start && i.date <= today).length >= MIN_INTERACTIONS
}

/** Pure rules — the loader below only gathers the inputs. */
export function evaluateAttention(input: {
  interactions: Interaction[]
  today: string
  contactFrequencyDays: number | null
  ackAt: string | null
  next1on1Date: string | null
}): PersonAttention {
  const { today, contactFrequencyDays, ackAt, next1on1Date } = input
  const past = input.interactions.filter((i) => i.date <= today).sort((a, b) => b.date.localeCompare(a.date))
  const windowStart = addDays(today, -WINDOW_DAYS)
  const inWindow = past.filter((i) => i.date >= windowStart)

  const last = past[0] ?? null
  const lastContact = last ? { date: last.date, channel: last.channel } : null

  const meetingsSeen = inWindow.filter((i): i is Interaction & { meetingId: string } => i.kind !== 'direct' && !!i.meetingId)
  const analysed = meetingsSeen.filter((i) => i.sentiment != null)
  const evidence: AttentionEvidence[] = analysed.slice(0, 12).map((i) => ({
    meetingId: i.meetingId,
    date: i.date,
    title: i.title ?? '',
    kind: i.kind as 'one_on_one' | 'group',
    score: i.score ?? null,
    sentiment: i.sentiment!,
  }))

  let tone: number | null = null
  let baseline: number | null = null
  if (analysed.length >= MIN_ANALYSED_FOR_TONE) {
    let sw = 0
    let s = 0
    for (const i of analysed) {
      const w = 0.5 ** (daysBetween(i.date, today) / HALF_LIFE_DAYS) * (i.kind === 'one_on_one' ? 1 : GROUP_WEIGHT)
      sw += w
      s += w * i.sentiment!
    }
    tone = round(s / sw)
    baseline = round(analysed.reduce((sum, i) => sum + i.sentiment!, 0) / analysed.length)
  }

  const last1on1 = past.find((i) => i.kind === 'one_on_one') ?? null
  const last1on1Score = last1on1?.score ?? null

  const personal = past.filter((i) => i.kind !== 'group')
  // Any contact breaks a silence — a group meeting, a recording, a word in a shared WhatsApp
  // group. "Quiet" means we have not talked at all, not that we have not had a 1:1.
  const quietDays = last ? daysBetween(last.date, today) : null
  const personalDays = [...new Set(personal.filter((i) => i.date >= windowStart).map((i) => i.date))].sort()
  const gaps = personalDays.slice(1).map((d, idx) => daysBetween(personalDays[idx]!, d))
  const learnedGap = personalDays.length >= 3 ? median(gaps) : null
  const expectedGapDays = Math.max(MIN_GAP_DAYS, Math.round(contactFrequencyDays && contactFrequencyDays > 0 ? contactFrequencyDays : learnedGap ?? DEFAULT_GAP_DAYS))

  const base: Omit<PersonAttention, 'status' | 'reasons' | 'severity' | 'suppressed'> = {
    tone,
    baseline,
    quietDays,
    expectedGapDays,
    lastContact,
    last1on1Date: last1on1?.date ?? null,
    last1on1Score,
    next1on1Date,
    acknowledgedAt: ackAt,
    evidence,
  }
  if (!isEligible(past, today, contactFrequencyDays)) {
    return { ...base, status: null, reasons: [], severity: 0, suppressed: null }
  }

  const reasons: AttentionReason[] = []
  let severity = 0
  // A strong 1:1 since the drop is the answer to it; the decayed average would lag a few weeks.
  const answered = last1on1Score != null && last1on1Score >= GOOD_1ON1_SCORE
  if (tone != null && baseline != null && tone <= baseline - TONE_THRESHOLD && !answered) {
    reasons.push('tone_drop')
    severity += (baseline - tone) / TONE_THRESHOLD
  }
  if (last1on1Score != null && last1on1Score <= LOW_1ON1_SCORE) {
    reasons.push('low_1on1')
    severity += 1
  }
  // Nobody I only ever meet in groups is "quiet" unless I asked for a rhythm with them.
  const wantsRhythm = contactFrequencyDays != null && contactFrequencyDays > 0
  const quiet = quietDays != null
    ? (personal.length > 0 || wantsRhythm) && quietDays > QUIET_FACTOR * expectedGapDays
    : wantsRhythm
  if (quiet) {
    reasons.push('quiet')
    severity += quietDays != null ? quietDays / expectedGapDays - 1 : QUIET_FACTOR
  }

  if (reasons.length > 0) {
    let suppressed: PersonAttention['suppressed'] = null
    if (next1on1Date && next1on1Date >= today && daysBetween(today, next1on1Date) <= SCHEDULED_AHEAD_DAYS) {
      suppressed = 'scheduled'
    } else if (ackAt) {
      const ackDay = ackAt.slice(0, 10)
      // New evidence is a meeting after the ack; a chat message alone doesn't re-open it.
      const newMeeting = past.some((i) => i.channel === 'meeting' && i.date > ackDay)
      if (!newMeeting && daysBetween(ackDay, today) < ACK_EXPIRY_DAYS) suppressed = 'acknowledged'
    }
    return { ...base, status: 'needs_1on1', reasons, severity: round(severity), suppressed }
  }

  const good =
    (tone != null && baseline != null && tone >= baseline + TONE_THRESHOLD) ||
    (last1on1Score != null && last1on1Score >= GOOD_1ON1_SCORE && quietDays != null && quietDays <= expectedGapDays)
  return { ...base, status: good ? 'good' : 'steady', reasons: [], severity: 0, suppressed: null }
}

/** Flags shown in lists and interrupts: needs a 1:1 and not hidden. */
export function isOpenFlag(a: PersonAttention): boolean {
  return a.status === 'needs_1on1' && a.suppressed == null
}

export function isInterrupting(a: PersonAttention): boolean {
  return isOpenFlag(a) && a.severity >= INTERRUPT_SEVERITY
}

export interface AttentionPerson {
  id: string
  name: string
  /** For the "קבע 1:1" invite */
  email: string | null
}

/**
 * Loads every channel for the given confirmed people (all of them when `personIds` is omitted)
 * and evaluates each. A few bulk queries, no per-person round trips.
 */
export async function loadAttention(
  db: Db,
  opts: { personIds?: string[]; now?: Date } = {},
): Promise<Map<string, PersonAttention & AttentionPerson>> {
  const now = opts.now ?? new Date()
  const today = now.toISOString().slice(0, 10)
  const from = addDays(today, -LOOKBACK_DAYS)
  const ahead = addDays(today, SCHEDULED_AHEAD_DAYS)
  const out = new Map<string, PersonAttention & AttentionPerson>()
  if (opts.personIds && opts.personIds.length === 0) return out

  const personRows = (
    await db
      .select({
        id: people.id,
        name: people.name,
        email: people.email,
        lastContact: people.lastContact,
        contactFrequencyDays: people.contactFrequencyDays,
        attentionAckAt: people.attentionAckAt,
      })
      .from(people)
      .where(opts.personIds ? and(eq(people.status, 'confirmed'), inArray(people.id, opts.personIds)) : eq(people.status, 'confirmed'))
  ).filter((p) => !isSelfPersonName(p.name))
  if (personRows.length === 0) return out
  const ids = personRows.map((p) => p.id)
  const scoped = opts.personIds ? ids : null

  const links = await db
    .select({ personId: meetingPeople.personId, meetingId: meetings.id, date: meetings.date, title: meetings.title, calendarParticipants: meetings.calendarParticipants })
    .from(meetingPeople)
    .innerJoin(meetings, eq(meetings.id, meetingPeople.meetingId))
    .where(and(gte(meetings.date, from), lte(meetings.date, ahead), ...(scoped ? [inArray(meetingPeople.personId, scoped)] : [])))
  const meetingIds = [...new Set(links.map((l) => l.meetingId))]

  const linkedNames = new Map<string, string[]>()
  const analysisByMeeting = new Map<string, { score: number | null; sentiment: number }>()
  for (let i = 0; i < meetingIds.length; i += 500) {
    const chunk = meetingIds.slice(i, i + 500)
    const roster = await db
      .select({ meetingId: meetingPeople.meetingId, name: people.name })
      .from(meetingPeople)
      .innerJoin(people, eq(people.id, meetingPeople.personId))
      .where(inArray(meetingPeople.meetingId, chunk))
    for (const r of roster) linkedNames.set(r.meetingId, [...(linkedNames.get(r.meetingId) ?? []), r.name])
    const analyses = await db
      .select({ meetingId: meetingAnalyses.meetingId, score: meetingAnalyses.score, mood: meetingAnalyses.mood, subtext: meetingAnalyses.subtext, createdAt: meetingAnalyses.createdAt })
      .from(meetingAnalyses)
      .where(and(inArray(meetingAnalyses.meetingId, chunk), isNotNull(meetingAnalyses.score)))
    for (const a of analyses.sort((x, y) => y.createdAt.localeCompare(x.createdAt))) {
      if (!analysisByMeeting.has(a.meetingId)) analysisByMeeting.set(a.meetingId, { score: a.score, sentiment: analysisSentiment(a) })
    }
  }

  const fromMs = dayNumber(from) * DAY_MS
  const dms = await db
    .select({ personId: whatsappDmMessages.personId, ts: whatsappDmMessages.ts })
    .from(whatsappDmMessages)
    .where(and(gte(whatsappDmMessages.ts, fromMs), ...(scoped ? [inArray(whatsappDmMessages.personId, scoped)] : [])))
  const emails = await db
    .select({ personId: personEmailThreads.personId, date: personEmailThreads.date })
    .from(personEmailThreads)
    .where(and(gte(personEmailThreads.date, from), ...(scoped ? [inArray(personEmailThreads.personId, scoped)] : [])))

  // Messages they wrote in a shared WhatsApp group, through their linked JIDs.
  const jidLinks = await db
    .select({ personId: whatsappPersonLinks.personId, jid: whatsappPersonLinks.whatsappJid })
    .from(whatsappPersonLinks)
    .where(scoped ? inArray(whatsappPersonLinks.personId, scoped) : undefined)
  const personByJid = new Map(jidLinks.map((l) => [l.jid, l.personId]))
  const groupMsgs = personByJid.size === 0
    ? []
    : await db
      .select({ sender: whatsappMessages.sender, ts: whatsappMessages.ts })
      .from(whatsappMessages)
      .where(and(gte(whatsappMessages.ts, fromMs), inArray(whatsappMessages.sender, [...personByJid.keys()])))
  // Recorded conversations tagged with the person (some have no meeting row of their own).
  const recordings = await db
    .select({ personId: voiceRecordingPeople.personId, createdAt: voiceRecordings.createdAt })
    .from(voiceRecordingPeople)
    .innerJoin(voiceRecordings, eq(voiceRecordings.id, voiceRecordingPeople.recordingId))
    .where(and(gte(voiceRecordings.createdAt, from), ...(scoped ? [inArray(voiceRecordingPeople.personId, scoped)] : [])))

  const byPerson = new Map<string, Interaction[]>(ids.map((id) => [id, []]))
  const next1on1 = new Map<string, string>()
  const seenMeeting = new Set<string>()
  for (const l of links) {
    const key = `${l.personId}:${l.meetingId}`
    if (seenMeeting.has(key) || !byPerson.has(l.personId)) continue
    seenMeeting.add(key)
    const kind = otherAttendeeCount(linkedNames.get(l.meetingId) ?? [], l.calendarParticipants) <= 1 ? 'one_on_one' : 'group'
    if (l.date > today) {
      if (kind === 'one_on_one' && (!next1on1.has(l.personId) || l.date < next1on1.get(l.personId)!)) next1on1.set(l.personId, l.date)
      continue
    }
    if (l.date === today && kind === 'one_on_one' && !next1on1.has(l.personId)) next1on1.set(l.personId, today)
    const a = analysisByMeeting.get(l.meetingId)
    byPerson.get(l.personId)!.push({
      date: l.date, kind, channel: 'meeting', meetingId: l.meetingId, title: l.title,
      score: a?.score ?? null, sentiment: a?.sentiment ?? null,
    })
  }
  const seenDay = new Set<string>()
  for (const m of dms) {
    const date = new Date(m.ts).toISOString().slice(0, 10)
    const key = `${m.personId}:${date}`
    if (seenDay.has(key) || date > today) continue
    seenDay.add(key)
    byPerson.get(m.personId)?.push({ date, kind: 'direct', channel: 'whatsapp' })
  }
  for (const e of emails) {
    const date = e.date.slice(0, 10)
    if (date <= today) byPerson.get(e.personId)?.push({ date, kind: 'direct', channel: 'email' })
  }
  for (const m of groupMsgs) {
    const personId = personByJid.get(m.sender)
    if (!personId) continue
    const date = new Date(m.ts).toISOString().slice(0, 10)
    const key = `${personId}:g:${date}`
    if (seenDay.has(key) || date > today) continue
    seenDay.add(key)
    // A group thread is contact, not a personal conversation — it breaks silence but does not
    // teach the personal rhythm.
    byPerson.get(personId)?.push({ date, kind: 'group', channel: 'whatsapp_group' })
  }
  for (const r of recordings) {
    const date = r.createdAt.slice(0, 10)
    if (date <= today) byPerson.get(r.personId)?.push({ date, kind: 'direct', channel: 'recording' })
  }

  for (const p of personRows) {
    const list = byPerson.get(p.id)!
    const manual = p.lastContact?.slice(0, 10)
    if (manual && /^\d{4}-\d{2}-\d{2}$/.test(manual) && manual <= today) list.push({ date: manual, kind: 'direct', channel: 'manual' })
    out.set(p.id, {
      id: p.id,
      name: p.name,
      email: p.email ?? null,
      ...evaluateAttention({
        interactions: list,
        today,
        contactFrequencyDays: p.contactFrequencyDays ?? null,
        ackAt: p.attentionAckAt ?? null,
        next1on1Date: next1on1.get(p.id) ?? null,
      }),
    })
  }
  return out
}

export async function personAttention(db: Db, personId: string, now?: Date): Promise<PersonAttention | null> {
  return (await loadAttention(db, { personIds: [personId], now })).get(personId) ?? null
}

export async function acknowledgeAttention(db: Db, personId: string, ack: boolean, now = new Date()): Promise<{ acknowledgedAt: string | null } | null> {
  const [row] = await db.select({ id: people.id }).from(people).where(eq(people.id, personId))
  if (!row) return null
  const acknowledgedAt = ack ? now.toISOString() : null
  await db.update(people).set({ attentionAckAt: acknowledgedAt }).where(eq(people.id, personId))
  return { acknowledgedAt }
}

/** Short Hebrew line per reason, for the brief, meeting prep and the harness. No LLM. */
export function attentionReasonText(a: PersonAttention): string[] {
  const out: string[] = []
  const day = (d: string) => `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}`
  if (a.reasons.includes('tone_drop')) out.push('הטון בשיחות האחרונות ירד')
  if (a.reasons.includes('low_1on1') && a.last1on1Date) out.push(`ה-1:1 האחרון (${day(a.last1on1Date)}) קיבל ${a.last1on1Score}/10`)
  if (a.reasons.includes('quiet')) {
    out.push(a.quietDays != null ? `אין שום קשר ${a.quietDays} ימים (בדרך כלל כל ${a.expectedGapDays})` : 'אין שום קשר בשנה האחרונה')
  }
  return out
}

export type AttentionCard = RelationshipCard & { attention: PersonAttention | null }

function legacyTrend(a: PersonAttention | null, fallback: RelationshipCard['trend']): RelationshipCard['trend'] {
  if (!a || a.status == null) return fallback
  if (isOpenFlag(a)) return 'cooling'
  if (a.status === 'good') return 'warming'
  return 'stable'
}

function attentionOrder(a: AttentionCard, b: AttentionCard): number {
  const rank = (c: AttentionCard) => {
    const at = c.attention
    if (!at || at.status == null) return 4
    if (isOpenFlag(at)) return 0
    if (at.suppressed) return 1
    return at.status === 'good' ? 2 : 3
  }
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra - rb
  if (ra === 0) return b.attention!.severity - a.attention!.severity
  return (b.attention?.lastContact?.date ?? b.lastDate ?? '').localeCompare(a.attention?.lastContact?.date ?? a.lastDate ?? '')
}

/**
 * The relationships board with one attention status per person. People with no analysed meeting
 * still appear when the relationship is active on other channels. `trend` mirrors the status for
 * clients built before the status existed (needs a 1:1 → cooling, good → warming).
 */
export async function relationshipBoardWithAttention(db: Db, now = new Date()) {
  const [board, attention] = await Promise.all([relationshipBoard(db, now), loadAttention(db, { now })])
  const cards = new Map<string, AttentionCard>()
  for (const card of board.people) {
    const a = attention.get(card.id) ?? null
    cards.set(card.id, {
      ...card,
      trend: legacyTrend(a, card.trend),
      dataReason: a && isOpenFlag(a) ? `${attentionReasonText(a).join(' · ')}.` : card.dataReason,
      attention: a,
    })
  }
  const missing = [...attention.values()].filter((a) => a.status != null && !cards.has(a.id))
  const notes = missing.length
    ? await db.select({ id: people.id, note: people.warmthNote, noteUpdatedAt: people.warmthNoteUpdatedAt }).from(people).where(inArray(people.id, missing.map((m) => m.id)))
    : []
  const noteById = new Map(notes.map((n) => [n.id, n]))
  for (const a of missing) {
    cards.set(a.id, {
      id: a.id,
      name: a.name,
      trend: legacyTrend(a, null),
      recentAvg: null,
      olderAvg: null,
      count: 0,
      minForTrend: MIN_INTERACTIONS,
      avgScore: null,
      recentCount: 0,
      lastDate: null,
      latestMood: null,
      latestInsight: null,
      dataReason: isOpenFlag(a) ? `${attentionReasonText(a).join(' · ')}.` : 'אין עדיין שיחות מנותחות. הסטטוס לפי תדירות הקשר.',
      note: noteById.get(a.id)?.note ?? null,
      noteUpdatedAt: noteById.get(a.id)?.noteUpdatedAt ?? null,
      timeline: [],
      attention: a,
    })
  }
  const peopleCards = [...cards.values()].sort(attentionOrder)
  return {
    ...board,
    people: peopleCards,
    summary: {
      ...board.summary,
      peopleWithData: peopleCards.length,
      needs1on1: peopleCards.filter((c) => c.attention && isOpenFlag(c.attention)).length,
    },
  }
}

export interface Needs1on1Flag {
  personId: string
  name: string
  severity: number
  reasons: AttentionReason[]
  reasonText: string[]
}

/** Open "needs a 1:1" flags, worst first, for list pills and the home card. */
export async function needs1on1Flags(db: Db, now = new Date()): Promise<Needs1on1Flag[]> {
  const attention = await loadAttention(db, { now })
  return [...attention.values()]
    .filter(isOpenFlag)
    .sort((a, b) => b.severity - a.severity)
    .map((a) => ({ personId: a.id, name: a.name, severity: a.severity, reasons: a.reasons, reasonText: attentionReasonText(a) }))
}
