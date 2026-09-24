/**
 * WhatsApp 1:1 capture for allowlisted people: which JIDs the bridge may forward, what the ingest
 * stores, nightly summaries with proposed commitments, and DM retention.
 */
import { and, asc, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm'
import {
  commitments,
  meetingPeople,
  meetings,
  people,
  whatsappDmMessages,
  whatsappDmSummaries,
  whatsappPersonLinks,
  type CommitmentOwner,
  type CommitmentSource,
  type getDb,
} from '@ak-system/database'
import { normalizePhone } from '../lib/phone'
import { bridgeFetch, isBridgeConfigured } from './whatsapp-bridge-client'
import { getModel } from './whatsapp-insights'

type Db = ReturnType<typeof getDb>

export const DM_EXPIRED_TEXT = '[expired]'
const DAY_MS = 86_400_000
const MEETING_LINK_DAYS = 3
const SUMMARY_WINDOW_DAYS = 7

function bareJid(jid: string): string {
  const [user, domain] = jid.split('@')
  return `${(user ?? '').split(':')[0]}@${domain ?? ''}`
}

function phoneJid(phone: string | null): string | null {
  const digits = normalizePhone(phone)
  return digits ? `${digits}@s.whatsapp.net` : null
}

/** JIDs for one person: their phone plus manual sender links. */
export async function dmJidsForPerson(db: Db, personId: string, phone: string | null): Promise<string[]> {
  const links = await db
    .select({ jid: whatsappPersonLinks.whatsappJid })
    .from(whatsappPersonLinks)
    .where(and(eq(whatsappPersonLinks.personId, personId), eq(whatsappPersonLinks.matchedBy, 'manual')))
  const out = new Set(links.map((l) => bareJid(l.jid)))
  const fromPhone = phoneJid(phone)
  if (fromPhone) out.add(fromPhone)
  return [...out]
}

/** Every JID the bridge may forward, with the person it belongs to. */
export async function dmAllowlist(db: Db): Promise<Map<string, string>> {
  const rows = await db.select({ id: people.id, phone: people.phone }).from(people).where(eq(people.captureWhatsapp, true))
  const map = new Map<string, string>()
  for (const p of rows) {
    for (const jid of await dmJidsForPerson(db, p.id, p.phone)) map.set(jid, p.id)
  }
  return map
}

/** Sends the allowlist to the bridge. Best-effort: a missing or offline bridge never blocks a save. */
export async function pushDmAllowlist(db: Db): Promise<{ pushed: boolean; count: number; error?: string }> {
  const jids = [...(await dmAllowlist(db)).keys()]
  if (!isBridgeConfigured()) return { pushed: false, count: jids.length }
  try {
    const { ok, data } = await bridgeFetch<{ error?: string }>('/config/dm', { method: 'POST', body: JSON.stringify({ jids }) })
    return ok ? { pushed: true, count: jids.length } : { pushed: false, count: jids.length, error: data.error ?? 'Bridge rejected DM config' }
  } catch (err) {
    return { pushed: false, count: jids.length, error: err instanceof Error ? err.message : 'Bridge unreachable' }
  }
}

export interface DmIngestMessage {
  id: string
  /** Chat JID as the bridge saw it (phone JID after LID resolution when possible) */
  jid: string
  /** The other form of the same chat (`@lid` when `jid` is the phone JID) */
  altJid?: string | null
  fromMe: boolean
  text: string
  timestamp: number
}

async function nearestMeetingId(db: Db, personId: string, ts: number): Promise<string | null> {
  const from = new Date(ts - MEETING_LINK_DAYS * DAY_MS).toISOString().slice(0, 10)
  const to = new Date(ts + MEETING_LINK_DAYS * DAY_MS).toISOString().slice(0, 10)
  const rows = await db
    .select({ id: meetings.id, date: meetings.date })
    .from(meetingPeople)
    .innerJoin(meetings, eq(meetings.id, meetingPeople.meetingId))
    .where(and(eq(meetingPeople.personId, personId), sql`${meetings.date} >= ${from}`, sql`${meetings.date} <= ${to}`))
  if (rows.length === 0) return null
  const distance = (d: string) => Math.abs(new Date(`${d}T12:00:00Z`).getTime() - ts)
  return rows.sort((a, b) => distance(a.date) - distance(b.date))[0].id
}

/**
 * Stores bridge messages for people with capture on. Anything for a person with capture off, or
 * older than the moment capture was switched on, is dropped here even if the bridge sent it.
 */
export async function ingestDmMessages(db: Db, messages: DmIngestMessage[]): Promise<{ stored: number; skipped: number }> {
  const allow = await dmAllowlist(db)
  if (allow.size === 0) return { stored: 0, skipped: messages.length }
  const personIds = [...new Set(allow.values())]
  const sinceRows = await db
    .select({ id: people.id, since: people.captureWhatsappSince })
    .from(people)
    .where(inArray(people.id, personIds))
  const sinceByPerson = new Map(sinceRows.map((r) => [r.id, r.since ? new Date(r.since).getTime() : 0]))

  let stored = 0
  let skipped = 0
  const now = new Date().toISOString()
  for (const m of messages) {
    const text = typeof m.text === 'string' ? m.text.trim() : ''
    const jid = m.jid ? bareJid(m.jid) : ''
    const alt = m.altJid ? bareJid(m.altJid) : ''
    const personId = allow.get(jid) ?? (alt ? allow.get(alt) : undefined)
    const ts = Number(m.timestamp) < 1e12 ? Number(m.timestamp) * 1000 : Number(m.timestamp)
    if (!m.id || !text || !personId || !Number.isFinite(ts) || ts < (sinceByPerson.get(personId) ?? 0)) {
      skipped++
      continue
    }
    const storedJid = allow.has(jid) ? jid : alt
    const [dupe] = await db
      .select({ id: whatsappDmMessages.id })
      .from(whatsappDmMessages)
      .where(and(eq(whatsappDmMessages.waMessageId, String(m.id)), eq(whatsappDmMessages.whatsappJid, storedJid)))
    if (dupe) {
      skipped++
      continue
    }
    await db.insert(whatsappDmMessages).values({
      id: `wdm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      personId,
      whatsappJid: storedJid,
      waMessageId: String(m.id),
      fromMe: !!m.fromMe,
      text,
      ts,
      meetingId: await nearestMeetingId(db, personId, ts),
      pinned: false,
      createdAt: now,
    })
    stored++
  }
  return { stored, skipped }
}

/** Turns capture on or off. Switching on stamps `captureWhatsappSince` so nothing earlier is stored. */
export async function setCaptureWhatsapp(db: Db, personId: string, enabled: boolean) {
  const [current] = await db
    .select({ capture: people.captureWhatsapp, since: people.captureWhatsappSince })
    .from(people)
    .where(eq(people.id, personId))
  if (!current) return null
  if (!!current.capture === enabled) return current
  const since = enabled ? new Date().toISOString() : null
  await db.update(people).set({ captureWhatsapp: enabled, captureWhatsappSince: since }).where(eq(people.id, personId))
  return { capture: enabled, since }
}

// ─── Commitment detection ───────────────────────────────────────────────────

export interface DmPromptMessage {
  id: string
  fromMe: boolean
  text: string
  ts: number
}

export interface ProposedCommitment {
  owner: CommitmentOwner
  content: string
  dueInferred: string | null
  sourceMessageId: string | null
}

export interface DmChatDigest {
  summary: string | null
  commitments: ProposedCommitment[]
}

const HE = '\\u0590-\\u05FF'
/** First person future: the speaker takes something on. */
const SELF_PROMISE = new RegExp(`(?:^|[^${HE}])[וש]?(אשלח|אבדוק|אטפל|אחזור|אעביר|אכין|אתקשר|אדבר|אסדר|אעדכן|אארגן|אזמין)(?=$|[^${HE}])`)
/** Imperative / second person future: the speaker asks the other side. */
const REQUEST = new RegExp(`(?:^|[^${HE}])[וש]?(תשלח|תשלחי|תבדוק|תבדקי|תעביר|תעבירי|תטפל|תטפלי|תחזור|תחזרי|תעדכן|תעדכני|תכין|תכיני|תתקשר|תתקשרי)(?=$|[^${HE}])`)
/** English equivalents, for email. */
const SELF_PROMISE_EN = /\bI(?:'ll| will) (?:send|check|get back|follow up|share|prepare|call|update|review)\b/i
const REQUEST_EN = /\b(?:can|could) you (?:please )?(?:send|check|share|review|prepare|update|call)\b|\bplease (?:send|check|share|review|prepare|update)\b/i

const WEEKDAYS: [RegExp, number][] = [
  [/ביום ראשון|ביום א['׳]/, 0],
  [/ביום שני|ביום ב['׳]/, 1],
  [/ביום שלישי|ביום ג['׳]/, 2],
  [/ביום רביעי|ביום ד['׳]/, 3],
  [/ביום חמישי|ביום ה['׳]/, 4],
  [/ביום שישי|ביום ו['׳]/, 5],
]

export function inferDueDate(text: string, ts: number): string | null {
  const base = new Date(ts)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const plus = (n: number) => iso(new Date(base.getTime() + n * DAY_MS))
  if (/מחרתיים/.test(text)) return plus(2)
  if (/מחר/.test(text)) return plus(1)
  if (/היום|עוד מעט|בערב/.test(text)) return plus(0)
  for (const [re, day] of WEEKDAYS) {
    if (re.test(text)) return plus(((day - base.getUTCDay() + 7) % 7) || 7)
  }
  return null
}

function clip(text: string, max = 140): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** Hebrew-verb heuristic: a self-promise belongs to the speaker, a request to the other side. */
export function detectCommitmentsHeuristic(messages: DmPromptMessage[]): ProposedCommitment[] {
  const out: ProposedCommitment[] = []
  for (const m of messages) {
    const promise = SELF_PROMISE.test(m.text) || SELF_PROMISE_EN.test(m.text)
    const request = !promise && (REQUEST.test(m.text) || REQUEST_EN.test(m.text))
    if (!promise && !request) continue
    const speakerIsMe = m.fromMe
    const owner: CommitmentOwner = promise === speakerIsMe ? 'me' : 'them'
    out.push({ owner, content: clip(m.text), dueInferred: inferDueDate(m.text, m.ts), sourceMessageId: m.id })
  }
  return out
}

function asText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** Gemini summary + commitments for one chat. Throws when no key is set so callers can fall back. */
export async function generateDmDigest(personName: string, messages: DmPromptMessage[]): Promise<DmChatDigest> {
  const model = getModel()
  const lines = messages
    .slice(-80)
    .map((m) => `[${m.id}] ${new Date(m.ts).toISOString().slice(0, 16).replace('T', ' ')} ${m.fromMe ? 'אני' : personName}: ${m.text}`)
    .join('\n')
  const prompt = [
    `Summarize the user's private WhatsApp chat with ${personName}.`,
    'Write Hebrew (unless the chat is mostly English). 2-4 plain sentences: what was discussed and where it stands.',
    'Then list commitments: something one side said they would do, or was asked to do and agreed to.',
    'owner is "me" when the user must act, "them" when ' + personName + ' must act.',
    'due is an ISO date only when the chat names a day; otherwise null. messageId is the id in brackets.',
    'Do not invent. If nothing was promised, return an empty list.',
    'Respond in JSON only, no markdown fences:',
    '{"summary":"...","commitments":[{"owner":"me|them","content":"<short Hebrew task>","due":null,"messageId":"..."}]}',
    '',
    lines,
  ].join('\n')
  const result = await model.generateContent(prompt)
  const raw = result.response.text().trim().replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()
  let parsed: { summary?: unknown; commitments?: { owner?: unknown; content?: unknown; due?: unknown; messageId?: unknown }[] }
  try {
    parsed = JSON.parse(raw) as typeof parsed
  } catch {
    throw new Error('DM digest JSON parse failed')
  }
  const ids = new Set(messages.map((m) => m.id))
  return {
    summary: asText(parsed.summary) || null,
    commitments: (parsed.commitments ?? [])
      .map((c) => ({
        owner: (c?.owner === 'them' ? 'them' : 'me') as CommitmentOwner,
        content: clip(asText(c?.content)),
        dueInferred: /^\d{4}-\d{2}-\d{2}$/.test(asText(c?.due)) ? asText(c?.due) : null,
        sourceMessageId: ids.has(asText(c?.messageId)) ? asText(c?.messageId) : null,
      }))
      .filter((c) => c.content),
  }
}

export type DmDigestGenerator = (personName: string, messages: DmPromptMessage[]) => Promise<DmChatDigest>

async function defaultGenerator(personName: string, messages: DmPromptMessage[]): Promise<DmChatDigest> {
  if (!process.env.GEMINI_API_KEY) return { summary: null, commitments: detectCommitmentsHeuristic(messages) }
  try {
    return await generateDmDigest(personName, messages)
  } catch (err) {
    console.warn('[whatsapp-dm] digest model failed, using heuristic', err instanceof Error ? err.message : err)
    return { summary: null, commitments: detectCommitmentsHeuristic(messages) }
  }
}

export interface DmSummaryRunResult {
  people: number
  summaries: number
  commitments: number
}

/**
 * Summarizes each person's new DM messages since their last summary (at most 7 days back) and
 * proposes commitments. Re-running without new messages does nothing.
 */
export async function summarizeDmChats(
  db: Db,
  options: { generate?: DmDigestGenerator; now?: number } = {},
): Promise<DmSummaryRunResult> {
  const now = options.now ?? Date.now()
  const generate = options.generate ?? defaultGenerator
  const windowStart = now - SUMMARY_WINDOW_DAYS * DAY_MS
  const active = await db
    .select({ personId: whatsappDmMessages.personId })
    .from(whatsappDmMessages)
    .where(gt(whatsappDmMessages.ts, windowStart))
    .groupBy(whatsappDmMessages.personId)

  const result: DmSummaryRunResult = { people: 0, summaries: 0, commitments: 0 }
  for (const { personId } of active) {
    const [person] = await db.select({ name: people.name }).from(people).where(eq(people.id, personId))
    if (!person) continue
    const [last] = await db
      .select({ toTs: whatsappDmSummaries.toTs })
      .from(whatsappDmSummaries)
      .where(eq(whatsappDmSummaries.personId, personId))
      .orderBy(desc(whatsappDmSummaries.toTs))
      .limit(1)
    const from = Math.max(windowStart, last?.toTs ?? 0)
    const rows = await db
      .select({ id: whatsappDmMessages.id, fromMe: whatsappDmMessages.fromMe, text: whatsappDmMessages.text, ts: whatsappDmMessages.ts })
      .from(whatsappDmMessages)
      .where(and(eq(whatsappDmMessages.personId, personId), gt(whatsappDmMessages.ts, from), sql`${whatsappDmMessages.text} != ${DM_EXPIRED_TEXT}`))
      .orderBy(asc(whatsappDmMessages.ts))
    if (rows.length === 0) continue
    result.people++
    const messages = rows.map((r) => ({ id: r.id, fromMe: !!r.fromMe, text: r.text, ts: r.ts }))
    const digest = await generate(person.name, messages)
    const createdAt = new Date(now).toISOString()
    const toTs = messages[messages.length - 1].ts
    await db.insert(whatsappDmSummaries).values({
      id: `wds_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      personId,
      summary: digest.summary ?? '',
      fromTs: messages[0].ts,
      toTs,
      messageCount: messages.length,
      createdAt,
    })
    if (digest.summary) result.summaries++
    const textById = new Map(messages.map((m) => [m.id, m.text]))
    result.commitments += await proposeCommitments(db, personId, 'whatsapp_dm', digest.commitments.map((c) => ({
      ...c,
      sourceSnippet: c.sourceMessageId ? clip(textById.get(c.sourceMessageId) ?? '', 80) : null,
    })), createdAt)
  }
  return result
}

/** Inserts proposed commitments, skipping any the person already has with the same text. */
export async function proposeCommitments(
  db: Db,
  personId: string,
  source: CommitmentSource,
  items: (ProposedCommitment & { sourceSnippet: string | null })[],
  createdAt = new Date().toISOString(),
): Promise<number> {
  if (items.length === 0) return 0
  const existing = new Set(
    (await db.select({ content: commitments.content }).from(commitments).where(eq(commitments.personId, personId))).map((c) => c.content),
  )
  let added = 0
  for (const item of items) {
    if (existing.has(item.content)) continue
    existing.add(item.content)
    await db.insert(commitments).values({
      id: `cm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      personId,
      owner: item.owner,
      content: item.content,
      dueInferred: item.dueInferred,
      source,
      sourceId: item.sourceMessageId,
      sourceSnippet: item.sourceSnippet,
      status: 'proposed',
      taskId: null,
      createdAt,
      updatedAt: createdAt,
    })
    added++
  }
  return added
}

/** Clears DM text older than the retention window; pinned messages keep their text. */
export async function runDmRetention(db: Db, retentionDays: number, now = Date.now()): Promise<number> {
  const cutoff = now - retentionDays * DAY_MS
  const where = and(
    lt(whatsappDmMessages.ts, cutoff),
    eq(whatsappDmMessages.pinned, false),
    sql`${whatsappDmMessages.text} != ${DM_EXPIRED_TEXT}`,
  )
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(whatsappDmMessages).where(where)
  await db.update(whatsappDmMessages).set({ text: DM_EXPIRED_TEXT }).where(where)
  return Number(count)
}

