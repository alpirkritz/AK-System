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
  userSettings,
  whatsappDmMessages,
  whatsappDmSummaries,
  whatsappGroups,
  whatsappMessages,
  whatsappPersonLinks,
  type CommitmentOwner,
  type CommitmentSource,
  type getDb,
} from '@ak-system/database'
import { normalizePhone, phoneFromWhatsappJid } from '../lib/phone'
import { bridgeFetch, getBridgeStatus, isBridgeConfigured } from './whatsapp-bridge-client'
import { getModel } from './whatsapp-insights'
import { ensureSelfPerson } from './self-person'

type Db = ReturnType<typeof getDb>

export const DM_EXPIRED_TEXT = '[expired]'
const DAY_MS = 86_400_000
const MEETING_LINK_DAYS = 3
const SUMMARY_WINDOW_DAYS = 7
const GROUP_COMMITMENT_SETTINGS_ID = 'default'

export function bareJid(jid: string): string {
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

/** `{ label, content }` for one proposed commitment, for building notification text (label = chat/person name). */
export interface ProposedCommitmentLabel {
  label: string
  content: string
}

export interface DmChatDigest {
  summary: string | null
  commitments: ProposedCommitment[]
}

const HE = '\\u0590-\\u05FF'
/** First person future: the speaker takes something on. */
const SELF_PROMISE = new RegExp(
  `(?:^|[^${HE}])[וש]?(` +
  `אשלח|אבדוק|אטפל|אחזור|אעביר|אכין|אתקשר|אדבר|אסדר|אעדכן|אארגן|אזמין|` +
  `אקנה|אביא|אנסה|אסיים|אבצע|אוסיף|אכנס|ארשום|אשריין|אמלא|אעשה|אדאג|אלמד|` +
  `אכתוב|אשלים|אפתור|אענה|אפנה|אתחיל|אסכם|אקבע|אבחן|אחליט|אשנה|אתאם|אקרא` +
  `)(?=$|[^${HE}])`,
)
/** Present tense of the same verbs ("מזמין", "שולחת"). Not when another person is the subject. */
const PRESENT_PROMISE = new RegExp(
  `(?:^|[^${HE}])(?<!(?:הוא|היא|אתה|אתם|אתן|הם|הן|את)\\s)[וש]?(` +
  `מזמין|מזמינה|שולח|שולחת|בודק|בודקת|מטפל|מטפלת|חוזר|חוזרת|מעביר|מעבירה|מכין|מכינה|` +
  `מתקשר|מתקשרת|מדבר|מדברת|מסדר|מסדרת|מעדכן|מעדכנת|מארגן|מארגנת|` +
  `קונה|קונה|מביא|מביאה|מנסה|מסיים|מסיימת|מבצע|מבצעת|מוסיף|מוסיפה|` +
  `כותב|כותבת|עונה|פונה|מתחיל|מתחילה|מסכם|מסכמת|קובע|קובעת|מחליט|מחליטה|` +
  `משנה|מתאם|מתאמת|קורא|קוראת|דואג|דואגת|לומד|לומדת` +
  `)(?=$|[^${HE}])`,
)
/** First person plural future: "נטפל", "נזמין". */
const PLURAL_PROMISE = new RegExp(
  `(?:^|[^${HE}])[וש]?(` +
  `נשלח|נבדוק|נטפל|נחזור|נעביר|נכין|נתקשר|נדבר|נסדר|נעדכן|נארגן|נזמין|` +
  `נקנה|נביא|ננסה|נסיים|נבצע|נוסיף|נכתוב|נענה|נפנה|נתחיל|נסכם|נקבע|נחליט|נשנה|נתאם|נקרא|נדאג` +
  `)(?=$|[^${HE}])`,
)
/** Imperative / second person future: the speaker asks the other side. */
const REQUEST = new RegExp(
  `(?:^|[^${HE}])[וש]?(` +
  `תשלח|תשלחי|תבדוק|תבדקי|תעביר|תעבירי|תטפל|תטפלי|תחזור|תחזרי|תעדכן|תעדכני|תכין|תכיני|תתקשר|תתקשרי|` +
  `תקנה|תקני|תביא|תביאי|תנסה|תנסי|תסיים|תסיימי|תבצע|תבצעי|תוסיף|תוסיפי|` +
  `תכתוב|תכתבי|תענה|תעני|תפנה|תפני|תתחיל|תתחילי|תסכם|תסכמי|תקבע|תקבעי|תחליט|תחליטי` +
  `)(?=$|[^${HE}])`
)
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

/** `'promise'` when the speaker commits, `'request'` when they ask the other side, else `null`. */
function classifyPromise(text: string): 'promise' | 'request' | null {
  const promise = SELF_PROMISE.test(text) || PRESENT_PROMISE.test(text) || PLURAL_PROMISE.test(text) || SELF_PROMISE_EN.test(text)
  if (promise) return 'promise'
  const request = REQUEST.test(text) || REQUEST_EN.test(text)
  return request ? 'request' : null
}

/** Hebrew-verb heuristic: a self-promise belongs to the speaker, a request to the other side. */
export function detectCommitmentsHeuristic(messages: DmPromptMessage[]): ProposedCommitment[] {
  const out: ProposedCommitment[] = []
  for (const m of messages) {
    const kind = classifyPromise(m.text)
    if (!kind) continue
    const owner: CommitmentOwner = (kind === 'promise') === m.fromMe ? 'me' : 'them'
    out.push({ owner, content: clip(m.text), dueInferred: inferDueDate(m.text, m.ts), sourceMessageId: m.id })
  }
  return out
}

function asText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** One message's classification, from either the model or the regex fallback. */
export interface ModelClassification {
  messageId: string
  kind: 'promise' | 'request'
  content: string
  due: string | null
}

/** Regex fallback in the model's own output shape, so both paths feed the same downstream mapping. */
function heuristicClassifications(messages: { id: string; text: string; ts: number }[]): ModelClassification[] {
  const out: ModelClassification[] = []
  for (const m of messages) {
    const kind = classifyPromise(m.text)
    if (!kind) continue
    out.push({ messageId: m.id, kind, content: clip(m.text), due: inferDueDate(m.text, m.ts) })
  }
  return out
}

/**
 * Classifies a batch of messages (one DM chat, or one group) as promises/requests using the same
 * Gemini model as the nightly digest. `speakerLabel` is "אני" for the owner, else the other
 * person's/sender's display name — used only for prompt context, never trusted for identity.
 * Throws when no key is set or the call fails, so callers fall back to `heuristicClassifications`.
 */
async function classifyMessagesWithModel(
  messages: { id: string; speakerLabel: string; text: string; ts: number }[],
): Promise<ModelClassification[]> {
  const model = getModel()
  const lines = messages
    .slice(-200)
    .map((m) => `[${m.id}] ${new Date(m.ts).toISOString().slice(0, 16).replace('T', ' ')} ${m.speakerLabel}: ${m.text}`)
    .join('\n')
  const prompt = [
    'Read this WhatsApp conversation (Hebrew, unless mostly English).',
    'For each message that is a promise (the speaker commits to do something) or a request (the speaker asks someone else to do something), output one entry.',
    'kind is "promise" or "request". content is a short Hebrew description of the task, not a verbatim quote.',
    'due is an ISO date only when the message names a day; otherwise null. messageId is the exact id shown in brackets — copy it verbatim without the brackets.',
    'Do not invent messages or tasks that are not there. Skip small talk, questions, and acknowledgements that ask for nothing.',
    'Respond in JSON only, no markdown fences:',
    '{"items":[{"messageId":"...","kind":"promise|request","content":"...","due":null}]}',
    '',
    lines,
  ].join('\n')
  const result = await model.generateContent(prompt)
  const raw = result.response.text().trim().replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()
  let parsed: { items?: { messageId?: unknown; kind?: unknown; content?: unknown; due?: unknown }[] }
  try {
    parsed = JSON.parse(raw) as typeof parsed
  } catch {
    throw new Error('Commitment classification JSON parse failed')
  }
  const ids = new Set(messages.map((m) => m.id))
  return (parsed.items ?? [])
    .map((it) => ({
      // Strip optional surrounding brackets the LLM may include (e.g. "[3EB0C7...]" → "3EB0C7...")
      messageId: asText(it?.messageId).replace(/^\[|\]$/g, '').trim(),
      kind: it?.kind === 'request' ? ('request' as const) : it?.kind === 'promise' ? ('promise' as const) : null,
      content: clip(asText(it?.content)),
      due: /^\d{4}-\d{2}-\d{2}$/.test(asText(it?.due)) ? asText(it?.due) : null,
    }))
    .filter((it): it is ModelClassification => it.kind !== null && !!it.content && ids.has(it.messageId))
}

export type MessageClassifier = (
  messages: { id: string; speakerLabel: string; text: string; ts: number }[],
) => Promise<ModelClassification[]>

/**
 * Real classifier used in production: Gemini when `GEMINI_API_KEY` is set, otherwise (or on any
 * failure) the Hebrew-verb regex. Exposed as a function so tests can inject a stand-in instead of
 * mocking the Gemini SDK — same DI shape as `summarizeDmChats`'s `generate` option.
 */
export const defaultClassify: MessageClassifier = async (messages) => {
  if (!process.env.GEMINI_API_KEY) return heuristicClassifications(messages)
  try {
    return await classifyMessagesWithModel(messages)
  } catch (err) {
    console.warn('[whatsapp-dm] model classification failed, using heuristic', err instanceof Error ? err.message : err)
    return heuristicClassifications(messages)
  }
}

/** Classifies one DM chat's new messages via `classify` (Gemini-or-heuristic by default). */
async function classifyDmMessages(
  messages: DmPromptMessage[],
  personName: string,
  classify: MessageClassifier,
): Promise<ProposedCommitment[]> {
  const classifications = await classify(
    messages.map((m) => ({ id: m.id, speakerLabel: m.fromMe ? 'אני' : personName, text: m.text, ts: m.ts })),
  )
  const byId = new Map(messages.map((m) => [m.id, m]))
  const out: ProposedCommitment[] = []
  for (const cls of classifications) {
    const src = byId.get(cls.messageId)
    if (!src) continue
    const owner: CommitmentOwner = (cls.kind === 'promise') === src.fromMe ? 'me' : 'them'
    out.push({ owner, content: cls.content, dueInferred: cls.due ?? inferDueDate(src.text, src.ts), sourceMessageId: cls.messageId })
  }
  return out
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
  proposed: ProposedCommitmentLabel[]
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

  const result: DmSummaryRunResult = { people: 0, summaries: 0, commitments: 0, proposed: [] }
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
    const added = await proposeCommitments(db, personId, 'whatsapp_dm', digest.commitments.map((c) => ({
      ...c,
      sourceSnippet: c.sourceMessageId ? clip(textById.get(c.sourceMessageId) ?? '', 80) : null,
    })), createdAt)
    result.commitments += added.length
    for (const item of added) result.proposed.push({ label: person.name, content: item.content })
  }
  return result
}

