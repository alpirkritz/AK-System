/**
 * Harness Context Indexer — folds every domain into one world model.
 *
 * Each cron owns one domain and throws its snapshot away once the message is sent.
 * This walks the same source tables and writes `harness_nodes` / `harness_edges`, so
 * the reasoner can ask questions that cross domains ("silent in WhatsApp *and* owes me
 * something *and* sits on tomorrow's calendar") without re-querying six services.
 *
 * Node and edge ids are deterministic, so a re-index updates in place.
 */
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import {
  commitments,
  financeTransactions,
  harnessEdges,
  harnessNodes,
  meetingPeople,
  meetings,
  people,
  personEmailThreads,
  voiceRecordings,
  whatsappDmMessages,
  whatsappGroups,
  whatsappMessages,
  type getDb,
} from '@ak-system/database'
import { gmailThreadUrl } from './commitments'
import { mirrorToGrag } from './harness-grag'

type Db = ReturnType<typeof getDb>

export type HarnessScope =
  | 'people'
  | 'meetings'
  | 'commitments'
  | 'whatsapp'
  | 'finance'
  | 'voice'
  | 'email'

export const HARNESS_SCOPES: HarnessScope[] = [
  'people',
  'meetings',
  'commitments',
  'whatsapp',
  'finance',
  'voice',
  'email',
]

export interface IndexOptions {
  scopes?: HarnessScope[]
  /** How far back to walk the time-series domains. Keeps a run bounded. */
  windowDays?: number
  now?: Date
}

export interface IndexResult {
  nodes: number
  edges: number
  byScope: Record<string, number>
  windowStart: string
  durationMs: number
}

interface NodeDraft {
  id: string
  kind: string
  entityId: string
  label: string
  summary: string | null
  attrs: Record<string, unknown> | null
  occurredAt: string | null
}

interface EdgeDraft {
  fromId: string
  toId: string
  kind: string
  weight?: number
  occurredAt?: string | null
  attrs?: Record<string, unknown> | null
}

const DEFAULT_WINDOW_DAYS = 30
/** Per-domain row cap. The reasoner reads summaries, not raw history. */
const SCOPE_LIMIT = 500
/** A transaction this close to a meeting is treated as plausibly caused by it. */
const SPEND_PROXIMITY_DAYS = 2

export function nodeId(kind: string, entityId: string): string {
  return `${kind}:${entityId}`
}

function edgeId(kind: string, fromId: string, toId: string): string {
  return `${kind}:${fromId}:${toId}`
}

function isoDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86400000).toISOString()
}

/**
 * Date columns are not uniform across domains: `meetings.date` is `YYYY-MM-DD`, while
 * bank rows arrive from the scrapers as full ISO timestamps. Everything here reduces to
 * a calendar day first, so no code path concatenates a time onto a value that already
 * carries one and ends up with an invalid date.
 */
