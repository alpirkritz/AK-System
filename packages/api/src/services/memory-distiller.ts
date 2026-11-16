/**
 * Nightly memory distiller (spec: docs/specs/memory-distiller.md).
 *
 * Reads what happened since the last run (meeting analyses, WhatsApp DM summaries, the owner's
 * own words to Hugo) and PROPOSES durable facts as `memories` rows with status 'proposed'.
 * Nothing is injected until the owner accepts it.
 */
import { and, desc, eq, gt, inArray } from 'drizzle-orm'
import {
  agentMessages,
  chatMessages,
  meetingAnalyses,
  meetings,
  memories,
  memoryLinks,
  people,
  queryRows,
  runMutation,
  userSettings,
  whatsappDmSummaries,
  type getDb,
} from '@ak-system/database'
import { geminiTextModel, parseJsonReply, type TextModel } from '../lib/gemini-text'
import { addMemoryLinks, clearMemoryRelevanceCache, resolveNamedEntities, wordTokens } from './memory-relevance'

type Db = ReturnType<typeof getDb>

const SETTINGS_ID = 'default'
const HUGO_AGENT_ID = '01_Hugo_orchestrator'
export const DISTILL_BATCH = 20
export const DISTILL_MAX_PROPOSALS = 15
export const DISTILL_MIN_CONFIDENCE = 0.6
export const DEDUPE_JACCARD = 0.8

export interface DistillSource {
  sourceKind: 'meeting_analysis' | 'whatsapp_dm_summary' | 'hugo_chat'
  sourceId: string
  sourceDate: string
  label: string
  text: string
}

export interface DistilledFact {
  content: string
  aboutPeople?: string[]
  aboutProjects?: string[]
  topics?: string[]
  sourceId?: string
  replacesMemoryId?: string | null
  confidence?: number
}

// ─── Sources ────────────────────────────────────────────────────────────────

