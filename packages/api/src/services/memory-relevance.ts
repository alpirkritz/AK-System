/**
 * Entity-scoped Hugo memory (spec: docs/specs/hugo-entity-memory.md).
 *
 * A memory with no `memory_links` row is global and eligible for every run. A linked memory is
 * injected only when one of its entities is an anchor of the run — a person, project, workspace
 * or topic named in the message, the recent turns, or the prefetched calendar. Matching is
 * deterministic (names, aliases, topic tokens); no LLM, no embeddings.
 */
import { and, desc, eq, inArray, ne, notInArray, or, sql } from 'drizzle-orm'
import {
  hugoInstructions,
  memories,
  memoryLinks,
  people,
  personAliases,
  projects,
  queryRows,
  runMutation,
  userSettings,
  workspaces,
  type getDb,
  type MemoryLinkKind,
  type MemoryLinkOrigin,
} from '@ak-system/database'
import { topicTokens } from '../lib/topic-match'
import { normalizeAlias, resolvePerson } from './person-resolution'

type Db = ReturnType<typeof getDb>

export const MEMORY_CHAR_CAP = 12000
/** Scoped memories injected per anchored entity; `recall_memories` has no cap. */
export const PER_ENTITY_CAP = 8
/** Standing rules linked to one agent (agent-feedback-loop). */
export const AGENT_RULE_CAP = 20
/** Global memories considered per run (the pre-scoping behaviour read 60). */
const GLOBAL_LIMIT = 60
const DIRECTORY_TTL_MS = 5 * 60 * 1000
const SETTINGS_ID = 'default'

export const MEMORY_TRUNCATION_MARKER =
  '\n[⚠️ ההוראות הקבועות נחתכו כאן — קצר אותן בעמוד /memory כדי שכולן ייכנסו]'

export interface EntityRef {
  kind: MemoryLinkKind
  entityId: string
  label: string
}

export interface MemoryRowLite {
  id: string
  content: string
  kind: string
  pinned: boolean | number
  updatedAt: string
}

// ─── Text tokenisation ──────────────────────────────────────────────────────

