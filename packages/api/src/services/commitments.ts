/**
 * The shared commitment queue: proposals from meeting/voice analyses, source links, and the
 * per-day view Hugo's morning brief and meeting prep read.
 */
import { and, desc, eq, inArray } from 'drizzle-orm'
import {
  commitments,
  meetingAnalyses,
  meetingPeople,
  meetings,
  people,
  type CommitmentSource,
  type getDb,
} from '@ak-system/database'
import { personAliases } from '@ak-system/database'
import { namesMatch, resolveCandidate } from './people-resolve'
import { getSelfPersonName } from './self-person'
import { inferDueDate, proposeCommitments, type ProposedCommitmentLabel } from './whatsapp-dm'
import { linkAnalysisItems } from './action-item-link'

type Db = ReturnType<typeof getDb>

/** How Hugo names each source in briefs. */
export const COMMITMENT_SOURCE_LABELS: Record<CommitmentSource, string> = {
  meeting_analysis: 'מהאנליזה',
  whatsapp_dm: 'מהוואטסאפ',
  whatsapp_group: 'מהוואטסאפ',
  email: 'מאימייל',
  voice: 'מהקלטה',
  slack_channel: 'מסלאק',
  teams_chat: 'מ-Teams',
}

export function sourceLabel(source: string): string {
  return COMMITMENT_SOURCE_LABELS[source as CommitmentSource] ?? source
}

const NOTIFICATION_LINE_LIMIT = 5

/** A message older than this is backfill, not news — it lands in the list without a push. */
export const COMMITMENT_FRESH_HOURS = 6

/**
 * Drops proposals whose source message is older than `COMMITMENT_FRESH_HOURS`, so a bridge
 * backfill or a container restart does not push this morning's conversation as if it just
 * happened. An item with no source timestamp (analysis, email) counts as fresh.
 */
export function freshCommitments(items: ProposedCommitmentLabel[], now = Date.now()): ProposedCommitmentLabel[] {
  const cutoff = now - COMMITMENT_FRESH_HOURS * 3_600_000
  return items.filter((i) => i.sourceTs == null || i.sourceTs >= cutoff)
}

function taskWithReason(item: ProposedCommitmentLabel): string {
  return item.because ? `${item.content} — ${item.because}` : item.content
}

function lineLabel(item: ProposedCommitmentLabel): string {
  return item.unknownSender ? 'מספר לא מוכר' : item.label
}

/**
 * Title/body for the "new commitment(s) proposed" notification. One item names the chat and
 * shows its content; several items list up to 5 `chat: content` lines with a tail count.
 * A reason, when present, follows the task. An unknown sender is labeled מספר לא מוכר in the body.
 */
export function buildCommitmentNotification(items: ProposedCommitmentLabel[]): { title: string; body: string } {
  if (items.length === 1) {
    const item = items[0]
    const task = taskWithReason(item)
    const lead = item.because || item.unknownSender ? `${lineLabel(item)}: ${task}` : item.content
    return {
      title: `התחייבות חדשה מ${item.label}`,
      body: `${lead}\n\nעבור עליה ואשר אם נכנס למשימות.`,
    }
  }
  const lines = items.slice(0, NOTIFICATION_LINE_LIMIT).map((i) => `${lineLabel(i)}: ${taskWithReason(i)}`)
  const rest = items.length - lines.length
  if (rest > 0) lines.push(`ועוד ${rest} נוספות.`)
  lines.push('עבור עליהן ואשר מה נכנס למשימות.')
  return {
    title: `${items.length} התחייבויות חדשות מהוואטסאפ`,
    body: lines.join('\n'),
  }
}

/** Outlook ConversationIds are long base64 (`AAQkAD…=`); Gmail thread ids are 16 hex chars. */
export function isOutlookConversationId(threadId: string): boolean {
  return threadId.length > 32 || /[=/+]/.test(threadId)
}

/**
 * Gmail thread key is `accountEmail::threadId`. Outlook threads share the key shape but carry a
 * ConversationId (long base64), which Gmail can't open — those get no link.
 */
export function gmailThreadUrl(threadKey: string): string | null {
  const sep = threadKey.indexOf('::')
  if (sep <= 0) return null
  const account = threadKey.slice(0, sep)
  const threadId = threadKey.slice(sep + 2)
  if (!threadId || isOutlookConversationId(threadId)) return null
  return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(account)}#all/${encodeURIComponent(threadId)}`
}