export async function collectDistillSources(db: Db, sinceIso: string): Promise<DistillSource[]> {
  const out: DistillSource[] = []
  const analyses = await queryRows<{
    id: string
    meetingId: string
    topic: string | null
    keyInsight: string | null
    openQuestion: string | null
    actionItemsJson: string | null
    updatedAt: string
    title: string | null
    date: string | null
  }>(
    db
      .select({
        id: meetingAnalyses.id,
        meetingId: meetingAnalyses.meetingId,
        topic: meetingAnalyses.topic,
        keyInsight: meetingAnalyses.keyInsight,
        openQuestion: meetingAnalyses.openQuestion,
        actionItemsJson: meetingAnalyses.actionItemsJson,
        updatedAt: meetingAnalyses.updatedAt,
        title: meetings.title,
        date: meetings.date,
      })
      .from(meetingAnalyses)
      .leftJoin(meetings, eq(meetings.id, meetingAnalyses.meetingId))
      .where(and(eq(meetingAnalyses.status, 'done'), gt(meetingAnalyses.updatedAt, sinceIso)))
      .orderBy(desc(meetingAnalyses.updatedAt))
      .limit(60),
  )
  for (const a of analyses) {
    const text = [a.topic, a.keyInsight, a.openQuestion, a.actionItemsJson?.slice(0, 600)].filter(Boolean).join('\n')
    if (!text.trim()) continue
    out.push({
      sourceKind: 'meeting_analysis',
      sourceId: a.id,
      sourceDate: (a.date ?? a.updatedAt).slice(0, 10),
      label: `פגישת ${a.title ?? 'ללא כותרת'}`,
      text,
    })
  }

  const dms = await queryRows<{ id: string; summary: string; createdAt: string; name: string | null }>(
    db
      .select({ id: whatsappDmSummaries.id, summary: whatsappDmSummaries.summary, createdAt: whatsappDmSummaries.createdAt, name: people.name })
      .from(whatsappDmSummaries)
      .leftJoin(people, eq(people.id, whatsappDmSummaries.personId))
      .where(gt(whatsappDmSummaries.createdAt, sinceIso))
      .limit(60),
  )
  for (const d of dms) {
    if (!d.summary?.trim()) continue
    out.push({ sourceKind: 'whatsapp_dm_summary', sourceId: d.id, sourceDate: d.createdAt.slice(0, 10), label: `וואטסאפ עם ${d.name ?? 'איש קשר'}`, text: d.summary })
  }

  const [hugoTurns, chatTurns] = await Promise.all([
    queryRows<{ id: string; content: string; createdAt: string }>(
      db
        .select({ id: agentMessages.id, content: agentMessages.content, createdAt: agentMessages.createdAt })
        .from(agentMessages)
        .where(and(eq(agentMessages.agentId, HUGO_AGENT_ID), eq(agentMessages.role, 'user'), gt(agentMessages.createdAt, sinceIso)))
        .limit(100),
    ),
    queryRows<{ id: string; content: string; createdAt: string }>(
      db
        .select({ id: chatMessages.id, content: chatMessages.content, createdAt: chatMessages.createdAt })
        .from(chatMessages)
        .where(and(eq(chatMessages.role, 'user'), gt(chatMessages.createdAt, sinceIso)))
        .limit(100),
    ),
  ])
  for (const t of [...hugoTurns, ...chatTurns]) {
    if (!t.content?.trim() || t.content.length < 15) continue
    out.push({ sourceKind: 'hugo_chat', sourceId: t.id, sourceDate: t.createdAt.slice(0, 10), label: 'שיחה עם הוגו', text: t.content.slice(0, 800) })
  }
  return out
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

export function distillPrompt(sources: DistillSource[], existing: Array<{ id: string; content: string }>): string {
  return [
    'You maintain the long-term memory of a busy executive (Alpir). From the SOURCES below, extract only DURABLE facts worth remembering for months:',
    'decisions, changed dates/deadlines, roles and ownership ("X is now responsible for Y"), stable preferences of Alpir, relationships between people/projects.',
    'EXCLUDE: tasks and to-dos, one-off logistics, personality judgements about people, anything already stated in EXISTING MEMORIES (unless it changed — then set replacesMemoryId).',
    'Write each fact in Hebrew, self-contained, at most 200 characters. Never invent; if unsure, lower confidence.',
    'Reply with JSON only: {"facts":[{"content":"…","aboutPeople":["…"],"aboutProjects":["…"],"topics":["…"],"sourceId":"…","replacesMemoryId":null,"confidence":0.0}]}',
    '',
    'EXISTING MEMORIES:',
    ...existing.map((m) => `- [${m.id}] ${m.content}`),
    '',
    'SOURCES:',
    ...sources.map((s) => `### sourceId=${s.sourceId} · ${s.label} · ${s.sourceDate}\n${s.text}`),
  ].join('\n')
}

// ─── Dedupe ─────────────────────────────────────────────────────────────────

export function jaccard(a: string, b: string): number {
  const A = new Set(wordTokens(a))
  const B = new Set(wordTokens(b))
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / (A.size + B.size - inter)
}

// ─── Run ────────────────────────────────────────────────────────────────────

async function readCursor(db: Db): Promise<{ at: string | null; hasRow: boolean }> {
  const rows = await queryRows<{ at: string | null }>(
    db.select({ at: userSettings.memoryDistilledAt }).from(userSettings).where(eq(userSettings.id, SETTINGS_ID)).limit(1),
  )
  return { at: rows[0]?.at ?? null, hasRow: rows.length > 0 }
}

async function writeCursor(db: Db, at: string, hasRow: boolean): Promise<void> {
  if (hasRow) await runMutation(db.update(userSettings).set({ memoryDistilledAt: at }).where(eq(userSettings.id, SETTINGS_ID)))
  else await runMutation(db.insert(userSettings).values({ id: SETTINGS_ID, memoryDistilledAt: at, updatedAt: at }))
}

export async function runMemoryDistiller(
  db: Db,
  options: { sinceHours?: number; now?: Date; model?: TextModel } = {},
): Promise<{ sources: number; proposed: number; dropped: number }> {
  const now = options.now ?? new Date()
  const model = options.model ?? geminiTextModel()
  const cursor = await readCursor(db)
  const since =
    options.sinceHours !== undefined
      ? new Date(now.getTime() - options.sinceHours * 3600_000).toISOString()
      : cursor.at ?? new Date(now.getTime() - 24 * 3600_000).toISOString()

  const sources = await collectDistillSources(db, since)
  if (sources.length === 0) {
    if (options.sinceHours === undefined) await writeCursor(db, now.toISOString(), cursor.hasRow)
    return { sources: 0, proposed: 0, dropped: 0 }
  }

  // Everything the owner has seen — active, proposed, rejected, superseded — feeds dedupe.
  const known = await queryRows<{ id: string; content: string; status: string }>(
    db
      .select({ id: memories.id, content: memories.content, status: memories.status })
      .from(memories)
      .where(inArray(memories.status, ['active', 'proposed', 'rejected', 'superseded']))
      .orderBy(desc(memories.updatedAt))
      .limit(500),
  )
  const activeForPrompt = known.filter((m) => m.status === 'active').slice(0, 150)

  const facts: DistilledFact[] = []
  for (let i = 0; i < sources.length; i += DISTILL_BATCH) {
    const batch = sources.slice(i, i + DISTILL_BATCH)
    const parsed = parseJsonReply(await model(distillPrompt(batch, activeForPrompt))) as { facts?: DistilledFact[] } | null
    for (const f of parsed?.facts ?? []) if (f && typeof f.content === 'string') facts.push(f)
  }

  const bySourceId = new Map(sources.map((s) => [s.sourceId, s]))
  const knownIds = new Set(known.map((m) => m.id))
  let proposed = 0
  let dropped = 0
  const accepted: string[] = []
  for (const f of facts.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))) {
    const content = f.content.trim().slice(0, 200)
    const tooWeak = (f.confidence ?? 0) < DISTILL_MIN_CONFIDENCE
    const duplicate = [...known.map((m) => m.content), ...accepted].some((c) => jaccard(c, content) >= DEDUPE_JACCARD)
    if (!content || tooWeak || duplicate || proposed >= DISTILL_MAX_PROPOSALS) {
      dropped++
      continue
    }
    const { links } = await resolveNamedEntities(db, {
      people: f.aboutPeople ?? [],
      projects: f.aboutProjects ?? [],
      topics: f.topics ?? [],
    })
    const src = f.sourceId ? bySourceId.get(f.sourceId) : undefined
    const id = `mem_${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 7)}`
    const nowIso = now.toISOString()
    await runMutation(
      db.insert(memories).values({
        id,
        content,
        kind: 'memory',
        source: 'auto',
        pinned: false,
        status: 'proposed',
        evidence: JSON.stringify(src ? [{ sourceKind: src.sourceKind, sourceId: src.sourceId, sourceDate: src.sourceDate, label: src.label }] : []),
        replacesMemoryId: f.replacesMemoryId && knownIds.has(f.replacesMemoryId) ? f.replacesMemoryId : null,
        createdAt: nowIso,
        updatedAt: nowIso,
      }),
    )
    if (links.length > 0) await addMemoryLinks(db, id, links, 'auto')
    accepted.push(content)
    proposed++
  }
  if (options.sinceHours === undefined) await writeCursor(db, now.toISOString(), cursor.hasRow)
  return { sources: sources.length, proposed, dropped }
}