const NIQQUD = /[֑-ׇ]/g
const GERESH = /[׳'’`´]/g
/** One-letter Hebrew prefixes glued to a name: ו ה ב כ ל מ ש (שדן, לדן, ועם…). */
const HEBREW_PREFIX = /^[והבכלמש]/
const HEBREW_CHAR = /[א-ת]/

/** Lowercased word tokens in reading order (not sorted, unlike normalizeAlias). */
export function wordTokens(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(NIQQUD, '')
    .replace(GERESH, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean)
}

/** The token itself, plus the token without a one-letter Hebrew prefix. */
function tokenVariants(token: string): string[] {
  if (token.length > 2 && HEBREW_CHAR.test(token[0]) && HEBREW_PREFIX.test(token)) {
    return [token, token.slice(1)]
  }
  return [token]
}

/**
 * Whole-word match of `phrase` tokens as a contiguous run inside `text` tokens.
 * Only the first token of the run may carry a Hebrew prefix ("שדן כהן").
 * Returns the index of the first match, or -1.
 */
export function findPhrase(textTokens: string[], phraseTokens: string[]): number {
  if (phraseTokens.length === 0) return -1
  outer: for (let i = 0; i + phraseTokens.length <= textTokens.length; i++) {
    if (!tokenVariants(textTokens[i]).includes(phraseTokens[0])) continue
    for (let j = 1; j < phraseTokens.length; j++) {
      if (textTokens[i + j] !== phraseTokens[j]) continue outer
    }
    return i
  }
  return -1
}

// ─── Entity directory (cached) ──────────────────────────────────────────────

interface DirectoryEntry {
  kind: Exclude<MemoryLinkKind, 'topic'>
  entityId: string
  label: string
  tokens: string[]
}

interface Directory {
  /** Phrase → entries. A phrase that maps to two different people is ambiguous and skipped. */
  entries: DirectoryEntry[]
  topicTokens: Set<string>
  labels: Map<string, string>
  loadedAt: number
}

const directoryCache = new WeakMap<object, Directory>()

/** Drop the cached directory — call after writing links or renaming entities. */
export function clearMemoryRelevanceCache(db?: Db): void {
  if (db) directoryCache.delete(db as object)
}

function labelKey(kind: string, id: string): string {
  return `${kind}:${id}`
}

async function loadDirectory(db: Db, now = Date.now()): Promise<Directory> {
  const cached = directoryCache.get(db as object)
  if (cached && now - cached.loadedAt < DIRECTORY_TTL_MS) return cached

  const [personRows, aliasRows, projectRows, workspaceRows, topicRows] = await Promise.all([
    queryRows<{ id: string; name: string }>(
      db.select({ id: people.id, name: people.name }).from(people).where(ne(people.status, 'ignored')),
    ),
    queryRows<{ personId: string; alias: string }>(
      db.select({ personId: personAliases.personId, alias: personAliases.alias }).from(personAliases),
    ),
    queryRows<{ id: string; name: string }>(db.select({ id: projects.id, name: projects.name }).from(projects)),
    queryRows<{ id: string; name: string }>(db.select({ id: workspaces.id, name: workspaces.name }).from(workspaces)),
    queryRows<{ entityId: string }>(
      db
        .selectDistinct({ entityId: memoryLinks.entityId })
        .from(memoryLinks)
        .where(eq(memoryLinks.entityKind, 'topic')),
    ),
  ])

  const labels = new Map<string, string>()
  const usablePeople = new Map(personRows.map((p) => [p.id, p.name]))
  const personPhrases = new Map<string, Set<string>>()
  const addPersonPhrase = (phrase: string, personId: string) => {
    const key = wordTokens(phrase).join(' ')
    if (key.replace(/ /g, '').length < 2) return
    const set = personPhrases.get(key) ?? new Set<string>()
    set.add(personId)
    personPhrases.set(key, set)
  }
  for (const p of personRows) {
    labels.set(labelKey('person', p.id), p.name)
    addPersonPhrase(p.name, p.id)
  }
  for (const a of aliasRows) {
    if (usablePeople.has(a.personId)) addPersonPhrase(a.alias, a.personId)
  }

  const entries: DirectoryEntry[] = []
  for (const [phrase, ids] of personPhrases) {
    if (ids.size !== 1) continue
    const [personId] = [...ids]
    entries.push({ kind: 'person', entityId: personId, label: usablePeople.get(personId) ?? phrase, tokens: phrase.split(' ') })
  }
  for (const [kind, rows] of [['project', projectRows], ['workspace', workspaceRows]] as const) {
    for (const row of rows) {
      labels.set(labelKey(kind, row.id), row.name)
      const tokens = wordTokens(row.name)
      if (tokens.join('').length < 3) continue
      entries.push({ kind, entityId: row.id, label: row.name, tokens })
    }
  }
  // Longer phrases first, so "דן כהן" wins its position before "דן".
  entries.sort((a, b) => b.tokens.length - a.tokens.length)

  const topics = new Set(topicRows.map((t) => t.entityId))
  for (const t of topics) labels.set(labelKey('topic', t), t)

  const dir: Directory = { entries, topicTokens: topics, labels, loadedAt: now }
  directoryCache.set(db as object, dir)
  return dir
}

// ─── Anchors ────────────────────────────────────────────────────────────────

/**
 * Entities named in `texts`, in order of first appearance across the texts (message first,
 * then history, then calendar). Topics are only those already used by some memory link.
 */
export async function extractAnchors(db: Db, texts: string[]): Promise<EntityRef[]> {
  const dir = await loadDirectory(db)
  const out: EntityRef[] = []
  const seen = new Set<string>()
  const push = (ref: EntityRef) => {
    const key = labelKey(ref.kind, ref.entityId)
    if (seen.has(key)) return
    seen.add(key)
    out.push(ref)
  }
  for (const text of texts) {
    if (!text) continue
    const tokens = wordTokens(text)
    const hits: Array<{ at: number; ref: EntityRef }> = []
    for (const entry of dir.entries) {
      const at = findPhrase(tokens, entry.tokens)
      if (at >= 0) hits.push({ at, ref: { kind: entry.kind, entityId: entry.entityId, label: entry.label } })
    }
    // Stored topic tokens are already distinctive (topicTokens drops generic words), so a
    // whole-word presence check is enough — and catches "dd" written in lower case.
    for (const t of dir.topicTokens) {
      const at = findPhrase(tokens, t.split(' '))
      if (at >= 0) hits.push({ at, ref: { kind: 'topic', entityId: t, label: t } })
    }
    hits.sort((a, b) => a.at - b.at).forEach((h) => push(h.ref))
  }
  return out
}

/** Links a memory's content implies — the same matcher as run anchors. */
export async function suggestMemoryLinks(db: Db, content: string): Promise<EntityRef[]> {
  return extractAnchors(db, [content])
}

// ─── Name resolution for the remember / recall tools ────────────────────────

export interface NamedEntities {
  people?: string[]
  projects?: string[]
  workspace?: string | null
  topics?: string[]
}

export async function resolveNamedEntities(
  db: Db,
  named: NamedEntities,
): Promise<{ links: EntityRef[]; unresolved: string[] }> {
  const dir = await loadDirectory(db)
  const links: EntityRef[] = []
  const unresolved: string[] = []
  const add = (ref: EntityRef) => {
    if (!links.some((l) => l.kind === ref.kind && l.entityId === ref.entityId)) links.push(ref)
  }

  for (const name of named.people ?? []) {
    const trimmed = name.trim()
    if (!trimmed) continue
    const res = await resolvePerson(db, { name: trimmed })
    if (res.kind === 'match') {
      add({ kind: 'person', entityId: res.personId, label: dir.labels.get(labelKey('person', res.personId)) ?? trimmed })
    } else {
      unresolved.push(trimmed)
    }
  }

  const byName = (kind: 'project' | 'workspace', name: string) => {
    const norm = normalizeAlias(name)
    return dir.entries.find((e) => e.kind === kind && normalizeAlias(e.label) === norm)
  }
  const named2 = [
    ...(named.projects ?? []).map((n) => ['project', n] as const),
    ...(named.workspace ? [['workspace', named.workspace] as const] : []),
  ]
  for (const [kind, name] of named2) {
    const trimmed = name.trim()
    if (!trimmed) continue
    const hit = byName(kind, trimmed)
    if (hit) add({ kind, entityId: hit.entityId, label: hit.label })
    else unresolved.push(trimmed)
  }

  for (const topic of named.topics ?? []) {
    for (const token of normalizeTopic(topic)) add({ kind: 'topic', entityId: token, label: token })
  }
  return { links, unresolved }
}

/** Topic → stored tokens. "DD" → ["dd"]; "Algo 4.0" → ["algo"]. */
export function normalizeTopic(topic: string): string[] {
  const tokens = topicTokens(topic)
  if (tokens.length > 0) return tokens
  const raw = wordTokens(topic).join(' ')
  return raw.length >= 2 ? [raw] : []
}

// ─── Link storage ───────────────────────────────────────────────────────────

export function linkId(memoryId: string, kind: string, entityId: string): string {
  return `ml_${memoryId}_${kind}_${entityId}`
}

export async function replaceMemoryLinks(
  db: Db,
  memoryId: string,
  links: Array<{ kind: MemoryLinkKind; entityId: string }>,
  origin: MemoryLinkOrigin,
): Promise<void> {
  await runMutation(db.delete(memoryLinks).where(eq(memoryLinks.memoryId, memoryId)))
  await addMemoryLinks(db, memoryId, links, origin)
}

export async function addMemoryLinks(
  db: Db,
  memoryId: string,
  links: Array<{ kind: MemoryLinkKind; entityId: string }>,
  origin: MemoryLinkOrigin,
): Promise<void> {
  const now = new Date().toISOString()
  const seen = new Set<string>()
  for (const l of links) {
    const id = linkId(memoryId, l.kind, l.entityId)
    if (seen.has(id)) continue
    seen.add(id)
    await runMutation(
      db
        .insert(memoryLinks)
        .values({ id, memoryId, entityKind: l.kind, entityId: l.entityId, origin, createdAt: now })
        .onConflictDoNothing(),
    )
  }
  clearMemoryRelevanceCache(db)
}

/** Labelled links for a set of memories. */
export async function linksForMemories(db: Db, memoryIds: string[]): Promise<Map<string, EntityRef[]>> {
  const out = new Map<string, EntityRef[]>()
  if (memoryIds.length === 0) return out
  const rows = await queryRows<{ memoryId: string; entityKind: string; entityId: string }>(
    db
      .select({ memoryId: memoryLinks.memoryId, entityKind: memoryLinks.entityKind, entityId: memoryLinks.entityId })
      .from(memoryLinks)
      .where(inArray(memoryLinks.memoryId, memoryIds)),
  )
  const dir = await loadDirectory(db)
  for (const r of rows) {
    const list = out.get(r.memoryId) ?? []
    list.push({
      kind: r.entityKind as MemoryLinkKind,
      entityId: r.entityId,
      label: dir.labels.get(labelKey(r.entityKind, r.entityId)) ?? r.entityId,
    })
    out.set(r.memoryId, list)
  }
  return out
}

/** Remove links to a deleted entity. Memories left unlinked become global. */
export async function deleteLinksForEntity(db: Db, kind: MemoryLinkKind, entityId: string): Promise<void> {
  await runMutation(
    db.delete(memoryLinks).where(and(eq(memoryLinks.entityKind, kind), eq(memoryLinks.entityId, entityId))),
  )
  clearMemoryRelevanceCache(db)
}

/** Move links on merge (people, workspaces); a memory linked to both keeps a single link. */
export async function moveEntityMemoryLinks(
  db: Db,
  kind: MemoryLinkKind,
  fromId: string,
  toId: string,
): Promise<void> {
  if (fromId === toId) return
  const rows = await queryRows<{ memoryId: string; origin: string }>(
    db
      .select({ memoryId: memoryLinks.memoryId, origin: memoryLinks.origin })
      .from(memoryLinks)
      .where(and(eq(memoryLinks.entityKind, kind), eq(memoryLinks.entityId, fromId))),
  )
  for (const r of rows) {
    await addMemoryLinks(db, r.memoryId, [{ kind, entityId: toId }], r.origin as MemoryLinkOrigin)
  }
  await deleteLinksForEntity(db, kind, fromId)
}

// ─── Selection + rendering ──────────────────────────────────────────────────

export interface ScopedGroup {
  anchor: EntityRef
  memories: MemoryRowLite[]
}

export interface MemorySelection {
  instructions: string
  global: MemoryRowLite[]
  scoped: ScopedGroup[]
  /** Scoped memories that matched an anchor but fell past the per-entity cap. */
  overCap: MemoryRowLite[]
}

const isPinned = (m: { pinned: boolean | number }) => m.pinned === true || m.pinned === 1

async function readInstructions(db: Db): Promise<string> {
  const rows = await queryRows<{ content: string; enabled: boolean | number }>(
    db.select().from(hugoInstructions).where(eq(hugoInstructions.id, 'default')).limit(1),
  )
  const row = rows[0]
  return row && (row.enabled === true || row.enabled === 1) ? (row.content || '').trim() : ''
}

const MEMORY_COLS = {
  id: memories.id,
  content: memories.content,
  kind: memories.kind,
  pinned: memories.pinned,
  updatedAt: memories.updatedAt,
}

export async function selectMemoriesForRun(db: Db, anchors: EntityRef[]): Promise<MemorySelection> {
  const linkedIds = db.select({ id: memoryLinks.memoryId }).from(memoryLinks)
  const [instructions, global] = await Promise.all([
    readInstructions(db),
    queryRows<MemoryRowLite>(
      db
        .select(MEMORY_COLS)
        .from(memories)
        .where(and(eq(memories.status, 'active'), notInArray(memories.id, linkedIds)))
        .orderBy(desc(memories.pinned), desc(memories.updatedAt))
        .limit(GLOBAL_LIMIT),
    ),
  ])

  const scoped: ScopedGroup[] = []
  const overCap: MemoryRowLite[] = []
  if (anchors.length > 0) {
    const anchorFilter = or(
      ...anchors.map((a) => and(eq(memoryLinks.entityKind, a.kind), eq(memoryLinks.entityId, a.entityId))),
    )
    const links = await queryRows<{ memoryId: string; entityKind: string; entityId: string }>(
      db
        .select({ memoryId: memoryLinks.memoryId, entityKind: memoryLinks.entityKind, entityId: memoryLinks.entityId })
        .from(memoryLinks)
        .where(anchorFilter),
    )
    const ids = [...new Set(links.map((l) => l.memoryId))]
    const rows = ids.length
      ? await queryRows<MemoryRowLite>(
          db.select(MEMORY_COLS).from(memories).where(and(eq(memories.status, 'active'), inArray(memories.id, ids))),
        )
      : []
    const byId = new Map(rows.map((r) => [r.id, r]))
    const hits = new Map<string, number>()
    for (const l of links) hits.set(l.memoryId, (hits.get(l.memoryId) ?? 0) + 1)
    const rank = (a: MemoryRowLite, b: MemoryRowLite) =>
      (hits.get(b.id) ?? 0) - (hits.get(a.id) ?? 0) ||
      Number(isPinned(b)) - Number(isPinned(a)) ||
      b.updatedAt.localeCompare(a.updatedAt)

    const placed = new Set<string>()
    for (const anchor of anchors) {
      const cap = anchor.kind === 'agent' ? AGENT_RULE_CAP : PER_ENTITY_CAP
      const mine = links
        .filter((l) => l.entityKind === anchor.kind && l.entityId === anchor.entityId && !placed.has(l.memoryId))
        .map((l) => byId.get(l.memoryId))
        .filter((m): m is MemoryRowLite => Boolean(m))
        .sort(rank)
      const unique = mine.filter((m, i) => mine.findIndex((x) => x.id === m.id) === i)
      unique.forEach((m) => placed.add(m.id))
      if (unique.length === 0) continue
      scoped.push({ anchor, memories: unique.slice(0, cap) })
      overCap.push(...unique.slice(cap))
    }
  }
  return { instructions, global, scoped, overCap }
}

function memoryLine(m: Pick<MemoryRowLite, 'content' | 'kind' | 'pinned'>): string {
  const label = m.kind === 'knowledge' ? 'ידע' : m.kind === 'instruction' ? 'הוראה' : 'זיכרון'
  const pin = isPinned(m) ? '📌 ' : ''
  return `- ${pin}[${label}] ${m.content.trim()}`
}

const SCOPED_KIND_LABEL: Record<MemoryLinkKind, string> = {
  person: '',
  project: 'פרויקט ',
  workspace: 'workspace ',
  topic: 'נושא ',
  agent: '',
}

/**
 * Pure renderer. Budget order: standing instructions → pinned global → scoped groups →
 * remaining global. Never cuts a memory line; returns what did not fit in `dropped`.
 */
export function renderMemoryBlock(
  selection: Pick<MemorySelection, 'instructions' | 'global' | 'scoped'>,
  charCap: number = MEMORY_CHAR_CAP,
): { block: string; dropped: string[] } {
  const { instructions, global, scoped } = selection
  const dropped: string[] = []
  if (!instructions && global.length === 0 && scoped.length === 0) return { block: '', dropped }

  const parts: string[] = ['## הוראות וזיכרון קבועים מהמשתמש (User instructions & memory)']
  parts.push(
    'These persist across sessions and take priority over defaults. Follow the instructions; use the memory/knowledge as context. Memories under a person/project/topic heading apply to that entity only.',
  )
  let budget = charCap

  if (instructions) {
    let block = instructions
    if (block.length > budget) {
      const cut = block.lastIndexOf('\n', budget)
      block = block.slice(0, cut > budget / 2 ? cut : budget) + MEMORY_TRUNCATION_MARKER
    }
    budget -= block.length
    parts.push('', '### הוראות קבועות (standing instructions)', block)
  }

  const take = (rows: MemoryRowLite[] | Array<Pick<MemoryRowLite, 'content' | 'kind' | 'pinned'>>): string[] => {
    const lines: string[] = []
    for (const m of rows) {
      const line = memoryLine(m)
      if (budget <= 200 || line.length > budget) {
        dropped.push(m.content)
        continue
      }
      lines.push(line)
      budget -= line.length + 1
    }
    return lines
  }

  const agentSections: string[] = []
  for (const group of scoped.filter((g) => g.anchor.kind === 'agent')) {
    const lines = take(group.memories)
    if (lines.length === 0) continue
    agentSections.push('', '### כללים לסוכן הזה (agent rules — follow them in this run)', ...lines)
  }
  const pinnedGlobal = take(global.filter(isPinned))
  const scopedSections: string[] = []
  for (const group of scoped.filter((g) => g.anchor.kind !== 'agent')) {
    const lines = take(group.memories)
    if (lines.length === 0) continue
    const heading = `### זיכרון — ${SCOPED_KIND_LABEL[group.anchor.kind]}${group.anchor.label}`
    budget -= heading.length + 1
    scopedSections.push('', heading, ...lines)
  }
  const restGlobal = take(global.filter((m) => !isPinned(m)))

  parts.push(...agentSections)
  const globalLines = [...pinnedGlobal, ...restGlobal]
  if (globalLines.length > 0) parts.push('', '### זיכרון וידע (memories & knowledge)', ...globalLines)
  parts.push(...scopedSections)
  return { block: parts.join('\n'), dropped }
}

export interface RelevantMemoryResult {
  block: string
  anchors: EntityRef[]
  dropped: string[]
}

/** Full pipeline used by the agent engine and by `memory.relevant`. */
export async function buildRelevantMemoryBlock(
  db: Db,
  input: { texts: string[]; charCap?: number; agentId?: string | null },
): Promise<RelevantMemoryResult> {
  await ensureMemoryLinksBackfilled(db)
  const found = await extractAnchors(db, input.texts)
  // The running agent is always an anchor, so its own rules are injected and nobody else's.
  const anchors: EntityRef[] = input.agentId
    ? [{ kind: 'agent', entityId: input.agentId, label: input.agentId }, ...found]
    : found
  const selection = await selectMemoriesForRun(db, anchors)
  const { block, dropped } = renderMemoryBlock(selection, input.charCap)
  return { block, anchors, dropped: [...dropped, ...selection.overCap.map((m) => m.content)] }
}

/** Every memory linked to an entity (no cap), plus global memories containing `query`. */
export async function recallMemories(
  db: Db,
  input: { links: EntityRef[]; query?: string | null },
): Promise<{ scoped: ScopedGroup[]; matchingGlobal: MemoryRowLite[] }> {
  const scoped: ScopedGroup[] = []
  for (const anchor of input.links) {
    const rows = await queryRows<MemoryRowLite>(
      db
        .select(MEMORY_COLS)
        .from(memories)
        .innerJoin(memoryLinks, eq(memoryLinks.memoryId, memories.id))
        .where(
          and(
            eq(memoryLinks.entityKind, anchor.kind),
            eq(memoryLinks.entityId, anchor.entityId),
            eq(memories.status, 'active'),
          ),
        )
        .orderBy(desc(memories.pinned), desc(memories.updatedAt)),
    )
    scoped.push({ anchor, memories: rows })
  }
  let matchingGlobal: MemoryRowLite[] = []
  const q = input.query?.trim().toLowerCase()
  if (q) {
    const linkedIds = db.select({ id: memoryLinks.memoryId }).from(memoryLinks)
    matchingGlobal = await queryRows<MemoryRowLite>(
      db
        .select(MEMORY_COLS)
        .from(memories)
        .where(
          and(
            eq(memories.status, 'active'),
            notInArray(memories.id, linkedIds),
            sql`lower(${memories.content}) like ${`%${q}%`}`,
          ),
        )
        .orderBy(desc(memories.updatedAt))
        .limit(50),
    )
  }
  return { scoped, matchingGlobal }
}

// ─── One-shot backfill ──────────────────────────────────────────────────────

let backfillChecked = new WeakSet<object>()

/** Test hook. */
export function resetMemoryBackfillCheck(): void {
  backfillChecked = new WeakSet<object>()
}

export async function ensureMemoryLinksBackfilled(db: Db): Promise<void> {
  if (backfillChecked.has(db as object)) return
  backfillChecked.add(db as object)
  try {
    const rows = await queryRows<{ at: string | null }>(
      db
        .select({ at: userSettings.memoryLinksBackfilledAt })
        .from(userSettings)
        .where(eq(userSettings.id, SETTINGS_ID))
        .limit(1),
    )
    if (rows[0]?.at) return
    await backfillMemoryLinks(db)
    const at = new Date().toISOString()
    if (rows.length > 0) {
      await runMutation(
        db.update(userSettings).set({ memoryLinksBackfilledAt: at, updatedAt: at }).where(eq(userSettings.id, SETTINGS_ID)),
      )
    } else {
      await runMutation(db.insert(userSettings).values({ id: SETTINGS_ID, memoryLinksBackfilledAt: at, updatedAt: at }))
    }
  } catch (err) {
    console.warn('[memory-relevance] backfill failed; will retry next process start', err)
  }
}

/** Link every unlinked, non-instruction memory by its content. Idempotent. Returns links written. */
export async function backfillMemoryLinks(db: Db): Promise<number> {
  const linkedIds = db.select({ id: memoryLinks.memoryId }).from(memoryLinks)
  const rows = await queryRows<{ id: string; content: string }>(
    db
      .select({ id: memories.id, content: memories.content })
      .from(memories)
      .where(and(ne(memories.kind, 'instruction'), notInArray(memories.id, linkedIds))),
  )
  let written = 0
  for (const row of rows) {
    const links = await suggestMemoryLinks(db, row.content)
    if (links.length === 0) continue
    await addMemoryLinks(db, row.id, links, 'backfill')
    written += links.length
  }
  return written
}