/** Where the commitment came from, or null when there is nothing to open (WhatsApp). */
export function commitmentSourceUrl(c: { source: string; sourceId: string | null; sourceChatJid?: string | null }): string | null {
  if (!c.sourceId) return null
  if (c.source === 'email') return gmailThreadUrl(c.sourceId)
  if (c.source === 'meeting_analysis' || c.source === 'voice') return `/meetings/${c.sourceId}`
  if (c.source === 'slack_channel' && c.sourceChatJid) {
    // sourceId is the internal sm_ id; derive Slack permalink from sourceChatJid (channelId) and sourceId suffix
    // Format: sm_<channelId>_<ts_with_underscore> → extract ts
    const match = c.sourceId.match(/^sm_[^_]+_(.+)$/)
    if (match) {
      const slackTs = match[1].replace('_', '.')
      return `https://slack.com/archives/${c.sourceChatJid}/p${slackTs.replace('.', '')}`
    }
  }
  if (c.source === 'teams_chat' && c.sourceChatJid) {
    // sourceChatJid is the Graph chat id; open the thread in Teams.
    return `https://teams.microsoft.com/l/chat/${encodeURIComponent(c.sourceChatJid)}/conversations`
  }
  return null
}

/**
 * Proposes commitments from a completed analysis's action items. An item owned by a confirmed
 * attendee goes to that person; an item owned by me (or by nobody) goes to the only other
 * attendee, and stays on the analysis when several people were there.
 */
export async function proposeCommitmentsFromAnalysis(
  db: Db,
  analysisId: string,
  source: Extract<CommitmentSource, 'meeting_analysis' | 'voice'> = 'meeting_analysis',
): Promise<number> {
  const added = await insertCommitmentsFromAnalysis(db, analysisId, source)
  // Each item carries its commitment's id so both sides stay in sync (commitment-task-linking).
  await linkAnalysisItems(db, analysisId)
  return added
}

async function insertCommitmentsFromAnalysis(
  db: Db,
  analysisId: string,
  source: Extract<CommitmentSource, 'meeting_analysis' | 'voice'>,
): Promise<number> {
  const [analysis] = await db
    .select({ meetingId: meetingAnalyses.meetingId, actionItemsJson: meetingAnalyses.actionItemsJson, status: meetingAnalyses.status })
    .from(meetingAnalyses)
    .where(eq(meetingAnalyses.id, analysisId))
  if (!analysis || analysis.status !== 'completed' || !analysis.actionItemsJson) return 0
  let items: { content?: unknown; owner?: unknown; personId?: unknown }[]
  try {
    items = JSON.parse(analysis.actionItemsJson) as typeof items
  } catch {
    return 0
  }
  if (!Array.isArray(items) || items.length === 0) return 0

  const [meeting] = await db.select({ date: meetings.date }).from(meetings).where(eq(meetings.id, analysis.meetingId))
  const selfName = getSelfPersonName()
  const attendees = (
    await db
      .select({ id: people.id, name: people.name })
      .from(meetingPeople)
      .innerJoin(people, eq(people.id, meetingPeople.personId))
      .where(and(eq(meetingPeople.meetingId, analysis.meetingId), eq(people.status, 'confirmed')))
  ).filter((p) => !namesMatch(p.name, selfName))
  if (attendees.length === 0) return 0
  // An owner the analysis wrote as "Jordan" or "ג׳ורדן" still lands on ירדן.
  const aliasesById = new Map<string, string[]>()
  for (const row of await db
    .select({ personId: personAliases.personId, alias: personAliases.alias })
    .from(personAliases)
    .where(inArray(personAliases.personId, attendees.map((a) => a.id)))) {
    aliasesById.set(row.personId, [...(aliasesById.get(row.personId) ?? []), row.alias])
  }

  const candidates = attendees.map((p) => ({ ...p, aliases: aliasesById.get(p.id) ?? [] }))

  const base = meeting?.date ? new Date(`${meeting.date}T12:00:00Z`).getTime() : Date.now()
  const byPerson = new Map<string, Parameters<typeof proposeCommitments>[3]>()
  for (const raw of items) {
    const content = typeof raw?.content === 'string' ? raw.content.replace(/\s+/g, ' ').trim().slice(0, 140) : ''
    if (!content) continue
    const owner = typeof raw?.owner === 'string' ? raw.owner.trim() : ''
    // The analysis already linked the owner to a People record — that beats any name match.
    const linked = typeof raw?.personId === 'string' ? attendees.find((p) => p.id === raw.personId) : undefined
    const theirs = linked ?? (owner ? resolveCandidate(owner, candidates) ?? undefined : undefined)
    const mine = !owner || namesMatch(owner, selfName) || /^(אני|me|i)$/i.test(owner)
    let personId: string | null = null
    let who: 'me' | 'them' = 'me'
    if (theirs) {
      personId = theirs.id
      who = 'them'
    } else if (mine && attendees.length === 1) {
      personId = attendees[0].id
    }
    if (!personId) continue
    const list = byPerson.get(personId) ?? []
    list.push({ owner: who, content, dueInferred: inferDueDate(content, base), sourceMessageId: analysis.meetingId, sourceSnippet: null })
    byPerson.set(personId, list)
  }
  let added = 0
  for (const [personId, list] of byPerson) added += (await proposeCommitments(db, personId, source, list)).length
  return added
}

