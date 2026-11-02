/**
 * WhatsApp 1:1 capture for allowlisted people: which JIDs the bridge may forward, what the ingest
 * stores, nightly summaries with proposed commitments, and DM retention.
 */
import { and, asc, desc, eq, gt, inArray, lt, lte, sql } from 'drizzle-orm'
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
import { ownerIdentityPrompt } from './self-person'
import { learnAlias, resolveOrQueue } from './person-resolution'
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
  /** One sentence of why this is still a commitment. Stored as sourceReason. */
  because?: string | null
  senderJid?: string | null
  senderName?: string | null
  /** When the source message was sent, so the UI can show the conversation's own time. */
  sourceTs?: number | null
  /** Chat the message came from: group JID, or the other party's JID for a DM. */
  sourceChatJid?: string | null
  sourceChatName?: string | null
}

/** `{ label, content }` for one proposed commitment, for building notification text (label = chat/person name). */
export interface ProposedCommitmentLabel {
  label: string
  content: string
  because?: string | null
  /** Body line uses "מספר לא מוכר" instead of `label`. The title still uses `label` (the chat name). */
  unknownSender?: boolean
  /** Lets the cron drop backfilled old messages from the notification without hiding them. */
  sourceTs?: number | null
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

const MAX_COMMITMENTS_PER_CHAT = 3
const PRIOR_CONTEXT_LIMIT = 20
const DISMISSED_LOOKBACK = 30
/** Jaccard word-overlap threshold above which a new item is considered a rephrasing of a rejected one. */
const REJECTED_SIMILARITY_THRESHOLD = 0.8

function normalizeContent(s: string): string {
  return s.toLowerCase().replace(/[^\u05d0-\u05ffa-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

function wordSet(s: string): Set<string> {
  return new Set(normalizeContent(s).split(' ').filter(Boolean))
}

/** Jaccard similarity over word sets, 0–1. */
function jaccardSimilarity(a: string, b: string): number {
  const sa = wordSet(a)
  const sb = wordSet(b)
  if (sa.size === 0 && sb.size === 0) return 1
  if (sa.size === 0 || sb.size === 0) return 0
  let inter = 0
  for (const w of sa) if (sb.has(w)) inter++
  return inter / (sa.size + sb.size - inter)
}

/** Returns true when `content` is too similar to any of the already-rejected contents. */
export function matchesRejected(content: string, rejectedContents: string[]): boolean {
  return rejectedContents.some((r) => jaccardSimilarity(content, r) >= REJECTED_SIMILARITY_THRESHOLD)
}

/** One line handed to the conversation classifier. `citable: false` is prior context. */
export interface ConversationLine {
  id: string
  speakerLabel: string
  text: string
  ts: number
  citable?: boolean
}

/** One standing commitment from the conversation classifier. */
export interface ModelClassification {
  messageId: string
  owner: CommitmentOwner
  content: string
  due: string | null
  because: string
}

/** The scan proposes nothing for this chat. Callers must not replace it with the verb regex. */
export class ClassificationUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClassificationUnavailable'
  }
}

function formatConversationLine(m: ConversationLine): string {
  const stamp = new Date(m.ts).toISOString().slice(0, 16).replace('T', ' ')
  return `[${m.id}] ${stamp} ${m.speakerLabel}: ${m.text}`
}

/**
 * One Gemini call per chat. Returns at most 3 commitments still standing at the end of the
 * window. Prior lines (`citable: false`) are readable and cannot be cited as messageId.
 */
async function classifyMessagesWithModel(
  messages: ConversationLine[],
  options: { rejected?: string[] } = {},
): Promise<ModelClassification[]> {
  const model = getModel()
  const prior = messages.filter((m) => m.citable === false).slice(-PRIOR_CONTEXT_LIMIT)
  const fresh = messages.filter((m) => m.citable !== false).slice(-(200 - prior.length))
  const rejectedBlock =
    options.rejected?.length
      ? ['', 'REJECTED — do not return these tasks or any rephrasing of them:', ...options.rejected.map((r) => `- ${r}`)]
      : []
  const prompt = [
    ownerIdentityPrompt(),
    'Read this WhatsApp conversation (Hebrew, unless it is mostly English).',
    'speaker "אני" is Alpir Kritzler. owner "me" means he must act.',
    'Return only commitments that are still standing at the end of the thread.',
    'Merge restatements of the same task into one item. At most 3 items.',
    'Be strict. Most conversations contain no commitment at all — returning an empty list is the normal answer.',
    'Return empty when in doubt. Uncertainty ("I will think about it"), vague intent, encouragement, and tasks already resolved in the thread are not commitments.',
    'Drop jokes, hedges, sarcasm, and complaints that are not a real ask. "חלום, מזמין כוסות חדשות" after a complaint is not a commitment.',
    'Drop anything already settled in the thread. "נרשמתי" or "אני עניתי שלא" is done, not a task.',
    'Drop personal and social logistics: invitations, RSVPs, weddings, parties, conferences, rides, "בא איתי?", and health talk such as "תבדוק קורונה" or "תמשיך לנוח".',
    'Drop opinions, encouragement and small talk. If nobody is actually waiting on an outcome, it is not a commitment.',
    'An item only counts when someone must do something concrete and it is not done yet.',
    'content must be an abstracted short task, never the message text copied back. If the only thing you can write is the message itself, skip the item.',
    'CONTEXT lines are older. Use them to understand the thread. messageId must be the id of a NEW line, copied verbatim without brackets.',
    'owner is "me" when the account owner (speaker אני) must act, and "them" when someone else must act.',
    'content is a short Hebrew task, not a quote. because is one Hebrew sentence of why this is still on someone.',
    'due is YYYY-MM-DD only when a day is named; otherwise null.',
    'Respond in JSON only, no markdown fences:',
    '{"items":[{"messageId":"...","owner":"me","content":"...","because":"...","due":null}]}',
    ...rejectedBlock,
    '',
    prior.length ? `CONTEXT (do not cite these ids):\n${prior.map(formatConversationLine).join('\n')}` : 'CONTEXT: (none)',
    '',
    `NEW:\n${fresh.map(formatConversationLine).join('\n')}`,
  ].join('\n')
  const result = await model.generateContent(prompt)
  const raw = result.response.text().trim().replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()
  let parsed: { items?: { messageId?: unknown; owner?: unknown; content?: unknown; due?: unknown; because?: unknown }[] }
  try {
    parsed = JSON.parse(raw) as typeof parsed
  } catch {
    throw new Error('Commitment classification JSON parse failed')
  }
  const ids = new Set(fresh.map((m) => m.id))
  const kept: ModelClassification[] = []
  for (const it of parsed.items ?? []) {
    if (kept.length >= MAX_COMMITMENTS_PER_CHAT) break
    const messageId = asText(it?.messageId).replace(/^\[|\]$/g, '').trim()
    const owner = it?.owner === 'me' || it?.owner === 'them' ? it.owner : null
    const content = clip(asText(it?.content))
    const because = clip(asText(it?.because), 240)
    const dueRaw = it?.due
    const dueText = asText(dueRaw)
    const dueOk = dueRaw == null || dueText === '' || /^\d{4}-\d{2}-\d{2}$/.test(dueText)
    if (!owner || !content || !because || !dueOk || !ids.has(messageId)) continue
    kept.push({
      messageId,
      owner,
      content,
      because,
      due: /^\d{4}-\d{2}-\d{2}$/.test(dueText) ? dueText : null,
    })
  }
  return kept
}

export type MessageClassifier = (messages: ConversationLine[]) => Promise<ModelClassification[]>

/**
 * Gemini when `GEMINI_API_KEY` is set. A missing key or a failed call throws
 * `ClassificationUnavailable` so the scan proposes nothing for that chat.
 * Tests inject a stand-in instead of mocking the Gemini SDK.
 */
export const defaultClassify: MessageClassifier = async (messages) => {
  if (!process.env.GEMINI_API_KEY) throw new ClassificationUnavailable('GEMINI_API_KEY is not set')
  try {
    return await classifyMessagesWithModel(messages)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'classification failed'
    console.warn('[whatsapp-dm] model classification failed', message)
    throw new ClassificationUnavailable(message)
  }
}

/**
 * Like `defaultClassify` but passes the already-rejected contents to the model so it can avoid
 * returning them or any rephrasing. Used by `scanDmCommitments` when dismissed items are known.
 */
function makeRejectionAwareClassifier(rejected: string[]): MessageClassifier {
  return async (messages) => {
    if (!process.env.GEMINI_API_KEY) throw new ClassificationUnavailable('GEMINI_API_KEY is not set')
    try {
      return await classifyMessagesWithModel(messages, { rejected })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'classification failed'
      console.warn('[whatsapp-dm] model classification failed', message)
      throw new ClassificationUnavailable(message)
    }
  }
}

/** Classifies one DM chat. `owner` is who must act; personId stays the other person. */
async function classifyDmMessages(
  messages: (DmPromptMessage & { citable?: boolean })[],
  personName: string,
  classify: MessageClassifier,
): Promise<ProposedCommitment[]> {
  const classifications = await classify(
    messages.map((m) => ({
      id: m.id,
      speakerLabel: m.fromMe ? 'אני' : personName,
      text: m.text,
      ts: m.ts,
      citable: m.citable !== false,
    })),
  )
  const byId = new Map(messages.filter((m) => m.citable !== false).map((m) => [m.id, m]))
  const out: ProposedCommitment[] = []
  for (const cls of classifications) {
    const src = byId.get(cls.messageId)
    if (!src) continue
    out.push({
      owner: cls.owner,
      content: cls.content,
      dueInferred: cls.due,
      sourceMessageId: cls.messageId,
      because: cls.because,
      sourceTs: src.ts,
    })
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
    ownerIdentityPrompt(),
    `Summarize Alpir Kritzler's private WhatsApp chat with ${personName}. "אני" in the transcript is Alpir, not another person.`,
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
  }
  return result
}

export interface DmCommitmentScanResult {
  people: number
  commitments: number
  proposed: ProposedCommitmentLabel[]
}

/**
 * Proposes commitments from new 1:1 messages, one Gemini reading of the chat plus up to 20 older
 * lines. A missing key or a failed call proposes nothing for that chat. Does not write a summary
 * row, so the nightly digest still sees the same window.
 */
export async function scanDmCommitments(
  db: Db,
  now = Date.now(),
  options: { classify?: MessageClassifier } = {},
): Promise<DmCommitmentScanResult> {
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

    // Fetch dismissed commitments for this person so we can pass them to the model and
    // post-filter its output (prevents rephrased repeats after the user pressed "דחה").
    const dismissedRows = await db
      .select({ content: commitments.content, sourceId: commitments.sourceId })
      .from(commitments)
      .where(and(eq(commitments.personId, personId), eq(commitments.status, 'dismissed')))
      .orderBy(desc(commitments.createdAt))
      .limit(DISMISSED_LOOKBACK)
    const dismissedContents = dismissedRows.map((r) => r.content)
    const dismissedSourceIds = new Set(dismissedRows.map((r) => r.sourceId).filter((id): id is string => !!id))

    // Use a rejection-aware classifier when no test override is provided.
    const classify = options.classify ?? makeRejectionAwareClassifier(dismissedContents)
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
    const priorRows = await db
      .select({ id: whatsappDmMessages.id, fromMe: whatsappDmMessages.fromMe, text: whatsappDmMessages.text, ts: whatsappDmMessages.ts })
      .from(whatsappDmMessages)
      .where(and(eq(whatsappDmMessages.personId, personId), lte(whatsappDmMessages.ts, from), sql`${whatsappDmMessages.text} != ${DM_EXPIRED_TEXT}`))
      .orderBy(desc(whatsappDmMessages.ts))
      .limit(PRIOR_CONTEXT_LIMIT)
    const messages = [
      ...priorRows.reverse().map((r) => ({ id: r.id, fromMe: !!r.fromMe, text: r.text, ts: r.ts, citable: false as const })),
      ...rows.map((r) => ({ id: r.id, fromMe: !!r.fromMe, text: r.text, ts: r.ts, citable: true as const })),
    ]
    let found: ProposedCommitment[]
    try {
      found = await classifyDmMessages(messages, person.name, classify)
    } catch (err) {
      if (err instanceof ClassificationUnavailable) continue
      throw err
    }
    // Post-filter: drop anything whose source message is already dismissed or whose content
    // is too similar to a previously rejected commitment (catches rephrased repeats).
    found = found.filter(
      (c) =>
        !(c.sourceMessageId && dismissedSourceIds.has(c.sourceMessageId)) &&
        !matchesRejected(c.content, dismissedContents),
    )
    result.people++
    const textById = new Map(messages.map((m) => [m.id, m.text]))
    const added = await proposeCommitments(db, personId, 'whatsapp_dm', found.map((c) => ({
      ...c,
      sourceSnippet: c.sourceMessageId ? clip(textById.get(c.sourceMessageId) ?? '', 160) : null,
      sourceChatName: person.name,
    })))
    result.commitments += added.length
    for (const item of added) {
      result.proposed.push({ label: person.name, content: item.content, because: item.because ?? null, sourceTs: item.sourceTs ?? null })
    }
  }
  return result
}

/**
 * Inserts proposed commitments. Same text is skipped for a known person. WhatsApp sources also
 * skip a source message that already has a row in any status, including a dismissed one.
 * `personId` null stores an unknown group sender on the row itself.
 */
export async function proposeCommitments(
  db: Db,
  personId: string | null,
  source: CommitmentSource,
  items: (ProposedCommitment & { sourceSnippet: string | null })[],
  createdAt = new Date().toISOString(),
): Promise<ProposedCommitment[]> {
  if (items.length === 0) return []
  const existingContent = new Set<string>()
  if (personId) {
    const existingRows = await db
      .select({ content: commitments.content })
      .from(commitments)
      .where(eq(commitments.personId, personId))
    for (const row of existingRows) existingContent.add(row.content)
  }
  const dedupeBySourceId = source === 'whatsapp_dm' || source === 'whatsapp_group'
  const existingSourceIds = new Set<string>()
  if (dedupeBySourceId) {
    const ids = [...new Set(items.map((i) => i.sourceMessageId).filter((id): id is string => !!id))]
    if (ids.length > 0) {
      const taken = await db
        .select({ sourceId: commitments.sourceId })
        .from(commitments)
        .where(and(eq(commitments.source, source), inArray(commitments.sourceId, ids)))
      for (const row of taken) if (row.sourceId) existingSourceIds.add(row.sourceId)
    }
  }
  const added: ProposedCommitment[] = []
  for (const item of items) {
    if (personId && existingContent.has(item.content)) continue
    if (dedupeBySourceId && item.sourceMessageId && existingSourceIds.has(item.sourceMessageId)) continue
    if (personId) existingContent.add(item.content)
    if (item.sourceMessageId) existingSourceIds.add(item.sourceMessageId)
    await db.insert(commitments).values({
      id: `cm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      personId,
      senderJid: personId ? null : (item.senderJid ?? null),
      senderName: personId ? null : (item.senderName ?? null),
      owner: item.owner,
      content: item.content,
      dueInferred: item.dueInferred,
      source,
      sourceId: item.sourceMessageId,
      sourceSnippet: item.sourceSnippet,
      sourceTs: item.sourceTs ?? null,
      sourceChatJid: item.sourceChatJid ?? null,
      sourceChatName: item.sourceChatName ?? null,
      sourceReason: item.because ?? null,
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
 * the bridge's own JID, otherwise a phone or manual-link match. Null means the sender is not a
 * contact yet; the scan still stores the commitment with personId empty.
 */
export async function resolveGroupSenderPersonId(
  db: Db,
  senderJid: string,
  selfJid: string | null,
  senderName?: string | null,
): Promise<string | null> {
  const bare = bareJid(senderJid)
  if (selfJid && bare === bareJid(selfJid)) {
    return (await ensureSelfPerson(db)).id
  }
  const phone = phoneFromWhatsappJid(bare)
  if (phone) {
    const byPhone = await findPersonByPhone(db, phone)
    if (byPhone) return byPhone
  }
  const linked = await findPersonByManualLink(db, bare)
  if (linked) {
    if (senderName) await learnAlias(db, linked, senderName, 'whatsapp')
    return linked
  }
  // The push name may be a taught alias; a near miss waits in the identity queue.
  return senderName ? resolveOrQueue(db, { name: senderName, source: 'whatsapp', context: 'קבוצת וואטסאפ' }) : null
}

export interface GroupCommitmentScanResult {
  groups: number
  commitments: number
  proposed: ProposedCommitmentLabel[]
}

/**
 * Proposes commitments from new messages in enabled WhatsApp groups, one Gemini reading per group
 * plus up to 20 older lines. When the person who must act is not a contact, the row is stored with
 * personId null. A failed call does not advance the cursor past that group's oldest new message.
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

  const senderNames = new Map<string, string>()
  for (const r of rows) if (r.senderName && !senderNames.has(bareJid(r.sender))) senderNames.set(bareJid(r.sender), r.senderName)
  const personCache = new Map<string, string | null>()
  const resolveSender = async (senderJid: string): Promise<string | null> => {
    const bare = bareJid(senderJid)
    if (personCache.has(bare)) return personCache.get(bare) ?? null
    const personId = await resolveGroupSenderPersonId(db, senderJid, selfJid, senderNames.get(bare))
    personCache.set(bare, personId)
    return personId
  }

  const isSelfSender = (senderJid: string) => !!selfJid && bareJid(senderJid) === bareJid(selfJid)
  let retryBefore: number | null = null
  let selfPersonId: string | null = null

  for (const [groupJid, msgs] of byGroup) {
    const groupName = nameByJid.get(groupJid) ?? groupJid
    const priorRows = await db
      .select({
        waMessageId: whatsappMessages.waMessageId,
        sender: whatsappMessages.sender,
        senderName: whatsappMessages.senderName,
        text: whatsappMessages.text,
        ts: whatsappMessages.ts,
      })
      .from(whatsappMessages)
      .where(and(eq(whatsappMessages.groupJid, groupJid), lte(whatsappMessages.ts, cursor)))
      .orderBy(desc(whatsappMessages.ts))
      .limit(PRIOR_CONTEXT_LIMIT)
    const lines: ConversationLine[] = [
      ...priorRows.reverse().map((m) => ({
        id: m.waMessageId,
        speakerLabel: isSelfSender(m.sender) ? 'אני' : m.senderName,
        text: m.text,
        ts: m.ts,
        citable: false,
      })),
      ...msgs.map((m) => ({
        id: m.waMessageId,
        speakerLabel: isSelfSender(m.sender) ? 'אני' : m.senderName,
        text: m.text,
        ts: m.ts,
        citable: true,
      })),
    ]
    let classifications: ModelClassification[]
    try {
      classifications = await classify(lines)
    } catch (err) {
      if (err instanceof ClassificationUnavailable) {
        const oldest = Math.min(...msgs.map((m) => m.ts))
        retryBefore = retryBefore == null ? oldest : Math.min(retryBefore, oldest)
        continue
      }
      throw err
    }
    result.groups++

    const byMsgId = new Map(msgs.map((m) => [m.waMessageId, m]))
    const buckets = new Map<string, { personId: string | null; items: (ProposedCommitment & { sourceSnippet: string | null })[] }>()
    for (const cls of classifications) {
      const m = byMsgId.get(cls.messageId)
      if (!m) continue
      let personId: string | null
      if (cls.owner === 'me') {
        selfPersonId ??= (await ensureSelfPerson(db)).id
        personId = selfPersonId
      } else {
        personId = await resolveSender(m.sender)
      }
      const key = personId ?? `unknown:${bareJid(m.sender)}`
      const bucket = buckets.get(key) ?? { personId, items: [] }
      bucket.items.push({
        owner: cls.owner,
        content: cls.content,
        dueInferred: cls.due,
        sourceMessageId: m.waMessageId,
        sourceSnippet: clip(m.text, 160),
        because: cls.because,
        senderJid: personId ? null : bareJid(m.sender),
        senderName: personId ? null : m.senderName,
        sourceTs: m.ts,
        sourceChatJid: groupJid,
        sourceChatName: groupName,
      })
      buckets.set(key, bucket)
    }
    for (const bucket of buckets.values()) {
      const added = await proposeCommitments(db, bucket.personId, 'whatsapp_group', bucket.items)
      result.commitments += added.length
      for (const item of added) {
        result.proposed.push({
          label: groupName,
          content: item.content,
          because: item.because ?? null,
          unknownSender: !bucket.personId,
          sourceTs: item.sourceTs ?? null,
        })
      }
    }
  }

  // A failed group keeps the cursor at or before its oldest new message so the next run retries it.
  const advanceTo = retryBefore == null ? maxTs : Math.max(cursor, retryBefore - 1)
  await setGroupCommitmentCursor(db, advanceTo, selfJidFromBridge ? selfJid : undefined)
  return result
}

