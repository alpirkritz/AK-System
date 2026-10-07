/**
 * Sync Notion tasks + the Notion people directory into the app database.
 *
 * Pulls tasks assigned to the user (`NOTION_USER_NAME`) and tasks linked to
 * known people via Assignee or a People-directory relation (including
 * unconfigured directories resolved by title → existing person name), upserts
 * configured people DBs into `people`, and links every synced task via
 * `tasks.assigneeId` + `task_people`. Also sets `tasks.projectId` when a
 * Projects relation matches a local `projects.notionPageId`.
 *
 * Self-contained (mirrors `notion-ibkr-import.ts`): reads Notion config from env
 * (`NOTION_ACCOUNTS`, or legacy `NOTION_API_KEY`) and talks to the Notion REST
 * API directly, so it does not depend on the web app's Notion client. Dedupes by
 * Notion page id, so re-running is idempotent.
 *
 * The 60-day window uses Notion `created_time` / `last_edited_time` timestamp
 * filters (no named date property required, since task-DB property names vary).
 */

import {
  getDb,
  people,
  personExternalIds,
  projects,
  companies,
  meetings,
  tasks,
  taskPeople,
  workspaces,
  workspaceNotionDatabases,
  peopleNotionSources,
  notionStatusOverrides,
  eq,
  and,
  inArray,
} from '@ak-system/database'
import { ensureSelfPerson, getSelfPersonName, isSelfPersonName } from './self-person'
import { upsertPersonExternalId } from './person-external-ids'
import {
  fetchDatabaseProperties,
  fetchPeopleDirectoryIndex,
  findPeopleRelation,
  type PeopleRelationInfo,
} from './notion-people-directory'

const NOTION_VERSION = '2022-06-28'

/** Canonical task status values (mirrors TASK_STATUSES in the database schema). */
export type CanonicalStatus =
  | 'not_started'
  | 'pending'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | 'cancelled'

/** Historical task databases used when only legacy `NOTION_API_KEY` is set. */
const LEGACY_TASK_DATABASES = [
  { id: '181e7d50-cb8e-8101-9d8a-e90aa8f9b3ac', name: 'Personal To-do' },
  { id: 'a38dba80-f058-4009-b8d9-bce763f10542', name: 'DT - Action items' },
  { id: '20fe7d50-cb8e-805a-9730-cfb2b6e2bfe6', name: 'Con Action items' },
]

type Db = ReturnType<typeof getDb>
type NotionProp = Record<string, unknown>

interface NotionDb {
  token: string
  databaseId: string
  name: string
  accountLabel: string
  /**
   * Pinned per-field property names for a self-service source (see notion-people-full-field-sync)
   * — undefined for env-configured databases, which use type/name heuristics instead. When
   * present for a given field, that exact name is read directly rather than guessed.
   */
  phonePropertyName?: string | null
  rolePropertyName?: string | null
  companyPropertyName?: string | null
  linkedinPropertyName?: string | null
}

export interface NotionTasksSyncResult {
  peopleCreated: number
  peopleUpdated: number
  tasksCreated: number
  tasksUpdated: number
  tasksSkipped: number
  tasksPruned: number
  errors: string[]
}

export interface NotionTasksSyncOptions {
  /** How far back to look, in days (default 60). */
  windowDays?: number
  /** When true, computes counts without writing to the DB. */
  dryRun?: boolean
}

// ─── Config resolution ───────────────────────────────────────────────────────

const getUserName = getSelfPersonName

export type NotionDbType =
  | 'tasks'
  | 'people'
  | 'projects'
  | 'companies'
  | 'meeting_notes'
  | 'meetings'

interface ParsedNotionAccount {
  label: string
  token: string
  databases: Array<{ id: string; name?: string; type?: string }>
}

/** Parses `NOTION_ACCOUNTS` once per call — cheap, and env can change between test cases. */
function parseNotionAccounts(): ParsedNotionAccount[] {
  const raw = process.env.NOTION_ACCOUNTS?.trim()
  if (!raw) return []
  try {
    const data = JSON.parse(raw) as unknown
    if (!Array.isArray(data)) return []
    const out: ParsedNotionAccount[] = []
    for (const acc of data as Array<Record<string, unknown>>) {
      const token = typeof acc?.token === 'string' ? acc.token.trim() : ''
      if (!token) continue
      const label = typeof acc?.label === 'string' && acc.label.trim() ? acc.label.trim() : 'Notion'
      const dbs = Array.isArray(acc?.databases) ? (acc.databases as Array<Record<string, unknown>>) : []
      out.push({
        label,
        token,
        databases: dbs
          .filter((db) => typeof db?.id === 'string' && (db.id as string).trim())
          .map((db) => ({
            id: (db.id as string).trim(),
            name: typeof db.name === 'string' ? db.name : undefined,
            type: typeof db.type === 'string' ? db.type : undefined,
          })),
      })
    }
    return out
  } catch {
    return []
  }
}

/** Account labels configured in `NOTION_ACCOUNTS` (for the "which account" picker). */
export function listNotionAccountLabels(): string[] {
  return parseNotionAccounts().map((acc) => acc.label)
}

/** Resolves a configured account's token by label — never exposed to the client. */
export function findNotionAccountToken(accountLabel: string): string | null {
  return parseNotionAccounts().find((acc) => acc.label === accountLabel)?.token ?? null
}

/** Databases of a given Notion type across all configured accounts. */
export function resolveDatabases(type: NotionDbType): NotionDb[] {
  const out: NotionDb[] = []
  for (const acc of parseNotionAccounts()) {
    for (const db of acc.databases) {
      if (db.type === type) {
        out.push({ token: acc.token, databaseId: db.id, name: db.name ?? type, accountLabel: acc.label })
      }
    }
  }
  if (out.length === 0 && type === 'tasks') {
    const token = process.env.NOTION_API_KEY?.trim()
    if (token) {
      const label = getUserName()
      for (const db of LEGACY_TASK_DATABASES) {
        out.push({ token, databaseId: db.id, name: db.name, accountLabel: label })
      }
    }
  }
  return out
}