function dayKey(value: string | null | undefined): string | null {
  if (!value) return null
  const day = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

/** Midday UTC of the value's calendar day, or null when it is not a usable date. */
function middayMs(value: string | null | undefined): number | null {
  const day = dayKey(value)
  if (!day) return null
  const ms = new Date(`${day}T12:00:00.000Z`).getTime()
  return Number.isFinite(ms) ? ms : null
}

function truncate(text: string | null | undefined, max = 180): string | null {
  if (!text) return null
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return null
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * Splits drafts into inserts and updates by reading the existing ids first.
 * Drizzle's upsert syntax differs between the pg and sqlite drivers, and `getDb()`
 * returns either — a read-then-write keeps one code path for both.
 */
async function writeNodes(db: Db, drafts: NodeDraft[], now: string): Promise<number> {
  if (drafts.length === 0) return 0
  const unique = new Map(drafts.map((d) => [d.id, d]))
  const ids = [...unique.keys()]
  const existing = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const rows = await db.select({ id: harnessNodes.id }).from(harnessNodes).where(inArray(harnessNodes.id, chunk))
    for (const r of rows) existing.add(r.id)
  }

  const inserts = []
  for (const draft of unique.values()) {
    const row = {
      id: draft.id,
      kind: draft.kind,
      entityId: draft.entityId,
      label: draft.label,
      summary: draft.summary,
      attrs: draft.attrs ? JSON.stringify(draft.attrs) : null,
      occurredAt: draft.occurredAt,
    }
    if (existing.has(draft.id)) {
      await db
        .update(harnessNodes)
        .set({ ...row, updatedAt: now })
        .where(eq(harnessNodes.id, draft.id))
    } else {
      inserts.push({ ...row, createdAt: now, updatedAt: now })
    }
  }
  for (let i = 0; i < inserts.length; i += 100) {
    await db.insert(harnessNodes).values(inserts.slice(i, i + 100))
  }
  return unique.size
}

async function writeEdges(db: Db, drafts: EdgeDraft[], now: string): Promise<number> {
  if (drafts.length === 0) return 0
  const unique = new Map<string, EdgeDraft & { id: string }>()
  for (const d of drafts) {
    const id = edgeId(d.kind, d.fromId, d.toId)
    unique.set(id, { ...d, id })
  }
  const ids = [...unique.keys()]
  const existing = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const rows = await db.select({ id: harnessEdges.id }).from(harnessEdges).where(inArray(harnessEdges.id, chunk))
    for (const r of rows) existing.add(r.id)
  }

  const inserts = []
  for (const draft of unique.values()) {
    const row = {
      id: draft.id,
      fromId: draft.fromId,
      toId: draft.toId,
      kind: draft.kind,
      // `weight` is NOT NULL, and SQLite stores a NaN as NULL — never pass one through.
      weight: Number.isFinite(draft.weight) ? (draft.weight as number) : 1,
      occurredAt: draft.occurredAt ?? null,
      attrs: draft.attrs ? JSON.stringify(draft.attrs) : null,
    }
    if (existing.has(draft.id)) {
      await db.update(harnessEdges).set(row).where(eq(harnessEdges.id, draft.id))
    } else {
      inserts.push({ ...row, createdAt: now })
    }
  }
  for (let i = 0; i < inserts.length; i += 100) {
    await db.insert(harnessEdges).values(inserts.slice(i, i + 100))
  }
  return unique.size
}