// ─── Review ─────────────────────────────────────────────────────────────────

export async function countPendingProposals(db: Db): Promise<number> {
  const rows = await queryRows<{ id: string }>(db.select({ id: memories.id }).from(memories).where(eq(memories.status, 'proposed')))
  return rows.length
}

/** Accept (optionally edited). A proposal that replaces a memory supersedes it and inherits its links. */
export async function acceptProposal(
  db: Db,
  id: string,
  edit: { content?: string; links?: Array<{ kind: 'person' | 'project' | 'workspace' | 'topic' | 'agent'; entityId: string }> } = {},
): Promise<void> {
  const [row] = await queryRows<{ id: string; replacesMemoryId: string | null }>(
    db.select({ id: memories.id, replacesMemoryId: memories.replacesMemoryId }).from(memories).where(eq(memories.id, id)).limit(1),
  )
  if (!row) throw new Error('proposal not found')
  const now = new Date().toISOString()
  await runMutation(
    db
      .update(memories)
      .set({ status: 'active', ...(edit.content ? { content: edit.content.trim() } : {}), updatedAt: now })
      .where(eq(memories.id, id)),
  )
  if (edit.links) {
    await runMutation(db.delete(memoryLinks).where(eq(memoryLinks.memoryId, id)))
    await addMemoryLinks(db, id, edit.links, 'manual')
  }
  if (row.replacesMemoryId) {
    const oldLinks = await queryRows<{ entityKind: string; entityId: string }>(
      db.select({ entityKind: memoryLinks.entityKind, entityId: memoryLinks.entityId }).from(memoryLinks).where(eq(memoryLinks.memoryId, row.replacesMemoryId)),
    )
    if (oldLinks.length > 0) {
      await addMemoryLinks(
        db,
        id,
        oldLinks.map((l) => ({ kind: l.entityKind as 'person', entityId: l.entityId })),
        'auto',
      )
    }
    await runMutation(db.update(memories).set({ status: 'superseded', updatedAt: now }).where(eq(memories.id, row.replacesMemoryId)))
  }
  clearMemoryRelevanceCache(db)
}

export async function rejectProposals(db: Db, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  await runMutation(
    db
      .update(memories)
      .set({ status: 'rejected', updatedAt: new Date().toISOString() })
      .where(and(inArray(memories.id, ids), eq(memories.status, 'proposed'))),
  )
  return ids.length
}
