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
import { and, desc, eq, gte, inArray, lte, not, notInArray } from 'drizzle-orm'
import {
  commitments,
  financeTransactions,
  harnessInsights,
  meetingPeople,
  meetings,
  people,
  personEmailThreads,
  whatsappDmMessages,
  type getDb,
} from '@ak-system/database'
import { personWarmth } from './warmth'
import { nodeId } from './harness-context'

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

/** No WhatsApp for this long before a meeting counts as silence. */
const SILENCE_DAYS = 14
/** An open commitment older than this is stale regardless of other signals. */
const STALE_COMMITMENT_DAYS = 21
/** Monthly spend this far above the trailing average is a spike. */
const SPEND_SPIKE_RATIO = 1.4
/** An email thread with no follow-up for this long is worth surfacing. */
const UNANSWERED_THREAD_DAYS = 5
/** How far ahead "upcoming meeting" reaches. */
const LOOKAHEAD_DAYS = 7

const MAX_INSIGHTS = 30

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

  const personIds = [...new Set(links.map((l) => l.personId))]
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

  const silenceCutoffMs = Date.now() - SILENCE_DAYS * 86400000
  const out: HarnessInsightDraft[] = []
  const seen = new Set<string>()

  for (const link of links) {
    const name = nameById.get(link.personId)
    if (!name) continue
    const personCommitments = commitmentsByPerson.get(link.personId) ?? []
    if (personCommitments.length === 0) continue

    const key = `${link.meetingId}:${link.personId}`
    if (seen.has(key)) continue
    seen.add(key)

    const [latest] = await db
      .select({ ts: whatsappDmMessages.ts })
      .from(whatsappDmMessages)
      .where(eq(whatsappDmMessages.personId, link.personId))
      .orderBy(desc(whatsappDmMessages.ts))
      .limit(1)
    if (latest && latest.ts >= silenceCutoffMs) continue

    const meeting = upcoming.find((m) => m.id === link.meetingId)
    if (!meeting) continue
    const silentDays = latest ? Math.round((Date.now() - latest.ts) / 86400000) : null
    const owed = personCommitments.filter((c) => c.owner === 'me').length

    out.push({
      kind: 'silent_before_meeting',
      title: `${name} — פגישה ב-${shortDate(meeting.date)} אחרי שתיקה`,
      body: [
        silentDays ? `אין התכתבות ${silentDays} ימים` : 'אין התכתבות מתועדת כלל',
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

/** Relationship trending cold while something is still owed between you. */
async function detectCoolingWithOpenLoop(ctx: DetectorContext): Promise<HarnessInsightDraft[]> {
  const { db } = ctx
  const openCommitments = await db
    .select({ id: commitments.id, personId: commitments.personId, content: commitments.content, owner: commitments.owner })
    .from(commitments)
    .where(inArray(commitments.status, ['accepted']))
  const personIds = [...new Set(openCommitments.map((c) => c.personId).filter((id): id is string => !!id))]
  if (personIds.length === 0) return []

  const peopleRows = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(and(inArray(people.id, personIds), eq(people.status, 'confirmed')))

  const out: HarnessInsightDraft[] = []
  for (const p of peopleRows) {
    const warmth = await personWarmth(db, p.id)
    if (warmth.trend !== 'cooling') continue
    const theirs = openCommitments.filter((c) => c.personId === p.id)
    out.push({
      kind: 'cooling_with_open_loop',
      title: `הקשר עם ${p.name} מתקרר ויש לולאה פתוחה`,
      body: `${theirs.length} התחייבויות פתוחות · מגמת הסיכומים האחרונים שלילית${
        warmth.recentAvg != null ? ` (${warmth.recentAvg})` : ''
      }`,
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

  return rows.map((r) => {
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
  const personIds = [...new Set(links.map((l) => l.personId))]
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

  const single = threads.filter((t) => (t.messageCount ?? 1) <= 1)
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

const DETECTORS = [
  detectSilentBeforeMeeting,
  detectCoolingWithOpenLoop,
  detectStaleCommitments,
  detectSpendSpike,
  detectUnansweredThread,
]

/** Runs every detector. One failing detector must not take the whole run down. */
export async function runDetectors(db: Db, now = new Date()): Promise<HarnessInsightDraft[]> {
  const today = isoDate(now)
  const ctx: DetectorContext = { db, today, horizon: addDays(today, LOOKAHEAD_DAYS) }

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
  return results.flat().sort((a, b) => b.score - a.score).slice(0, MAX_INSIGHTS)
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

/** Detect, phrase, persist, and retire stale insights. */
export async function reasonAndPersist(db: Db, now = new Date()): Promise<ReasonResult> {
  const drafts = await runDetectors(db, now)
  const { insights, model } = await phraseInsights(drafts)
  const { created, updated } = await persistInsights(db, insights, now)
  await retireStaleInsights(db, insights.map((i) => i.dedupeKey), now)
  return { insights, created, updated, model }
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

/** Hebrew lines for the morning brief. */
export function formatInsightLines(insights: StoredInsight[]): string[] {
  return insights.map((i) => `${i.severity === 'urgent' ? '❗' : '•'} ${i.title} — ${i.body}`)
}