/** Walks every requested domain and reconciles the world model against it. */
export async function indexHarnessWorld(db: Db, options: IndexOptions = {}): Promise<IndexResult> {
  const startedAt = Date.now()
  const now = options.now ?? new Date()
  const nowIso = now.toISOString()
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS
  const windowStartIso = isoDaysAgo(now, windowDays)
  const windowStartDate = windowStartIso.slice(0, 10)
  const windowStartMs = new Date(windowStartIso).getTime()
  const scopes = new Set(options.scopes ?? HARNESS_SCOPES)

  const nodes: NodeDraft[] = []
  const edges: EdgeDraft[] = []
  const byScope: Record<string, number> = {}

  /** Meetings are needed as edge targets even when only another scope was requested. */
  const needMeetings = scopes.has('meetings') || scopes.has('finance') || scopes.has('voice')
  const meetingRows = needMeetings
    ? await db
        .select({
          id: meetings.id,
          title: meetings.title,
          date: meetings.date,
          time: meetings.time,
          category: meetings.category,
          location: meetings.location,
          seriesId: meetings.seriesId,
          projectId: meetings.projectId,
        })
        .from(meetings)
        .where(gte(meetings.date, windowStartDate))
        .orderBy(desc(meetings.date))
        .limit(SCOPE_LIMIT)
    : []

  if (scopes.has('people')) {
    const rows = await db
      .select({
        id: people.id,
        name: people.name,
        role: people.role,
        company: people.company,
        email: people.email,
        phone: people.phone,
        lastContact: people.lastContact,
        status: people.status,
      })
      .from(people)
      .where(eq(people.status, 'confirmed'))
      .limit(SCOPE_LIMIT)

    for (const p of rows) {
      const descriptor = [p.role, p.company].filter(Boolean).join(' · ')
      nodes.push({
        id: nodeId('person', p.id),
        kind: 'person',
        entityId: p.id,
        label: p.name,
        summary: descriptor || null,
        attrs: { email: p.email, phone: p.phone, lastContact: p.lastContact },
        occurredAt: null,
      })
    }
    byScope.people = rows.length
  }

  if (scopes.has('meetings')) {
    for (const m of meetingRows) {
      const day = dayKey(m.date)
      nodes.push({
        id: nodeId('meeting', m.id),
        kind: 'meeting',
        entityId: m.id,
        label: m.title,
        summary: [m.date, m.time, m.location].filter(Boolean).join(' · '),
        attrs: { date: m.date, time: m.time, category: m.category, seriesId: m.seriesId, projectId: m.projectId },
        occurredAt: day ? `${day}T${(m.time || '00:00').padStart(5, '0')}:00` : null,
      })
    }

    const meetingIds = meetingRows.map((m) => m.id)
    for (let i = 0; i < meetingIds.length; i += 200) {
      const chunk = meetingIds.slice(i, i + 200)
      if (chunk.length === 0) break
      const links = await db
        .select({ meetingId: meetingPeople.meetingId, personId: meetingPeople.personId })
        .from(meetingPeople)
        .where(inArray(meetingPeople.meetingId, chunk))
      const dateById = new Map(meetingRows.map((m) => [m.id, m.date]))
      for (const link of links) {
        edges.push({
          fromId: nodeId('person', link.personId),
          toId: nodeId('meeting', link.meetingId),
          kind: 'ATTENDED',
          occurredAt: dateById.get(link.meetingId) ?? null,
        })
      }
    }
    byScope.meetings = meetingRows.length
  }

  if (scopes.has('commitments')) {
    const rows = await db
      .select()
      .from(commitments)
      .where(inArray(commitments.status, ['proposed', 'accepted']))
      .orderBy(desc(commitments.createdAt))
      .limit(SCOPE_LIMIT)

    for (const c of rows) {
      nodes.push({
        id: nodeId('commitment', c.id),
        kind: 'commitment',
        entityId: c.id,
        label: truncate(c.content, 90) ?? 'התחייבות',
        summary: truncate(c.sourceReason ?? c.sourceSnippet, 160),
        attrs: {
          owner: c.owner,
          status: c.status,
          source: c.source,
          dueInferred: c.dueInferred,
          personId: c.personId,
          senderName: c.senderName,
        },
        occurredAt: c.sourceTs ? new Date(c.sourceTs).toISOString() : c.createdAt,
      })
      if (c.personId) {
        edges.push({
          fromId: nodeId('person', c.personId),
          toId: nodeId('commitment', c.id),
          kind: 'HAS_COMMITMENT',
          occurredAt: c.createdAt,
          attrs: { owner: c.owner, status: c.status },
        })
      }
    }
    byScope.commitments = rows.length
  }

  if (scopes.has('whatsapp')) {
    const groupRows = await db
      .select({
        id: whatsappMessages.id,
        sender: whatsappMessages.sender,
        senderName: whatsappMessages.senderName,
        text: whatsappMessages.text,
        ts: whatsappMessages.ts,
        groupJid: whatsappMessages.groupJid,
        groupName: whatsappGroups.name,
      })
      .from(whatsappMessages)
      .leftJoin(whatsappGroups, eq(whatsappGroups.jid, whatsappMessages.groupJid))
      .where(gte(whatsappMessages.ts, windowStartMs))
      .orderBy(desc(whatsappMessages.ts))
      .limit(SCOPE_LIMIT)

    for (const m of groupRows) {
      nodes.push({
        id: nodeId('whatsapp_signal', m.id),
        kind: 'whatsapp_signal',
        entityId: m.id,
        label: m.groupName ? `${m.groupName} · ${m.senderName}` : m.senderName,
        summary: truncate(m.text, 160),
        attrs: { channel: 'group', groupJid: m.groupJid, groupName: m.groupName, sender: m.sender },
        occurredAt: new Date(m.ts).toISOString(),
      })
    }

    const dmRows = await db
      .select({
        id: whatsappDmMessages.id,
        personId: whatsappDmMessages.personId,
        fromMe: whatsappDmMessages.fromMe,
        text: whatsappDmMessages.text,
        ts: whatsappDmMessages.ts,
        jid: whatsappDmMessages.whatsappJid,
      })
      .from(whatsappDmMessages)
      .where(gte(whatsappDmMessages.ts, windowStartMs))
      .orderBy(desc(whatsappDmMessages.ts))
      .limit(SCOPE_LIMIT)

    for (const m of dmRows) {
      nodes.push({
        id: nodeId('whatsapp_signal', m.id),
        kind: 'whatsapp_signal',
        entityId: m.id,
        label: m.fromMe ? 'אני · הודעה אישית' : 'הודעה אישית',
        summary: truncate(m.text, 160),
        attrs: { channel: 'dm', jid: m.jid, fromMe: !!m.fromMe, personId: m.personId },
        occurredAt: new Date(m.ts).toISOString(),
      })
      if (m.personId) {
        edges.push({
          fromId: nodeId('person', m.personId),
          toId: nodeId('whatsapp_signal', m.id),
          kind: 'MENTIONED_IN',
          occurredAt: new Date(m.ts).toISOString(),
          attrs: { channel: 'dm', fromMe: !!m.fromMe },
        })
      }
    }
    byScope.whatsapp = groupRows.length + dmRows.length
  }

  if (scopes.has('email')) {
    const rows = await db
      .select({
        id: personEmailThreads.id,
        personId: personEmailThreads.personId,
        gmailThreadId: personEmailThreads.gmailThreadId,
        accountEmail: personEmailThreads.accountEmail,
        subject: personEmailThreads.subject,
        snippet: personEmailThreads.snippet,
        date: personEmailThreads.date,
        messageCount: personEmailThreads.messageCount,
      })
      .from(personEmailThreads)
      .where(gte(personEmailThreads.date, windowStartIso))
      .orderBy(desc(personEmailThreads.date))
      .limit(SCOPE_LIMIT)

    for (const t of rows) {
      nodes.push({
        id: nodeId('email_thread', t.id),
        kind: 'email_thread',
        entityId: t.id,
        label: truncate(t.subject, 90) ?? '(ללא נושא)',
        summary: truncate(t.snippet, 160),
        attrs: {
          // Subject and snippet only — the sync never fetches bodies, and neither does this.
          gmailUrl: gmailThreadUrl(t.gmailThreadId),
          accountEmail: t.accountEmail,
          messageCount: t.messageCount ?? 1,
          personId: t.personId,
        },
        occurredAt: t.date,
      })
      edges.push({
        fromId: nodeId('person', t.personId),
        toId: nodeId('email_thread', t.id),
        kind: 'MENTIONED_IN',
        occurredAt: t.date,
        attrs: { channel: 'email', messageCount: t.messageCount ?? 1 },
      })
    }

    // Provenance, not a guess: `email-sync` stores the thread key as the commitment's
    // `sourceId`, so an email-sourced commitment joins back to its thread exactly.
    if (rows.length > 0) {
      const threadIdByKey = new Map(rows.map((t) => [t.gmailThreadId, t.id] as const))
      const sourced = await db
        .select({ id: commitments.id, sourceId: commitments.sourceId })
        .from(commitments)
        .where(and(eq(commitments.source, 'email'), inArray(commitments.sourceId, [...threadIdByKey.keys()])))
      for (const c of sourced) {
        const threadId = c.sourceId ? threadIdByKey.get(c.sourceId) : undefined
        if (!threadId) continue
        edges.push({
          fromId: nodeId('email_thread', threadId),
          toId: nodeId('commitment', c.id),
          kind: 'RELATED_TO',
          attrs: { via: 'email_source' },
        })
      }
    }
    byScope.email = rows.length
  }

  if (scopes.has('finance')) {
    const rows = await db
      .select({
        id: financeTransactions.id,
        amount: financeTransactions.amount,
        currency: financeTransactions.currency,
        direction: financeTransactions.direction,
        category: financeTransactions.category,
        description: financeTransactions.description,
        transactionDate: financeTransactions.transactionDate,
      })
      .from(financeTransactions)
      .where(gte(financeTransactions.transactionDate, windowStartDate))
      .orderBy(desc(financeTransactions.transactionDate))
      .limit(SCOPE_LIMIT)

    for (const t of rows) {
      const day = dayKey(t.transactionDate)
      nodes.push({
        id: nodeId('financial_event', t.id),
        kind: 'financial_event',
        entityId: t.id,
        label: truncate(t.description, 80) ?? t.category ?? 'תנועה',
        summary: `${t.direction === 'out' ? '-' : '+'}${t.amount} ${t.currency} · ${day ?? t.transactionDate}`,
        attrs: {
          amount: Number(t.amount) || 0,
          currency: t.currency,
          direction: t.direction,
          category: t.category,
          date: day,
        },
        occurredAt: day ? `${day}T12:00:00.000Z` : null,
      })
    }

    // Proximity, not causation: a same-week meeting and spend get linked so the
    // reasoner can weigh them together. The edge carries the day gap to judge by.
    const meetingDays = meetingRows
      .map((m) => ({ id: m.id, ms: middayMs(m.date) }))
      .filter((m): m is { id: string; ms: number } => m.ms !== null)
    for (const t of rows) {
      const txMs = middayMs(t.transactionDate)
      if (txMs === null) continue
      for (const m of meetingDays) {
        const gapDays = Math.abs(txMs - m.ms) / 86400000
        if (!(gapDays <= SPEND_PROXIMITY_DAYS)) continue
        edges.push({
          fromId: nodeId('meeting', m.id),
          toId: nodeId('financial_event', t.id),
          kind: 'TRIGGERED_SPEND',
          weight: 1 - gapDays / (SPEND_PROXIMITY_DAYS + 1),
          occurredAt: dayKey(t.transactionDate),
          attrs: { gapDays },
        })
      }
    }
    byScope.finance = rows.length
  }

  if (scopes.has('voice')) {
    const rows = await db
      .select({
        id: voiceRecordings.id,
        meetingId: voiceRecordings.meetingId,
        duration: voiceRecordings.duration,
        status: voiceRecordings.status,
        transcriptText: voiceRecordings.transcriptText,
        createdAt: voiceRecordings.createdAt,
      })
      .from(voiceRecordings)
      .where(gte(voiceRecordings.createdAt, windowStartIso))
      .orderBy(desc(voiceRecordings.createdAt))
      .limit(SCOPE_LIMIT)

    for (const v of rows) {
      nodes.push({
        id: nodeId('voice_recording', v.id),
        kind: 'voice_recording',
        entityId: v.id,
        label: `הקלטה · ${Math.round((v.duration || 0) / 60)} דק׳`,
        summary: truncate(v.transcriptText, 200),
        attrs: { status: v.status, meetingId: v.meetingId, duration: v.duration },
        occurredAt: v.createdAt,
      })
      if (v.meetingId) {
        edges.push({
          fromId: nodeId('meeting', v.meetingId),
          toId: nodeId('voice_recording', v.id),
          kind: 'RELATED_TO',
          occurredAt: v.createdAt,
        })
      }
    }
    byScope.voice = rows.length
  }

  const nodeCount = await writeNodes(db, nodes, nowIso)
  const edgeCount = await writeEdges(db, edges, nowIso)

  await mirrorToGrag(
    nodes
      .filter((n) => n.summary)
      .slice(0, 50)
      .map((n) => `[${n.kind}] ${n.label}: ${n.summary}`),
  )

  return {
    nodes: nodeCount,
    edges: edgeCount,
    byScope,
    windowStart: windowStartIso,
    durationMs: Date.now() - startedAt,
  }
}