/**
 * `people`-type databases: env-configured ones plus any self-service `people_notion_sources`
 * rows added via Settings (see `notion-people-source-manager` spec). A custom row whose
 * `accountLabel` no longer matches a configured account is skipped and reported in `errors`
 * rather than silently dropped.
 */
export async function resolvePeopleDatabases(db: Db): Promise<{ databases: NotionDb[]; errors: string[] }> {
  const databases = resolveDatabases('people')
  const errors: string[] = []
  const customRows = await db.select().from(peopleNotionSources)
  for (const row of customRows) {
    const token = findNotionAccountToken(row.accountLabel)
    if (!token) {
      errors.push(`people-source/${row.notionDatabaseName ?? row.notionDatabaseId}: לא נמצא חשבון Notion בשם "${row.accountLabel}"`)
      continue
    }
    databases.push({
      token,
      databaseId: row.notionDatabaseId,
      name: row.notionDatabaseName ?? 'Notion',
      accountLabel: row.accountLabel,
      phonePropertyName: row.phonePropertyName,
      rolePropertyName: row.rolePropertyName,
      companyPropertyName: row.companyPropertyName,
      linkedinPropertyName: row.linkedinPropertyName,
    })
  }
  return { databases, errors }
}

/**
 * Pulls the 32-char Notion id out of a pasted share link ("Copy link") or a bare id, with or
 * without dashes. Returns it re-dashed in the canonical 8-4-4-4-12 form Notion's API expects,
 * or null when nothing 32-hex-long is found.
 *
 * Deliberately does NOT strip dashes up front: a real Notion share link looks like
 * `.../Page-Title-<32hexid>?v=...`, and the hyphen right before the id is the only thing
 * separating it from a title slug whose last word can itself end in a hex letter (e.g.
 * "...People-<id>" — the trailing "e" in "People" is hex-valid). Stripping dashes first would
 * glue that letter onto the id and shift the match. Instead: try the classic dashed-UUID shape
 * first (a bare id the user pasted already dashed), then fall back to the longest *maximal* run
 * of exactly 32 hex characters — one not touching another hex character on either side — which
 * naturally respects the hyphen boundary Notion's own links rely on.
 */
export function extractNotionDatabaseId(link: string): string | null {
  const trimmed = link.trim()
  const dashed = trimmed.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/)
  if (dashed) return dashed[0].toLowerCase()
  const bare = trimmed.match(/(?<![0-9a-fA-F])[0-9a-fA-F]{32}(?![0-9a-fA-F])/)
  if (!bare) return null
  const hex = bare[0].toLowerCase()
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * `tasks` databases: env-configured ones plus any paste-a-link rows in
 * `workspace_notion_databases` (see `notion-task-source-manager`). A custom row whose
 * `accountLabel` no longer matches a configured account is skipped and reported in `errors`.
 * Env ids are not duplicated. A link with a null `accountLabel` that is not in the env list
 * is skipped with the same error — the row exists but the token cannot be resolved.
 */
export async function resolveTaskDatabases(db: Db): Promise<{ databases: NotionDb[]; errors: string[] }> {
  const databases = resolveDatabases('tasks')
  const errors: string[] = []
  const known = new Set(databases.map((d) => d.databaseId))
  const links = await db.select().from(workspaceNotionDatabases)
  for (const row of links) {
    if (known.has(row.notionDatabaseId)) continue
    const name = row.notionDatabaseName ?? row.notionDatabaseId
    const token = row.accountLabel ? findNotionAccountToken(row.accountLabel) : null
    if (!token) {
      errors.push(`task-source/${name}: לא נמצא חשבון Notion בשם "${row.accountLabel ?? ''}"`)
      continue
    }
    databases.push({
      token,
      databaseId: row.notionDatabaseId,
      name: row.notionDatabaseName ?? 'Notion',
      accountLabel: row.accountLabel!,
    })
    known.add(row.notionDatabaseId)
  }
  return { databases, errors }
}

/** True when at least one Notion `tasks` database is configured in env (legacy check). */
export function isNotionTasksConfigured(): boolean {
  return resolveDatabases('tasks').length > 0
}

/** Notion `tasks` databases resolvable from env (for the workspace-link picker). */
export function listConfiguredTaskDatabases(): Array<{
  notionDatabaseId: string
  name: string
  accountLabel: string
}> {
  return resolveDatabases('tasks').map((d) => ({
    notionDatabaseId: d.databaseId,
    name: d.name,
    accountLabel: d.accountLabel,
  }))
}

/** Ids of every configured `people` database — the strongest signal for a people relation target. */
export function listConfiguredPeopleDatabaseIds(): string[] {
  return resolveDatabases('people').map((d) => d.databaseId)
}

/**
 * Credentials for writing back to the database a synced task came from. Tasks record the
 * account label and database name at sync time; the name narrows it when one account owns
 * several task databases, but the label alone is enough to pick the token.
 */
export async function resolveTaskDatabaseTarget(
  accountLabel: string | null | undefined,
  dbName?: string | null,
  db: Db = getDb(),
): Promise<{ token: string; databaseId: string } | null> {
  const { databases: dbs } = await resolveTaskDatabases(db)
  if (dbs.length === 0) return null
  const label = (accountLabel ?? '').trim().toLowerCase()
  const name = (dbName ?? '').trim().toLowerCase()
  const inAccount = label ? dbs.filter((d) => d.accountLabel.trim().toLowerCase() === label) : dbs
  const pool = inAccount.length > 0 ? inAccount : dbs
  const exact = name ? pool.find((d) => d.name.trim().toLowerCase() === name) : undefined
  const hit = exact ?? pool[0]
  return hit ? { token: hit.token, databaseId: hit.databaseId } : null
}