export interface DmCommitmentScanResult {
  people: number
  commitments: number
  proposed: ProposedCommitmentLabel[]
}

/**
 * Proposes commitments from new 1:1 messages, classified by Gemini (falling back to the
 * Hebrew-verb regex when no API key is set or the call fails). Does not write a summary row, so
 * the nightly digest still sees the same window. Re-running skips messages already proposed.
 */
export async function scanDmCommitments(
  db: Db,
  now = Date.now(),
  options: { classify?: MessageClassifier } = {},
): Promise<DmCommitmentScanResult> {
  const classify = options.classify ?? defaultClassify
  const windowStart = now - SUMMARY_WINDOW_DAYS * DAY_MS
  const active = await db
    .select({ personId: whatsappDmMessages.personId })
    .from(whatsappDmMessages)
    .where(gt(whatsappDmMessages.ts, windowStart))
    .groupBy(whatsappDmMessages.personId)

  const result: DmCommitmentScanResult = { people: 0, commitments: 0, proposed: [] }
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
    const found = await classifyDmMessages(messages, person.name, classify)
    const textById = new Map(messages.map((m) => [m.id, m.text]))
    const added = await proposeCommitments(db, personId, 'whatsapp_dm', found.map((c) => ({
      ...c,
      sourceSnippet: c.sourceMessageId ? clip(textById.get(c.sourceMessageId) ?? '', 80) : null,
    })))
    result.commitments += added.length
    for (const item of added) result.proposed.push({ label: person.name, content: item.content })
  }
  return result
}