export interface WorldStateSummary {
  nodesByKind: Record<string, number>
  edgesByKind: Record<string, number>
  lastIndexedAt: string | null
}

/** Counts per kind plus the freshness stamp — the cheap half of `harness.worldState`. */
export async function worldStateSummary(db: Db): Promise<WorldStateSummary> {
  const nodeRows = await db.select({ kind: harnessNodes.kind, updatedAt: harnessNodes.updatedAt }).from(harnessNodes)
  const edgeRows = await db.select({ kind: harnessEdges.kind }).from(harnessEdges)

  const nodesByKind: Record<string, number> = {}
  let lastIndexedAt: string | null = null
  for (const r of nodeRows) {
    nodesByKind[r.kind] = (nodesByKind[r.kind] ?? 0) + 1
    if (!lastIndexedAt || r.updatedAt > lastIndexedAt) lastIndexedAt = r.updatedAt
  }
  const edgesByKind: Record<string, number> = {}
  for (const r of edgeRows) edgesByKind[r.kind] = (edgesByKind[r.kind] ?? 0) + 1

  return { nodesByKind, edgesByKind, lastIndexedAt }
}

export interface PersonSignals {
  person: { id: string; name: string }
  meetings: { id: string; label: string; occurredAt: string | null }[]
  commitments: { id: string; label: string; occurredAt: string | null; owner: string | null }[]
  whatsapp: { id: string; label: string; summary: string | null; occurredAt: string | null }[]
  /** Subject + snippet only, with a deep link into the thread in Gmail. */
  emails: {
    id: string
    subject: string
    snippet: string | null
    occurredAt: string | null
    messageCount: number
    gmailUrl: string | null
  }[]
  lastSignalAt: string | null
}