/**
 * The Notion database a new task in this workspace should be created in, resolved from
 * `workspaceNotionDatabases`. A workspace linked to several databases uses the first one
 * linked (by link creation order) — deliberately simple; see notion-task-create-push spec.
 * Returns `null` when the workspace has no link, or the link points at a database whose
 * account/token is no longer configured (env changed since linking).
 */
export async function resolveWorkspaceNotionTarget(
  workspaceId: string,
): Promise<{ token: string; databaseId: string; accountLabel: string; name: string } | null> {
  const db = getDb()
  const links = await db
    .select()
    .from(workspaceNotionDatabases)
    .where(eq(workspaceNotionDatabases.workspaceId, workspaceId))
    .orderBy(workspaceNotionDatabases.createdAt)
  const link = links[0]
  if (!link) return null

  const hit = resolveDatabases('tasks').find((d) => d.databaseId === link.notionDatabaseId)
  if (hit) return { token: hit.token, databaseId: hit.databaseId, accountLabel: hit.accountLabel, name: hit.name }

  const token = link.accountLabel ? findNotionAccountToken(link.accountLabel) : null
  if (!token || !link.accountLabel) return null
  return {
    token,
    databaseId: link.notionDatabaseId,
    accountLabel: link.accountLabel,
    name: link.notionDatabaseName ?? 'Notion',
  }
}

/**
 * Name and kind of the property a task's status lives in. Mirrors `getStatusRaw`'s precedence
 * so the write path targets exactly the property the read path parsed.
 */
export function findStatusPropertyName(
  properties: Record<string, { type?: string }>,
): { name: string; type: 'status' | 'select' } | null {
  let fallback: { name: string; type: 'select' } | null = null
  for (const [name, prop] of Object.entries(properties)) {
    const lname = name.toLowerCase()
    if (lname.includes('priority') || name.includes('עדיפות')) continue
    if (prop?.type === 'status') return { name, type: 'status' }
    if (prop?.type === 'select' && (lname.includes('status') || name.includes('סטטוס'))) {
      if (!fallback) fallback = { name, type: 'select' }
    }
  }
  return fallback
}

// ─── Notion REST ───────────────────────────────────────────────────────────