/**
 * Inserts proposed commitments, skipping any the person already has with the same text (or, for
 * whatsapp_dm/whatsapp_group, the same source message already proposed for that person). Returns
 * the items actually inserted.
 */
export async function proposeCommitments(
  db: Db,
  personId: string,
  source: CommitmentSource,
  items: (ProposedCommitment & { sourceSnippet: string | null })[],
  createdAt = new Date().toISOString(),
): Promise<ProposedCommitment[]> {
  if (items.length === 0) return []
  const existingRows = await db
    .select({ content: commitments.content, source: commitments.source, sourceId: commitments.sourceId })
    .from(commitments)
    .where(eq(commitments.personId, personId))
  const existing = new Set(existingRows.map((c) => c.content))
  const dedupeBySourceId = source === 'whatsapp_dm' || source === 'whatsapp_group'
  const existingSourceIds = dedupeBySourceId
    ? new Set(existingRows.filter((c) => c.source === source && c.sourceId).map((c) => c.sourceId as string))
    : null
  const added: ProposedCommitment[] = []
  for (const item of items) {
    if (existing.has(item.content)) continue
    if (existingSourceIds && item.sourceMessageId && existingSourceIds.has(item.sourceMessageId)) continue
    existing.add(item.content)
    if (existingSourceIds && item.sourceMessageId) existingSourceIds.add(item.sourceMessageId)
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
    added.push(item)
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

// ─── Group commitment scan ──────────────────────────────────────────────────

async function getGroupCommitmentCursor(db: Db): Promise<number> {
  const [row] = await db
    .select({ cursor: userSettings.whatsappGroupCommitmentScanCursor })
    .from(userSettings)
    .where(eq(userSettings.id, GROUP_COMMITMENT_SETTINGS_ID))
    .limit(1)
  const parsed = row?.cursor ? Number(row.cursor) : 0
  return Number.isFinite(parsed) ? parsed : 0
}

async function setGroupCommitmentCursor(db: Db, ts: number, selfJid?: string | null): Promise<void> {
  const now = new Date().toISOString()
  const [existing] = await db
    .select({ id: userSettings.id })
    .from(userSettings)
    .where(eq(userSettings.id, GROUP_COMMITMENT_SETTINGS_ID))
    .limit(1)
  if (existing) {
    if (selfJid) {
      await db
        .update(userSettings)
        .set({ whatsappGroupCommitmentScanCursor: String(ts), whatsappSelfJid: selfJid, updatedAt: now })
        .where(eq(userSettings.id, GROUP_COMMITMENT_SETTINGS_ID))
    } else {
      await db
        .update(userSettings)
        .set({ whatsappGroupCommitmentScanCursor: String(ts), updatedAt: now })
        .where(eq(userSettings.id, GROUP_COMMITMENT_SETTINGS_ID))
    }
  } else {
    await db.insert(userSettings).values({
      id: GROUP_COMMITMENT_SETTINGS_ID,
      whatsappGroupCommitmentScanCursor: String(ts),
      whatsappSelfJid: selfJid ?? null,
      updatedAt: now,
    })
  }
}

async function getCachedSelfJid(db: Db): Promise<string | null> {
  const [row] = await db
    .select({ jid: userSettings.whatsappSelfJid })
    .from(userSettings)
    .where(eq(userSettings.id, GROUP_COMMITMENT_SETTINGS_ID))
    .limit(1)
  return row?.jid ?? null
}

/** A `people` row whose phone matches the digits behind a WhatsApp JID (any person, not just capture-enabled). */
async function findPersonByPhone(db: Db, phoneDigits: string): Promise<string | null> {
  const rows = await db.select({ id: people.id, phone: people.phone }).from(people)
  for (const p of rows) {
    if (p.phone && normalizePhone(p.phone) === phoneDigits) return p.id
  }
  return null
}

/** A manually-linked JID (the same mechanism DM capture uses for @lid chats). */
async function findPersonByManualLink(db: Db, jid: string): Promise<string | null> {
  const [row] = await db
    .select({ personId: whatsappPersonLinks.personId })
    .from(whatsappPersonLinks)
    .where(eq(whatsappPersonLinks.whatsappJid, jid))
    .limit(1)
  return row?.personId ?? null
}

/**
 * Resolves a group message's sender JID to a `people` row: the owner's own person when the JID is
 * the bridge's own JID, otherwise a phone or manual-link match. Returns null (skip) when neither
 * resolves — no commitment is guessed for an unidentified sender.
 */
export async function resolveGroupSenderPersonId(db: Db, senderJid: string, selfJid: string | null): Promise<string | null> {
  const bare = bareJid(senderJid)
  if (selfJid && bare === bareJid(selfJid)) {
    return (await ensureSelfPerson(db)).id
  }
  const phone = phoneFromWhatsappJid(bare)
  if (phone) {
    const byPhone = await findPersonByPhone(db, phone)
    if (byPhone) return byPhone
  }
  return findPersonByManualLink(db, bare)
}

export interface GroupCommitmentScanResult {
  groups: number
  commitments: number
  proposed: ProposedCommitmentLabel[]
}

/**
 * Proposes commitments from new messages in enabled WhatsApp groups, one Gemini classification
 * call per group with new messages (falling back to the Hebrew-verb regex when no API key is set
 * or the call fails), same as the 1:1 scan. A message only becomes a commitment when its sender
 * resolves to a known person (self or a linked contact) — unidentified senders are skipped.
 * Advances a stored cursor so re-running only looks at messages newer than the last processed one.
 */
export async function scanGroupCommitments(
  db: Db,
  options: { classify?: MessageClassifier } = {},
): Promise<GroupCommitmentScanResult> {
  const classify = options.classify ?? defaultClassify
  const result: GroupCommitmentScanResult = { groups: 0, commitments: 0, proposed: [] }

  const groupRows = await db
    .select({ jid: whatsappGroups.jid, name: whatsappGroups.name, enabled: whatsappGroups.enabled })
    .from(whatsappGroups)
  const enabledGroups = groupRows.filter((g) => !!g.enabled)
  if (enabledGroups.length === 0) return result
  const jids = enabledGroups.map((g) => g.jid)
  const nameByJid = new Map(enabledGroups.map((g) => [g.jid, g.name]))

  const cursor = await getGroupCommitmentCursor(db)
  const rows = await db
    .select({
      groupJid: whatsappMessages.groupJid,
      waMessageId: whatsappMessages.waMessageId,
      sender: whatsappMessages.sender,
      senderName: whatsappMessages.senderName,
      text: whatsappMessages.text,
      ts: whatsappMessages.ts,
    })
    .from(whatsappMessages)
    .where(and(inArray(whatsappMessages.groupJid, jids), gt(whatsappMessages.ts, cursor)))
    .orderBy(asc(whatsappMessages.ts))
  if (rows.length === 0) return result

  // Prefer the live bridge JID; fall back to the last cached value so a brief
  // bridge outage during a cron run doesn't cause the owner's group messages to
  // be skipped (ensureSelfPerson has no phone, so phone-matching would also fail).
  let selfJid: string | null = null
  let selfJidFromBridge = false
  if (isBridgeConfigured()) {
    try {
      selfJid = (await getBridgeStatus()).selfJid || null
      if (selfJid) selfJidFromBridge = true
    } catch {
      // bridge unreachable — use cached value below
    }
  }
  if (!selfJid) {
    selfJid = await getCachedSelfJid(db)
  }

  const byGroup = new Map<string, typeof rows>()
  let maxTs = cursor
  for (const r of rows) {
    maxTs = Math.max(maxTs, r.ts)
    const list = byGroup.get(r.groupJid) ?? []
    list.push(r)
    byGroup.set(r.groupJid, list)
  }

  const personCache = new Map<string, string | null>()
  const resolveSender = async (senderJid: string): Promise<string | null> => {
    const bare = bareJid(senderJid)
    if (personCache.has(bare)) return personCache.get(bare) ?? null
    const personId = await resolveGroupSenderPersonId(db, senderJid, selfJid)
    personCache.set(bare, personId)
    return personId
  }

  for (const [groupJid, msgs] of byGroup) {
    result.groups++
    const groupName = nameByJid.get(groupJid) ?? groupJid
    const isSelfSender = (senderJid: string) => !!selfJid && bareJid(senderJid) === bareJid(selfJid)
    const classifications = await classify(
      msgs.map((m) => ({ id: m.waMessageId, speakerLabel: isSelfSender(m.sender) ? 'אני' : m.senderName, text: m.text, ts: m.ts })),
    )

    const byMsgId = new Map(msgs.map((m) => [m.waMessageId, m]))
    const byPerson = new Map<string, (ProposedCommitment & { sourceSnippet: string | null })[]>()
    for (const cls of classifications) {
      const m = byMsgId.get(cls.messageId)
      if (!m) continue
      const personId = await resolveSender(m.sender)
      if (!personId) continue
      const owner: CommitmentOwner = (cls.kind === 'promise') === isSelfSender(m.sender) ? 'me' : 'them'
      const list = byPerson.get(personId) ?? []
      list.push({
        owner,
        content: cls.content,
        dueInferred: cls.due ?? inferDueDate(m.text, m.ts),
        sourceMessageId: m.waMessageId,
        sourceSnippet: clip(m.text, 80),
      })
      byPerson.set(personId, list)
    }
    for (const [personId, items] of byPerson) {
      const added = await proposeCommitments(db, personId, 'whatsapp_group', items)
      result.commitments += added.length
      for (const item of added) result.proposed.push({ label: groupName, content: item.content })
    }
  }

  // Persist cursor; also cache the live selfJid when we got it from the bridge
  // so future runs can fall back to it if the bridge is briefly offline.
  await setGroupCommitmentCursor(db, maxTs, selfJidFromBridge ? selfJid : undefined)
  return result
}