/** Every world-model node reachable from one person, newest first. */
export async function personSignals(db: Db, personId: string): Promise<PersonSignals | null> {
  const [person] = await db.select({ id: people.id, name: people.name }).from(people).where(eq(people.id, personId))
  if (!person) return null

  const outgoing = await db
    .select({ toId: harnessEdges.toId, kind: harnessEdges.kind, attrs: harnessEdges.attrs })
    .from(harnessEdges)
    .where(eq(harnessEdges.fromId, nodeId('person', personId)))

  const targetIds = [...new Set(outgoing.map((e) => e.toId))]
  if (targetIds.length === 0) {
    return { person, meetings: [], commitments: [], whatsapp: [], emails: [], lastSignalAt: null }
  }

  const targets: Awaited<ReturnType<typeof fetchNodes>> = []
  for (let i = 0; i < targetIds.length; i += 200) {
    targets.push(...(await fetchNodes(db, targetIds.slice(i, i + 200))))
  }
  const byId = new Map(targets.map((n) => [n.id, n]))
  const ownerByTarget = new Map(
    outgoing.map((e) => [e.toId, (safeParse(e.attrs) as { owner?: string } | null)?.owner ?? null]),
  )

  const pick = (kind: string) =>
    targets
      .filter((n) => n.kind === kind)
      .sort((a, b) => (b.occurredAt ?? '').localeCompare(a.occurredAt ?? ''))

  let lastSignalAt: string | null = null
  for (const n of targets) {
    if (n.occurredAt && (!lastSignalAt || n.occurredAt > lastSignalAt)) lastSignalAt = n.occurredAt
  }

  return {
    person,
    meetings: pick('meeting')
      .slice(0, 10)
      .map((n) => ({ id: n.id, label: n.label, occurredAt: n.occurredAt })),
    commitments: pick('commitment')
      .slice(0, 10)
      .map((n) => ({ id: n.id, label: n.label, occurredAt: n.occurredAt, owner: ownerByTarget.get(n.id) ?? null })),
    whatsapp: pick('whatsapp_signal')
      .slice(0, 10)
      .map((n) => ({ id: n.id, label: n.label, summary: n.summary, occurredAt: n.occurredAt })),
    emails: pick('email_thread')
      .slice(0, 10)
      .map((n) => {
        const attrs = safeParse(n.attrs) as { gmailUrl?: string | null; messageCount?: number } | null
        return {
          id: n.id,
          subject: n.label,
          snippet: n.summary,
          occurredAt: n.occurredAt,
          messageCount: attrs?.messageCount ?? 1,
          gmailUrl: attrs?.gmailUrl ?? null,
        }
      }),
    lastSignalAt,
  }
  function safeParse(raw: string | null): unknown {
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
}

async function fetchNodes(db: Db, ids: string[]) {
  return db
    .select({
      id: harnessNodes.id,
      kind: harnessNodes.kind,
      label: harnessNodes.label,
      summary: harnessNodes.summary,
      attrs: harnessNodes.attrs,
      occurredAt: harnessNodes.occurredAt,
    })
    .from(harnessNodes)
    .where(inArray(harnessNodes.id, ids))
}

/** Nodes of one kind inside a time window — the reasoner's main read path. */
export async function nodesInWindow(
  db: Db,
  kind: string,
  fromIso: string,
  toIso?: string,
): Promise<Array<{ id: string; label: string; summary: string | null; attrs: string | null; occurredAt: string | null; entityId: string }>> {
  const conditions = [eq(harnessNodes.kind, kind), gte(harnessNodes.occurredAt, fromIso)]
  if (toIso) conditions.push(lte(harnessNodes.occurredAt, toIso))
  return db
    .select({
      id: harnessNodes.id,
      label: harnessNodes.label,
      summary: harnessNodes.summary,
      attrs: harnessNodes.attrs,
      occurredAt: harnessNodes.occurredAt,
      entityId: harnessNodes.entityId,
    })
    .from(harnessNodes)
    .where(and(...conditions))
    .orderBy(desc(harnessNodes.occurredAt))
}
