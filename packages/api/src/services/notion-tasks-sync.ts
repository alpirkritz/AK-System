/**
 * Sync Notion tasks + the Notion people directory into the app database.
 *
 * Pulls tasks assigned to the user (`NOTION_USER_NAME`) and tasks assigned to
 * other people who exist in the Notion people directory, upserts those people
 * into `people`, and links every synced task to its person(s) via
 * `tasks.assigneeId` + the `task_people` join table.
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
  tasks,
  taskPeople,
  workspaces,
  workspaceNotionDatabases,
  notionStatusOverrides,
  eq,
  and,
  inArray,
} from '@ak-system/database'
import { ensureSelfPerson, getSelfPersonName } from './self-person'

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

/** Databases of a given Notion type across all configured accounts. */
function resolveDatabases(type: 'tasks' | 'people'): NotionDb[] {
  const out: NotionDb[] = []
  const raw = process.env.NOTION_ACCOUNTS?.trim()
  if (raw) {
    try {
      const data = JSON.parse(raw) as unknown
      if (Array.isArray(data)) {
        for (const acc of data as Array<Record<string, unknown>>) {
          const token = typeof acc?.token === 'string' ? acc.token.trim() : ''
          if (!token) continue
          const label = typeof acc?.label === 'string' && acc.label.trim() ? acc.label.trim() : 'Notion'
          const dbs = Array.isArray(acc?.databases) ? (acc.databases as Array<Record<string, unknown>>) : []
          for (const db of dbs) {
            if (db?.type === type && typeof db?.id === 'string' && db.id.trim()) {
              out.push({
                token,
                databaseId: db.id.trim(),
                name: typeof db.name === 'string' ? db.name : type,
                accountLabel: label,
              })
            }
          }
        }
      }
    } catch {
      // fall through to legacy
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

/** True when at least one Notion `tasks` database is configured. */
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
export function resolveTaskDatabaseTarget(
  accountLabel: string | null | undefined,
  dbName?: string | null,
): { token: string; databaseId: string } | null {
  const dbs = resolveDatabases('tasks')
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
  if (!hit) return null
  return { token: hit.token, databaseId: hit.databaseId, accountLabel: hit.accountLabel, name: hit.name }
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

/** Related page ids from every `relation`-type property (e.g. link to People DB). */
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

/** Email from an `email`-type property, if present. */
function getEmail(props: Record<string, NotionProp>): string | null {
  for (const v of Object.values(props)) {
    if (v?.type === 'email' && typeof v.email === 'string' && v.email.trim()) return v.email.trim()
  }
  return null
}

// ─── People matching helpers ─────────────────────────────────────────────────

interface PersonRow {
  id: string
  name: string
  email: string | null
  notionPageId: string | null
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

  const taskDbs = resolveDatabases('tasks')
  if (taskDbs.length === 0) {
    throw new Error('לא הוגדר בסיס נתונים של משימות ב-Notion — הוסף אותו ל-NOTION_ACCOUNTS')
  }
  const peopleDbs = resolveDatabases('people')
  const now = new Date().toISOString()

  // Load current people into lookup maps.
  const existingPeople = (await db
    .select({ id: people.id, name: people.name, email: people.email, notionPageId: people.notionPageId })
    .from(people)) as PersonRow[]
  const maps = buildPeopleMaps(existingPeople)

  const registerPerson = (row: PersonRow): void => {
    if (row.notionPageId) maps.byNotionId.set(row.notionPageId, row)
    if (row.email) maps.byEmail.set(row.email.toLowerCase(), row)
    maps.byName.set(row.name.toLowerCase(), row)
  }

  // ── People pass: upsert the Notion people directory ──
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
      const existing =
        maps.byNotionId.get(page.id) ??
        (email ? maps.byEmail.get(email.toLowerCase()) : undefined) ??
        maps.byName.get(name.toLowerCase())

      if (existing) {
        // Backfill notionPageId (and email) on an already-known person.
        if (!existing.notionPageId) {
          if (!dryRun) {
            await db.update(people).set({ notionPageId: page.id }).where(eq(people.id, existing.id))
          }
          existing.notionPageId = page.id
          maps.byNotionId.set(page.id, existing)
          result.peopleUpdated++
        }
        continue
      }

      const id = newId('p_notion_')
      const row: PersonRow = { id, name, email: email ?? null, notionPageId: page.id }
      if (!dryRun) {
        await db.insert(people).values({
          id,
          name,
          email: email ?? null,
          role: null,
          color: '#e8c547',
          status: 'confirmed',
          source: 'notion',
          notionPageId: page.id,
          createdAt: now,
        })
      }
      registerPerson(row)
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

  // ── Tasks pass ──
  const filter = recentActivityFilter(windowDays)
  const fetchedPageIds = new Set<string>()
  const keptPageIds = new Set<string>()

  // Preload existing notion-sourced tasks for idempotent upsert.
  const existingNotionTasks = await db
    .select({ id: tasks.id, notionPageId: tasks.notionPageId })
    .from(tasks)
    .where(eq(tasks.source, 'notion'))
  const taskIdByPage = new Map<string, string>()
  for (const t of existingNotionTasks) {
    if (t.notionPageId) taskIdByPage.set(t.notionPageId, t.id)
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

    for (const page of pages) {
      fetchedPageIds.add(page.id)
      const props = page.properties
      const title = getTitle(props)
      if (!title) {
        result.tasksSkipped++
        continue
      }

      // Resolve assignees → known people.
      const assigneeNames = getPeopleNames(props)
      const relationIds = getRelationPageIds(props)
      const matched = new Map<string, PersonRow>()
      let userIsAssignee = false
      for (const n of assigneeNames) {
        if (n.toLowerCase() === userName.toLowerCase()) {
          userIsAssignee = true
          matched.set(userPerson.id, userPerson)
          continue
        }
        const p = maps.byName.get(n.toLowerCase())
        if (p) matched.set(p.id, p)
      }
      for (const relId of relationIds) {
        const p = maps.byNotionId.get(relId)
        if (p) {
          matched.set(p.id, p)
          if (p.id === userPerson.id) userIsAssignee = true
        }
      }

      // Keep task if it's the user's or belongs to at least one directory person.
      if (!userIsAssignee && matched.size === 0) {
        result.tasksSkipped++
        continue
      }

      const matchedIds = [...matched.keys()]
      const assigneeId = userIsAssignee ? userPerson.id : (matchedIds[0] ?? null)
      const dueDate = getDueDate(props)
      const priority = getPriority(props)
      const notionStatusRaw = getStatusRaw(props)
      const status = resolveCanonicalStatus(notionStatusRaw, statusOverrides)
      const done = status === 'done' || status === 'cancelled'
      keptPageIds.add(page.id)

      const existingTaskId = taskIdByPage.get(page.id)
      if (existingTaskId) {
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
            meetingId: null,
            projectId: null,
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