export interface BriefCommitment {
  personName: string
  owner: string
  content: string
  source: string
}

export interface CommitmentsForDate {
  /** Proposed commitments of people I meet that day, grouped by person */
  byPerson: { personId: string; personName: string; items: BriefCommitment[] }[]
  /** My other proposed commitments, not already listed above */
  mine: BriefCommitment[]
}

const MINE_LIMIT = 5
const PER_PERSON_LIMIT = 5

export async function commitmentsForDate(db: Db, date: string): Promise<CommitmentsForDate> {
  const attendees = await db
    .select({ id: people.id, name: people.name })
    .from(meetings)
    .innerJoin(meetingPeople, eq(meetingPeople.meetingId, meetings.id))
    .innerJoin(people, eq(people.id, meetingPeople.personId))
    .where(and(eq(meetings.date, date), eq(people.status, 'confirmed')))
  const personIds = [...new Set(attendees.map((a) => a.id))]
  const nameById = new Map(attendees.map((a) => [a.id, a.name]))

  const todays = personIds.length
    ? await db
        .select({ id: commitments.id, personId: commitments.personId, owner: commitments.owner, content: commitments.content, source: commitments.source })
        .from(commitments)
        .where(and(eq(commitments.status, 'proposed'), inArray(commitments.personId, personIds)))
        .orderBy(desc(commitments.createdAt))
    : []
  const byPerson: CommitmentsForDate['byPerson'] = []
  for (const personId of personIds) {
    const items = todays.filter((c) => c.personId === personId).slice(0, PER_PERSON_LIMIT)
    if (items.length === 0) continue
    const personName = nameById.get(personId) ?? ''
    byPerson.push({ personId, personName, items: items.map((c) => ({ personName, owner: c.owner, content: c.content, source: c.source })) })
  }

  const listed = new Set(todays.map((c) => c.id))
  const mineRows = await db
    .select({ id: commitments.id, owner: commitments.owner, content: commitments.content, source: commitments.source, personName: people.name })
    .from(commitments)
    .innerJoin(people, eq(people.id, commitments.personId))
    .where(and(eq(commitments.status, 'proposed'), eq(commitments.owner, 'me')))
    .orderBy(desc(commitments.createdAt))
    .limit(MINE_LIMIT + listed.size)
  const mine = mineRows
    .filter((c) => !listed.has(c.id))
    .slice(0, MINE_LIMIT)
    .map((c) => ({ personName: c.personName, owner: c.owner, content: c.content, source: c.source }))
  return { byPerson, mine }
}

/** Prep lines for one attendee: text only, never the raw source snippet. */
export async function prepCommitmentLines(db: Db, personId: string, personName: string, limit = 3): Promise<string[]> {
  const rows = await db
    .select({ owner: commitments.owner, content: commitments.content, source: commitments.source })
    .from(commitments)
    .where(and(eq(commitments.personId, personId), eq(commitments.status, 'proposed')))
    .orderBy(desc(commitments.createdAt))
    .limit(limit)
  return rows.map((c) =>
    `${personName} · התחייבות פתוחה (${sourceLabel(c.source)}): ${c.owner === 'me' ? 'אני' : personName} – ${c.content}`,
  )
}