async function queryDatabase(
  token: string,
  databaseId: string,
  filter?: Record<string, unknown>,
): Promise<Array<{ id: string; properties: Record<string, NotionProp> }>> {
  const pages: Array<{ id: string; properties: Record<string, NotionProp> }> = []
  let cursor: string | undefined
  do {
    const body: Record<string, unknown> = { page_size: 100 }
    if (cursor) body.start_cursor = cursor
    if (filter) body.filter = filter
    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Notion API ${res.status}: ${err.slice(0, 200)}`)
    }
    const data = (await res.json()) as {
      results: Array<{ id: string; properties: Record<string, NotionProp> }>
      has_more: boolean
      next_cursor: string | null
    }
    pages.push(...data.results)
    cursor = data.has_more ? data.next_cursor ?? undefined : undefined
  } while (cursor)
  return pages
}

/** Recent-activity filter: created OR last-edited within the last `windowDays`. */
function recentActivityFilter(windowDays: number): Record<string, unknown> {
  const cutoff = new Date(Date.now() - windowDays * 86400000).toISOString()
  return {
    or: [
      { timestamp: 'created_time', created_time: { on_or_after: cutoff } },
      { timestamp: 'last_edited_time', last_edited_time: { on_or_after: cutoff } },
    ],
  }
}

// ─── Property parsers ────────────────────────────────────────────────────────

function richTextValue(prop: NotionProp): string {
  const t = prop.type as string
  if (t === 'title') {
    return ((prop.title as Array<{ plain_text?: string }>) ?? []).map((x) => x.plain_text ?? '').join('')
  }
  if (t === 'rich_text') {
    return ((prop.rich_text as Array<{ plain_text?: string }>) ?? []).map((x) => x.plain_text ?? '').join('')
  }
  if (t === 'select' && prop.select) return (prop.select as { name?: string }).name ?? ''
  if (t === 'status' && prop.status) return (prop.status as { name?: string }).name ?? ''
  if (t === 'email' && typeof prop.email === 'string') return prop.email
  return ''
}

function getTitle(props: Record<string, NotionProp>): string {
  for (const v of Object.values(props)) {
    if (v?.type === 'title') return richTextValue(v).trim()
  }
  return ''
}

/**
 * Raw Notion status/select label for a task page. Prefers a real `status`-type
 * property; falls back to a `select` named "status"/"סטטוס". Priority props are
 * excluded so they never masquerade as a status.
 */
function getStatusRaw(props: Record<string, NotionProp>): string {
  let fallback = ''
  for (const [name, v] of Object.entries(props)) {
    const lname = name.toLowerCase()
    if (lname.includes('priority') || name.includes('עדיפות')) continue
    if (v?.type === 'status') {
      const val = richTextValue(v).trim()
      if (val) return val
    }
    if (v?.type === 'select' && (lname.includes('status') || name.includes('סטטוס'))) {
      const val = richTextValue(v).trim()
      if (val && !fallback) fallback = val
    }
  }
  return fallback
}

/** Canonical status guess from a literal Notion label, by keyword bucket. */
export function guessCanonicalStatus(rawStatus: string): CanonicalStatus {
  const s = rawStatus.trim().toLowerCase()
  if (!s) return 'not_started'
  if (/(cancel|archiv|won'?t\s*do|wont\s*do|dropped|בוטל|בוטלה)/.test(s)) return 'cancelled'
  if (/(done|complete|closed|resolved|finished|בוצע|הושלם|הסתיים|הסתיימה)/.test(s)) return 'done'
  // Explicit "not started" family must precede the in-progress check ("started" ⊂ "not started").
  if (/(not\s*started|todo|to\s*do|backlog|לא\s*התחיל|לא\s*החל)/.test(s)) return 'not_started'
  // "Waiting on something" (pending) is distinct from "blocked by something" (blocked).
  if (/(pending|awaiting|waiting|on\s*hold|hold|paused|בהמתנה|ממתין|מושהה)/.test(s)) return 'pending'
  if (/(block|stuck|חסום|תקוע)/.test(s)) return 'blocked'
  if (/(in\s*progress|doing|active|started|testing|בתהליך|בעבוד|בביצוע|בבדיקה)/.test(s)) {
    return 'in_progress'
  }
  return 'not_started'
}

/** Override map wins (exact, case-insensitive); otherwise fall back to the keyword guess. */
export function resolveCanonicalStatus(
  rawStatus: string,
  overrides: Map<string, CanonicalStatus>,
): CanonicalStatus {
  const key = rawStatus.trim().toLowerCase()
  if (key) {
    const hit = overrides.get(key)
    if (hit) return hit
  }
  return guessCanonicalStatus(rawStatus)
}

/** First date property, normalized to YYYY-MM-DD. */
function getDueDate(props: Record<string, NotionProp>): string | null {
  for (const v of Object.values(props)) {
    if (v?.type === 'date' && v.date) {
      const start = (v.date as { start?: string }).start ?? ''
      if (start) return start.slice(0, 10)
    }
  }
  return null
}

/** Task priority (high | medium | low) from a select/status property. */
function getPriority(props: Record<string, NotionProp>): 'high' | 'medium' | 'low' {
  for (const [name, v] of Object.entries(props)) {
    if (name.toLowerCase().includes('priority') && (v?.type === 'select' || v?.type === 'status')) {
      const val = richTextValue(v).toLowerCase()
      if (val.includes('high') || val.includes('urgent') || val.includes('critical')) return 'high'
      if (val.includes('low')) return 'low'
      return 'medium'
    }
  }
  return 'medium'
}

/** Names from every `people`-type property (Notion users assigned to the page). */
function getPeopleNames(props: Record<string, NotionProp>): string[] {
  const names: string[] = []
  for (const v of Object.values(props)) {
    if (v?.type === 'people') {
      for (const p of (v.people as Array<{ name?: string }>) ?? []) {
        if (p?.name) names.push(p.name.trim())
      }
    }
  }
  return names
}

/** Related page ids from every `relation`-type property (legacy fallback). */
function getRelationPageIds(props: Record<string, NotionProp>): string[] {
  const ids: string[] = []
  for (const v of Object.values(props)) {
    if (v?.type === 'relation' && Array.isArray(v.relation)) {
      for (const r of v.relation as Array<{ id?: string }>) {
        if (r?.id) ids.push(r.id)
      }
    }
  }
  return ids
}

/** Page ids from one named relation property. */
function getNamedRelationPageIds(props: Record<string, NotionProp>, propertyName: string): string[] {
  const v = props[propertyName]
  if (!v || v.type !== 'relation' || !Array.isArray(v.relation)) return []
  const ids: string[] = []
  for (const r of v.relation as Array<{ id?: string }>) {
    if (r?.id) ids.push(r.id)
  }
  return ids
}

/** Project page ids from relation properties named like Projects / פרויקט. */
function getProjectRelationPageIds(props: Record<string, NotionProp>): string[] {
  const ids: string[] = []
  for (const [name, v] of Object.entries(props)) {
    if (v?.type !== 'relation' || !Array.isArray(v.relation)) continue
    if (!/project|פרויקט/i.test(name)) continue
    for (const r of v.relation as Array<{ id?: string }>) {
      if (r?.id) ids.push(r.id)
    }
  }
  return ids
}

function getMeetingRelationPageIds(props: Record<string, NotionProp>): string[] {
  const ids: string[] = []
  for (const [name, v] of Object.entries(props)) {
    if (v?.type !== 'relation' || !Array.isArray(v.relation)) continue
    if (!/meeting|פגישה|ישיבה/i.test(name)) continue
    for (const r of v.relation as Array<{ id?: string }>) {
      if (r?.id) ids.push(r.id)
    }
  }
  return ids
}

/** Email from an `email`-type property, if present. */
function getEmail(props: Record<string, NotionProp>): string | null {
  for (const v of Object.values(props)) {
    if (v?.type === 'email' && typeof v.email === 'string' && v.email.trim()) return v.email.trim()
  }
  return null
}

// ─── Full-field people sync (phone / role / company / linkedin) ─────────────
// See docs/specs/notion-people-full-field-sync.md. Two mechanisms:
//  - env-configured databases: heuristics only (type match, name-pattern tiebreak when ambiguous)
//  - self-service sources: a pinned property name chosen once at add-time, read directly

const ROLE_NAME_HINT = /role|position|job|תפקיד/i
const COMPANY_RELATION_NAME = /company|companies|חברה|לקוח/i
const LINKEDIN_URL_NAME = /linkedin/i

/** Generic by-type readers — used both by the heuristics below and to read a pinned property. */
function readPhoneNumber(v: NotionProp): string | null {
  return v?.type === 'phone_number' && typeof v.phone_number === 'string' && v.phone_number.trim()
    ? (v.phone_number as string).trim()
    : null
}
function readRichText(v: NotionProp): string | null {
  if (v?.type !== 'rich_text') return null
  const text = richTextValue(v).trim()
  return text || null
}
function readRelationId(v: NotionProp): string | null {
  if (v?.type !== 'relation') return null
  const ids = (v.relation as Array<{ id?: string }> | undefined) ?? []
  return ids[0]?.id ?? null
}
function readUrl(v: NotionProp): string | null {
  return v?.type === 'url' && typeof v.url === 'string' && v.url.trim() ? (v.url as string).trim() : null
}

/** Reads a pinned property by exact name; a missing/renamed property is a silent skip. */
function readPinned(
  props: Record<string, NotionProp>,
  name: string | null | undefined,
  reader: (v: NotionProp) => string | null,
): string | null {
  if (!name) return null
  const v = props[name]
  return v ? reader(v) : null
}

/** Heuristic: exactly one candidate, or exactly one matching `nameHint` among several. */
function pickHeuristic(
  props: Record<string, NotionProp>,
  reader: (v: NotionProp) => string | null,
  typeOf: (v: NotionProp) => boolean,
  nameHint?: RegExp,
): string | null {
  const candidates = Object.entries(props).filter(([, v]) => typeOf(v))
  if (candidates.length === 1) return reader(candidates[0][1])
  if (candidates.length > 1 && nameHint) {
    const hinted = candidates.filter(([name]) => nameHint.test(name))
    if (hinted.length === 1) return reader(hinted[0][1])
  }
  return null
}

function getPhoneHeuristic(props: Record<string, NotionProp>): string | null {
  return pickHeuristic(props, readPhoneNumber, (v) => v?.type === 'phone_number')
}
function getRoleHeuristic(props: Record<string, NotionProp>): string | null {
  return pickHeuristic(props, readRichText, (v) => v?.type === 'rich_text', ROLE_NAME_HINT)
}
function getCompanyRelationPageIdHeuristic(props: Record<string, NotionProp>): string | null {
  return pickHeuristic(props, readRelationId, (v) => v?.type === 'relation', COMPANY_RELATION_NAME)
}
function getLinkedinHeuristic(props: Record<string, NotionProp>): string | null {
  return pickHeuristic(props, readUrl, (v) => v?.type === 'url', LINKEDIN_URL_NAME)
}

export interface FieldMappingCandidate {
  candidates: string[]
  auto: string | null
}

export interface DatabaseFieldMappings {
  phone: FieldMappingCandidate
  role: FieldMappingCandidate
  company: FieldMappingCandidate
  linkedin: FieldMappingCandidate
}

/**
 * For the add-source modal's "בדוק" preview: which property (if any) would be auto-picked for
 * each of the four fields, and what else is available to choose from when it's ambiguous.
 */
export function resolveDatabaseFieldMappings(
  properties: Record<string, { type?: string; relation?: { database_id?: string } }>,
): DatabaseFieldMappings {
  const props = properties as Record<string, NotionProp>
  const namesOfType = (typeOf: (v: NotionProp) => boolean) =>
    Object.entries(props).filter(([, v]) => typeOf(v)).map(([name]) => name)

  return {
    phone: {
      candidates: namesOfType((v) => v?.type === 'phone_number'),
      auto: pickHeuristicName(props, (v) => v?.type === 'phone_number'),
    },
    role: {
      candidates: namesOfType((v) => v?.type === 'rich_text'),
      auto: pickHeuristicName(props, (v) => v?.type === 'rich_text', ROLE_NAME_HINT),
    },
    company: {
      candidates: namesOfType((v) => v?.type === 'relation'),
      auto: pickHeuristicName(props, (v) => v?.type === 'relation', COMPANY_RELATION_NAME),
    },
    linkedin: {
      candidates: namesOfType((v) => v?.type === 'url'),
      auto: pickHeuristicName(props, (v) => v?.type === 'url', LINKEDIN_URL_NAME),
    },
  }
}

/** Same precedence as `pickHeuristic`, but returns the winning property NAME rather than its value. */
function pickHeuristicName(
  props: Record<string, NotionProp>,
  typeOf: (v: NotionProp) => boolean,
  nameHint?: RegExp,
): string | null {
  const candidates = Object.entries(props).filter(([, v]) => typeOf(v))
  if (candidates.length === 1) return candidates[0][0]
  if (candidates.length > 1 && nameHint) {
    const hinted = candidates.filter(([name]) => nameHint.test(name))
    if (hinted.length === 1) return hinted[0][0]
  }
  return null
}

// ─── People matching helpers ─────────────────────────────────────────────────

interface PersonRow {
  id: string
  name: string
  email: string | null
  notionPageId: string | null
  companyId?: string | null
  status?: string | null
  phone?: string | null
  role?: string | null
  linkedin?: string | null
}

interface PeopleMaps {
  byNotionId: Map<string, PersonRow>
  byEmail: Map<string, PersonRow>
  byName: Map<string, PersonRow>
}

function buildPeopleMaps(rows: PersonRow[]): PeopleMaps {
  const byNotionId = new Map<string, PersonRow>()
  const byEmail = new Map<string, PersonRow>()
  const byName = new Map<string, PersonRow>()
  for (const r of rows) {
    if (r.notionPageId) byNotionId.set(r.notionPageId, r)
    if (r.email) byEmail.set(r.email.toLowerCase(), r)
    byName.set(r.name.toLowerCase(), r)
  }
  return { byNotionId, byEmail, byName }
}

async function loadPeopleMaps(db: Db): Promise<PeopleMaps> {
  const existingPeople = (await db
    .select({
      id: people.id,
      name: people.name,
      email: people.email,
      notionPageId: people.notionPageId,
      companyId: people.companyId,
      status: people.status,
      phone: people.phone,
      role: people.role,
      linkedin: people.linkedin,
    })
    .from(people)) as PersonRow[]
  const maps = buildPeopleMaps(existingPeople)
  const identities = await db
    .select({
      personId: personExternalIds.personId,
      externalId: personExternalIds.externalId,
    })
    .from(personExternalIds)
    .where(eq(personExternalIds.provider, 'notion'))
  const byId = new Map(existingPeople.map((p) => [p.id, p]))
  for (const row of identities) {
    const person = byId.get(row.personId)
    if (person) maps.byNotionId.set(row.externalId, person)
  }
  return maps
}

function newId(prefix: string): string {
  return prefix + Date.now() + Math.random().toString(36).slice(2, 7)
}

// ─── Workspace mapping ───────────────────────────────────────────────────────

/** Lowercased `notionAccountLabel` -> workspace id. Workspaces without a label are skipped. */
export function buildWorkspaceLabelMap(
  rows: Array<{ id: string; notionAccountLabel: string | null }>,
): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of rows) {
    const label = row.notionAccountLabel?.trim().toLowerCase()
    if (label) map.set(label, row.id)
  }
  return map
}

/**
 * Workspace for a synced task. An explicit database-id link is the strongest
 * signal and wins outright. Otherwise fall back to the legacy label match, where
 * the database name beats the account label (a single account can hold databases
 * for several business contexts).
 */
export function resolveWorkspaceId(
  labels: Map<string, string>,
  database: { name: string; accountLabel: string; databaseId?: string },
  byDatabaseId?: Map<string, string>,
): string | null {
  if (database.databaseId && byDatabaseId) {
    const hit = byDatabaseId.get(database.databaseId)
    if (hit) return hit
  }
  return (
    labels.get(database.name.trim().toLowerCase()) ??
    labels.get(database.accountLabel.trim().toLowerCase()) ??
    null
  )
}

// ─── Main sync ───────────────────────────────────────────────────────────────

export async function syncNotionTasks(
  opts: NotionTasksSyncOptions = {},
  db: Db = getDb(),
): Promise<NotionTasksSyncResult> {
  const windowDays = opts.windowDays ?? 60
  const dryRun = opts.dryRun ?? false
  const result: NotionTasksSyncResult = {
    peopleCreated: 0,
    peopleUpdated: 0,
    tasksCreated: 0,
    tasksUpdated: 0,
    tasksSkipped: 0,
    tasksPruned: 0,
    errors: [],
  }

  const taskResolution = await resolveTaskDatabases(db)
  const taskDbs = taskResolution.databases
  result.errors.push(...taskResolution.errors)
  if (taskDbs.length === 0) {
    throw new Error('לא הוגדר בסיס נתונים של משימות ב-Notion — הוסף אותו ל-NOTION_ACCOUNTS')
  }
  const peopleResolution = await resolvePeopleDatabases(db)
  const peopleDbs = peopleResolution.databases
  result.errors.push(...peopleResolution.errors)
  const now = new Date().toISOString()

  // Load current people + all Notion external identities into lookup maps.
  const maps = await loadPeopleMaps(db)

  const registerPerson = (row: PersonRow): void => {
    if (row.notionPageId) maps.byNotionId.set(row.notionPageId, row)
    if (row.email) maps.byEmail.set(row.email.toLowerCase(), row)
    maps.byName.set(row.name.toLowerCase(), row)
  }

  const accountKeyFor = (database: NotionDb) =>
    `${database.accountLabel}::${database.name}`

  // Notion company relation → local company id, for resolving the `company` field below.
  // Best-effort: if `notionGraph.sync` (which owns company creation) hasn't run yet this cycle,
  // a not-yet-existing company simply resolves on a later sync — same as `projectId` below.
  const companyRows = await db.select({ id: companies.id, notionPageId: companies.notionPageId }).from(companies)
  const companyIdByNotionPageId = new Map<string, string>()
  for (const c of companyRows) {
    if (c.notionPageId) companyIdByNotionPageId.set(c.notionPageId, c.id)
  }

  /** Pinned name (self-service source) if set, else the heuristic (env source). */
  function resolveField(
    database: NotionDb,
    props: Record<string, NotionProp>,
    pinnedName: string | null | undefined,
    reader: (v: NotionProp) => string | null,
    heuristic: (props: Record<string, NotionProp>) => string | null,
  ): string | null {
    if (pinnedName !== undefined) return readPinned(props, pinnedName, reader)
    return heuristic(props)
  }

  // ── People pass: upsert every configured Notion people directory ──
  for (const database of peopleDbs) {
    let pages: Array<{ id: string; properties: Record<string, NotionProp> }>
    try {
      pages = await queryDatabase(database.token, database.databaseId)
    } catch (err) {
      result.errors.push(`people/${database.name}: ${err instanceof Error ? err.message : 'query failed'}`)
      continue
    }
    for (const page of pages) {
      const name = getTitle(page.properties)
      if (!name) continue
      const email = getEmail(page.properties)
      const phone = resolveField(database, page.properties, database.phonePropertyName, readPhoneNumber, getPhoneHeuristic)
      const role = resolveField(database, page.properties, database.rolePropertyName, readRichText, getRoleHeuristic)
      const companyNotionPageId = resolveField(
        database, page.properties, database.companyPropertyName, readRelationId, getCompanyRelationPageIdHeuristic,
      )
      const companyId = companyNotionPageId ? companyIdByNotionPageId.get(companyNotionPageId) ?? null : null
      const linkedin = resolveField(database, page.properties, database.linkedinPropertyName, readUrl, getLinkedinHeuristic)

      const byNotion = maps.byNotionId.get(page.id)
      const byEmail = email ? maps.byEmail.get(email.toLowerCase()) : undefined
      const byName = maps.byName.get(name.toLowerCase())

      // Never auto-merge two confirmed people with conflicting non-null emails.
      let existing = byNotion
      if (!existing && byEmail) existing = byEmail
      if (!existing && byName) {
        if (
          email &&
          byName.email &&
          byName.email.toLowerCase() !== email.toLowerCase() &&
          byName.status === 'confirmed'
        ) {
          existing = undefined
        } else {
          existing = byName
        }
      }

      if (existing) {
        if (!dryRun) {
          const fieldUpdates: Partial<{
            notionPageId: string
            phone: string
            role: string
            companyId: string
            linkedin: string
          }> = {}
          if (!existing.notionPageId) fieldUpdates.notionPageId = page.id
          if (!existing.phone && phone) fieldUpdates.phone = phone
          if (!existing.role && role) fieldUpdates.role = role
          if (!existing.companyId && companyId) fieldUpdates.companyId = companyId
          if (!existing.linkedin && linkedin) fieldUpdates.linkedin = linkedin

          if (Object.keys(fieldUpdates).length > 0) {
            await db.update(people).set(fieldUpdates).where(eq(people.id, existing.id))
            Object.assign(existing, fieldUpdates)
            result.peopleUpdated++
          }
          await upsertPersonExternalId(db, {
            personId: existing.id,
            provider: 'notion',
            accountKey: accountKeyFor(database),
            externalId: page.id,
            displayName: name,
          })
        }
        maps.byNotionId.set(page.id, existing)
        continue
      }

      const id = newId('p_notion_')
      const row: PersonRow = {
        id,
        name,
        email: email ?? null,
        notionPageId: page.id,
        status: 'confirmed',
        phone: phone ?? null,
        role: role ?? null,
        companyId: companyId ?? null,
        linkedin: linkedin ?? null,
      }
      if (!dryRun) {
        await db.insert(people).values({
          id,
          name,
          email: email ?? null,
          role: role ?? null,
          phone: phone ?? null,
          companyId: companyId ?? null,
          linkedin: linkedin ?? null,
          color: '#e8c547',
          status: 'confirmed',
          source: 'notion',
          notionPageId: page.id,
          createdAt: now,
        })
        await upsertPersonExternalId(db, {
          personId: id,
          provider: 'notion',
          accountKey: accountKeyFor(database),
          externalId: page.id,
          displayName: name,
        })
      }
      registerPerson(row)
      maps.byNotionId.set(page.id, row)
      result.peopleCreated++
    }
  }

  // Ensure a person row exists for the user. Shared with the app's default-assignee
  // resolution so both paths point at the same contact instead of duplicating it.
  const userName = getUserName()
  let userPerson = maps.byName.get(userName.toLowerCase())
  if (!userPerson) {
    const id = dryRun ? newId('p_me_') : (await ensureSelfPerson(db)).id
    userPerson = { id, name: userName, email: null, notionPageId: null }
    registerPerson(userPerson)
    result.peopleCreated++
  }

  // ── Index People directories discovered from task-DB schemas (often unconfigured) ──
  // Match directory page titles to existing people by name; never create contacts.
  const configuredPeopleIds = listConfiguredPeopleDatabaseIds()
  const indexedDirectoryIds = new Set(peopleDbs.map((d) => d.databaseId))
  const peopleRelationByTaskDb = new Map<string, PeopleRelationInfo | null>()

  for (const database of taskDbs) {
    let relation: PeopleRelationInfo | null = null
    try {
      const schemaProps = await fetchDatabaseProperties(database.token, database.databaseId)
      relation = findPeopleRelation(schemaProps, database.databaseId, configuredPeopleIds)
    } catch (err) {
      result.errors.push(
        `tasks-schema/${database.name}: ${err instanceof Error ? err.message : 'schema fetch failed'}`,
      )
      peopleRelationByTaskDb.set(database.databaseId, null)
      continue
    }
    peopleRelationByTaskDb.set(database.databaseId, relation)
    if (!relation || indexedDirectoryIds.has(relation.targetDatabaseId)) continue

    try {
      const index = await fetchPeopleDirectoryIndex(database.token, relation.targetDatabaseId)
      const accountKey = `${database.accountLabel}::people-dir::${relation.targetDatabaseId}`
      for (const [pageId, title] of index.byPageId) {
        const person = maps.byName.get(title.toLowerCase())
        if (!person) continue
        maps.byNotionId.set(pageId, person)
        if (!dryRun) {
          await upsertPersonExternalId(db, {
            personId: person.id,
            provider: 'notion',
            accountKey,
            externalId: pageId,
            displayName: title,
          })
        }
      }
      indexedDirectoryIds.add(relation.targetDatabaseId)
    } catch (err) {
      result.errors.push(
        `people-dir/${relation.propertyName}: ${err instanceof Error ? err.message : 'query failed'}`,
      )
    }
  }

  // ── Tasks pass ──
  const filter = recentActivityFilter(windowDays)
  const fetchedPageIds = new Set<string>()
  const keptPageIds = new Set<string>()

  // Preload existing notion-sourced tasks for idempotent upsert.
  const existingNotionTasks = await db
    .select({ id: tasks.id, notionPageId: tasks.notionPageId, meetingId: tasks.meetingId })
    .from(tasks)
    .where(eq(tasks.source, 'notion'))
  const taskIdByPage = new Map<string, string>()
  const existingTaskMeetingId = new Map<string, string | null>()
  for (const t of existingNotionTasks) {
    if (t.notionPageId) {
      taskIdByPage.set(t.notionPageId, t.id)
      existingTaskMeetingId.set(t.notionPageId, t.meetingId)
    }
  }

  const projectRows = await db
    .select({ id: projects.id, notionPageId: projects.notionPageId })
    .from(projects)
  const projectByNotionId = new Map<string, string>()
  for (const p of projectRows) {
    if (p.notionPageId) projectByNotionId.set(p.notionPageId, p.id)
  }

  const meetingRows = await db
    .select({ id: meetings.id, notionPageId: meetings.notionPageId })
    .from(meetings)
  const meetingByNotionPageId = new Map<string, string>()
  for (const m of meetingRows) {
    if (m.notionPageId) meetingByNotionPageId.set(m.notionPageId, m.id)
  }

  const workspaceRows = await db
    .select({ id: workspaces.id, notionAccountLabel: workspaces.notionAccountLabel })
    .from(workspaces)
  const workspaceLabels = buildWorkspaceLabelMap(workspaceRows)

  // Explicit database-id → workspace links (preferred over the label match).
  const linkRows = await db
    .select({
      workspaceId: workspaceNotionDatabases.workspaceId,
      notionDatabaseId: workspaceNotionDatabases.notionDatabaseId,
    })
    .from(workspaceNotionDatabases)
  const workspaceByDbId = new Map<string, string>()
  for (const r of linkRows) workspaceByDbId.set(r.notionDatabaseId, r.workspaceId)

  // User overrides for canonical status resolution (lowercased raw label → status).
  const overrideRows = await db
    .select({
      rawLabel: notionStatusOverrides.rawLabel,
      canonicalStatus: notionStatusOverrides.canonicalStatus,
    })
    .from(notionStatusOverrides)
  const statusOverrides = new Map<string, CanonicalStatus>()
  for (const r of overrideRows) {
    statusOverrides.set(r.rawLabel.trim().toLowerCase(), r.canonicalStatus as CanonicalStatus)
  }

  for (const database of taskDbs) {
    const workspaceId = resolveWorkspaceId(workspaceLabels, database, workspaceByDbId)
    let pages: Array<{ id: string; properties: Record<string, NotionProp> }>
    try {
      pages = await queryDatabase(database.token, database.databaseId, filter)
    } catch (err) {
      result.errors.push(`tasks/${database.name}: ${err instanceof Error ? err.message : 'query failed'}`)
      continue
    }

    const peopleRel = peopleRelationByTaskDb.get(database.databaseId) ?? null

    for (const page of pages) {
      fetchedPageIds.add(page.id)
      const props = page.properties
      const title = getTitle(props)
      if (!title) {
        result.tasksSkipped++
        continue
      }

      // Resolve assignees + People-relation links → known people.
      const assigneeNames = getPeopleNames(props)
      const relationIds = peopleRel
        ? getNamedRelationPageIds(props, peopleRel.propertyName)
        : getRelationPageIds(props)
      const matched = new Map<string, PersonRow>()
      let userIsAssignee = false
      for (const n of assigneeNames) {
        if (n.toLowerCase() === userName.toLowerCase() || isSelfPersonName(n)) {
          userIsAssignee = true
          continue
        }
        const p = maps.byName.get(n.toLowerCase())
        if (p && !isSelfPersonName(p.name)) matched.set(p.id, p)
      }
      for (const relId of relationIds) {
        const p = maps.byNotionId.get(relId)
        if (!p) continue
        if (p.id === userPerson.id || isSelfPersonName(p.name)) {
          userIsAssignee = true
          continue
        }
        matched.set(p.id, p)
      }

      // Keep task if it's the user's or belongs to at least one known person.
      if (!userIsAssignee && matched.size === 0) {
        result.tasksSkipped++
        continue
      }

      const matchedIds = [...matched.keys()]
      const assigneeId = userIsAssignee ? userPerson.id : (matchedIds[0] ?? null)
      const projectId =
        getProjectRelationPageIds(props)
          .map((rid) => projectByNotionId.get(rid))
          .find(Boolean) ?? null
      const meetingId =
        getMeetingRelationPageIds(props)
          .map((rid) => meetingByNotionPageId.get(rid))
          .find(Boolean) ?? null
      const dueDate = getDueDate(props)
      const priority = getPriority(props)
      const notionStatusRaw = getStatusRaw(props)
      const status = resolveCanonicalStatus(notionStatusRaw, statusOverrides)
      const done = status === 'done' || status === 'cancelled'
      keptPageIds.add(page.id)

      const existingTaskId = taskIdByPage.get(page.id)
      if (existingTaskId) {
        const currentMeetingId = existingTaskMeetingId.get(page.id) ?? null
        // Non-wipe rule: only set meetingId if Notion has one or if local doesn't have one
        const shouldUpdateMeetingId = meetingId !== null || currentMeetingId === null
        if (!dryRun) {
          await db
            .update(tasks)
            .set({
              title,
              dueDate,
              priority,
              status,
              done,
              notionStatusRaw: notionStatusRaw || null,
              assigneeId,
              projectId,
              ...(shouldUpdateMeetingId ? { meetingId } : {}),
              workspaceId,
              notionAccount: database.accountLabel,
              notionDb: database.name,
              updatedAt: now,
            })
            .where(eq(tasks.id, existingTaskId))
          await db.delete(taskPeople).where(eq(taskPeople.taskId, existingTaskId))
          for (const pid of matchedIds) {
            await db.insert(taskPeople).values({ taskId: existingTaskId, personId: pid })
          }
        }
        result.tasksUpdated++
      } else {
        const id = newId('t_notion_')
        if (!dryRun) {
          await db.insert(tasks).values({
            id,
            title,
            meetingId,
            projectId,
            workspaceId,
            assigneeId,
            dueDate,
            done,
            status,
            priority,
            source: 'notion',
            notionPageId: page.id,
            notionAccount: database.accountLabel,
            notionDb: database.name,
            notionStatusRaw: notionStatusRaw || null,
            createdAt: now,
            updatedAt: now,
          })
          for (const pid of matchedIds) {
            await db.insert(taskPeople).values({ taskId: id, personId: pid })
          }
        }
        taskIdByPage.set(page.id, id)
        result.tasksCreated++
      }
    }
  }

  // ── Prune: notion tasks that were fetched in-window but no longer kept ──
  // (no longer assigned to a relevant person, or lost their title). Done/cancelled
  // tasks are kept and shown with their status. Tasks outside the window are never
  // fetched, so they are left untouched.
  const toPrune: string[] = []
  for (const [pageId, taskId] of taskIdByPage) {
    if (fetchedPageIds.has(pageId) && !keptPageIds.has(pageId)) toPrune.push(taskId)
  }
  if (toPrune.length > 0) {
    if (!dryRun) {
      await db.delete(taskPeople).where(inArray(taskPeople.taskId, toPrune))
      await db.delete(tasks).where(and(eq(tasks.source, 'notion'), inArray(tasks.id, toPrune)))
    }
    result.tasksPruned += toPrune.length
  }

  return result
}
