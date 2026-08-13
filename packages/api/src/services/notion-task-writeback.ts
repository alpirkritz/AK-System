import { getDb, notionStatusOverrides } from '@ak-system/database'
import {
  findStatusPropertyName,
  listConfiguredPeopleDatabaseIds,
  resolveCanonicalStatus,
  resolveDatabases,
  resolveTaskDatabaseTarget,
  type CanonicalStatus,
} from './notion-tasks-sync'
import {
  clearPeopleDirectoryCache,
  fetchPeopleDirectoryIndex,
  findPeopleRelation,
  type PeopleRelationInfo,
} from './notion-people-directory'

const NOTION_VERSION = '2022-06-28'
const SCHEMA_TTL_MS = 5 * 60 * 1000

export type WriteBackFailure =
  | 'account'
  | 'no-status-property'
  | 'no-matching-option'
  | 'no-people-relation'
  | 'no-matching-people'
  | 'api'

export type WriteBackResult =
  | { ok: true; label: string }
  | { ok: false; reason: WriteBackFailure; message?: string }

interface StatusSchema {
  propertyName: string
  propertyType: 'status' | 'select'
  /** Option labels in the order Notion returns them, which is the order shown in Notion's UI. */
  options: string[]
}

interface PrioritySchema {
  propertyName: string
  propertyType: 'status' | 'select'
  options: string[]
}

interface DatabaseSchema {
  /** Name of the (exactly one) `title`-type property; every Notion database has one. */
  titlePropertyName: string | null
  status: StatusSchema | null
  /** First `date`-type property found, best-effort target for a task's due date on create. */
  datePropertyName: string | null
  /** First `people`-type property — where an assignee goes. Every task database surveyed has exactly one. */
  peoplePropertyName: string | null
  priority: PrioritySchema | null
  /** Relation pointing at a people directory, where a task's related people go. */
  peopleRelation: PeopleRelationInfo | null
}

const dbSchemaCache = new Map<string, { at: number; schema: DatabaseSchema }>()
const usersCache = new Map<string, { at: number; users: NotionUser[] }>()

/** Exposed for tests — the caches would otherwise leak between cases. */
export function clearStatusSchemaCache(): void {
  dbSchemaCache.clear()
  usersCache.clear()
  clearPeopleDirectoryCache()
}

/** True for the property that holds a priority, which must never be mistaken for the status. */
function isPriorityName(name: string): boolean {
  return name.toLowerCase().includes('priority') || name.includes('עדיפות')
}

async function fetchDatabaseSchema(token: string, databaseId: string): Promise<DatabaseSchema> {
  const cached = dbSchemaCache.get(databaseId)
  if (cached && Date.now() - cached.at < SCHEMA_TTL_MS) return cached.schema

  const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Notion API ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    properties?: Record<
      string,
      { type?: string; status?: unknown; select?: unknown; relation?: { database_id?: string } }
    >
  }
  const properties = data.properties ?? {}

  const found = findStatusPropertyName(properties)
  let status: StatusSchema | null = null
  if (found) {
    const prop = properties[found.name] as
      | { status?: { options?: Array<{ name?: string }> }; select?: { options?: Array<{ name?: string }> } }
      | undefined
    const raw = found.type === 'status' ? prop?.status?.options : prop?.select?.options
    status = {
      propertyName: found.name,
      propertyType: found.type,
      options: (raw ?? []).map((o) => o.name ?? '').filter(Boolean),
    }
  }
  const titlePropertyName = Object.entries(properties).find(([, p]) => p?.type === 'title')?.[0] ?? null
  const datePropertyName = Object.entries(properties).find(([, p]) => p?.type === 'date')?.[0] ?? null
  const peoplePropertyName = Object.entries(properties).find(([, p]) => p?.type === 'people')?.[0] ?? null

  let priority: PrioritySchema | null = null
  for (const [name, p] of Object.entries(properties)) {
    if (!isPriorityName(name)) continue
    if (p?.type !== 'select' && p?.type !== 'status') continue
    const prop = p as {
      status?: { options?: Array<{ name?: string }> }
      select?: { options?: Array<{ name?: string }> }
    }
    const raw = p.type === 'status' ? prop.status?.options : prop.select?.options
    priority = {
      propertyName: name,
      propertyType: p.type,
      options: (raw ?? []).map((o) => o.name ?? '').filter(Boolean),
    }
    break
  }

  const schema: DatabaseSchema = {
    titlePropertyName,
    status,
    datePropertyName,
    peoplePropertyName,
    priority,
    peopleRelation: findPeopleRelation(properties, databaseId, listConfiguredPeopleDatabaseIds()),
  }
  dbSchemaCache.set(databaseId, { at: Date.now(), schema })
  return schema
}

interface NotionUser {
  id: string
  name: string
  email: string | null
}

/** Workspace users for a token, cached alongside the schema cache. Never throws. */
async function fetchUsers(token: string): Promise<NotionUser[]> {
  const cached = usersCache.get(token)
  if (cached && Date.now() - cached.at < SCHEMA_TTL_MS) return cached.users

  const users: NotionUser[] = []
  let cursor: string | undefined
  do {
    const url = new URL('https://api.notion.com/v1/users')
    url.searchParams.set('page_size', '100')
    if (cursor) url.searchParams.set('start_cursor', cursor)
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION },
    })
    if (!res.ok) break
    const data = (await res.json()) as {
      results?: Array<{
        id?: string
        name?: string
        type?: string
        person?: { email?: string }
      }>
      has_more?: boolean
      next_cursor?: string | null
    }
    for (const u of data.results ?? []) {
      // Bots can't be assignees, and matching one by name would silently mis-assign.
      if (u?.type !== 'person' || !u.id) continue
      users.push({ id: u.id, name: (u.name ?? '').trim(), email: u.person?.email?.trim() ?? null })
    }
    cursor = data.has_more ? data.next_cursor ?? undefined : undefined
  } while (cursor)

  usersCache.set(token, { at: Date.now(), users })
  return users
}

/**
 * Notion user id for a local person. Email is the reliable key; name is the fallback because
 * that is what the read path (`getPeopleNames`) matches on. `null` when the person is not a
 * user of that Notion workspace, which leaves the page unassigned rather than failing it.
 */
export async function resolveNotionUserId(
  token: string,
  person: { name: string; email?: string | null },
): Promise<string | null> {
  const users = await fetchUsers(token)
  const email = person.email?.trim().toLowerCase()
  if (email) {
    const byEmail = users.find((u) => u.email?.toLowerCase() === email)
    if (byEmail) return byEmail.id
  }
  const name = person.name.trim().toLowerCase()
  if (!name) return null
  return users.find((u) => u.name.toLowerCase() === name)?.id ?? null
}

/** Keyword bucket for a literal priority label — mirrors `getPriority` on the read path. */
function priorityBucket(label: string): 'high' | 'medium' | 'low' {
  const l = label.trim().toLowerCase()
  if (l.includes('high') || l.includes('urgent') || l.includes('critical')) return 'high'
  if (l.includes('low')) return 'low'
  return 'medium'
}

/**
 * The database's own label for a priority. An exact match on the canonical word wins first:
 * options that lead with "Critical" would otherwise swallow a plain "high" task through the
 * keyword bucket. The bucket is the fallback for databases labelling priorities differently.
 */
export function pickPriorityLabel(target: 'high' | 'medium' | 'low', options: string[]): string | null {
  const exact = options.find((o) => o.trim().toLowerCase() === target)
  if (exact) return exact
  return options.find((o) => priorityBucket(o) === target) ?? null
}

async function fetchStatusSchema(token: string, databaseId: string): Promise<StatusSchema | null> {
  return (await fetchDatabaseSchema(token, databaseId)).status
}

/**
 * The database's own label for a canonical status. Each option is pushed through the same
 * resolution the read path uses, so a user override like "Testing → בתהליך" also steers writes.
 * Option order is preserved, so the first match wins ("In Progress" before "Testing").
 */
export function pickNotionLabel(
  target: CanonicalStatus,
  options: string[],
  overrides: Map<string, CanonicalStatus>,
): string | null {
  for (const option of options) {
    if (resolveCanonicalStatus(option, overrides) === target) return option
  }
  return null
}

async function loadOverrides(): Promise<Map<string, CanonicalStatus>> {
  const db = getDb()
  const rows = await db
    .select({
      rawLabel: notionStatusOverrides.rawLabel,
      canonicalStatus: notionStatusOverrides.canonicalStatus,
    })
    .from(notionStatusOverrides)
  const map = new Map<string, CanonicalStatus>()
  for (const r of rows) {
    map.set(r.rawLabel.trim().toLowerCase(), r.canonicalStatus as CanonicalStatus)
  }
  return map
}

/**
 * Push a canonical status to the Notion page a task was synced from. Never throws — callers
 * have already committed the local change and must not fail because Notion is unavailable.
 */
export async function pushTaskStatus(input: {
  notionPageId: string
  notionAccount: string | null | undefined
  notionDb: string | null | undefined
  status: CanonicalStatus
}): Promise<WriteBackResult> {
  const target = resolveTaskDatabaseTarget(input.notionAccount, input.notionDb)
  if (!target) return { ok: false, reason: 'account' }

  try {
    const schema = await fetchStatusSchema(target.token, target.databaseId)
    if (!schema || schema.options.length === 0) return { ok: false, reason: 'no-status-property' }

    const overrides = await loadOverrides()
    const label = pickNotionLabel(input.status, schema.options, overrides)
    if (!label) return { ok: false, reason: 'no-matching-option' }

    const value =
      schema.propertyType === 'status' ? { status: { name: label } } : { select: { name: label } }
    const res = await fetch(`https://api.notion.com/v1/pages/${input.notionPageId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${target.token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties: { [schema.propertyName]: value } }),
    })
    if (!res.ok) {
      const body = await res.text()
      return { ok: false, reason: 'api', message: `Notion API ${res.status}: ${body.slice(0, 200)}` }
    }
    return { ok: true, label }
  } catch (err) {
    return { ok: false, reason: 'api', message: err instanceof Error ? err.message : String(err) }
  }
}

export type PeopleRelationResult =
  | { ok: true; propertyName: string; matched: string[]; unmatched: string[] }
  | { ok: false; reason: WriteBackFailure; message?: string; unmatched?: string[] }

/**
 * Mirror a task's related people onto the Notion People-directory relation. Never throws — the local
 * rows are already committed.
 *
 * An empty `personNames` clears the relation, because the user removing everyone is a real intent.
 * But when names are given and none of them exist in the directory, the relation is left alone: a
 * lookup miss must not wipe links that were set in Notion by hand. See the
 * notion-task-people-relation-push spec.
 */
export async function pushTaskPeople(input: {
  notionPageId: string
  notionAccount: string | null | undefined
  notionDb: string | null | undefined
  personNames: string[]
}): Promise<PeopleRelationResult> {
  const target = resolveTaskDatabaseTarget(input.notionAccount, input.notionDb)
  if (!target) return { ok: false, reason: 'account' }

  try {
    const schema = await fetchDatabaseSchema(target.token, target.databaseId)
    const relation = schema.peopleRelation
    if (!relation) return { ok: false, reason: 'no-people-relation' }

    const matched: string[] = []
    const unmatched: string[] = []
    const pageIds: string[] = []
    if (input.personNames.length > 0) {
      const directory = await fetchPeopleDirectoryIndex(target.token, relation.targetDatabaseId)
      for (const name of input.personNames) {
        const pageId = directory.byName.get(name.trim().toLowerCase())
        if (pageId && !pageIds.includes(pageId)) {
          pageIds.push(pageId)
          matched.push(name)
        } else if (!pageId) {
          unmatched.push(name)
        }
      }
      if (pageIds.length === 0) return { ok: false, reason: 'no-matching-people', unmatched }
    }

    const res = await fetch(`https://api.notion.com/v1/pages/${input.notionPageId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${target.token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: { [relation.propertyName]: { relation: pageIds.map((id) => ({ id })) } },
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      return { ok: false, reason: 'api', message: `Notion API ${res.status}: ${body.slice(0, 200)}` }
    }
    return { ok: true, propertyName: relation.propertyName, matched, unmatched }
  } catch (err) {
    return { ok: false, reason: 'api', message: err instanceof Error ? err.message : String(err) }
  }
}

export type CreateResult =
  | { ok: true; pageId: string; accountLabel: string; name: string; label: string | null }
  | { ok: false; reason: 'api'; message?: string }

/**
 * Create a new Notion page for a task just created locally. Never throws — the local task is
 * already committed and must not be lost or blocked because Notion is unavailable.
 *
 * Pushes title, status, due date, priority and assignee, each only when the database exposes a
 * property for it and a value resolves. The assignee matters beyond convenience: task views are
 * filtered by it, and `syncNotionTasks` prunes any page it cannot resolve to a known person, so
 * an unassigned page would be deleted locally on the next pull. See the
 * notion-task-create-assignee-priority spec.
 */
export async function createNotionTask(input: {
  target: { token: string; databaseId: string; accountLabel: string; name: string }
  title: string
  dueDate?: string | null
  status?: CanonicalStatus
  priority?: 'high' | 'medium' | 'low' | null
  assignee?: { name: string; email?: string | null } | null
}): Promise<CreateResult> {
  const { target } = input
  try {
    const schema = await fetchDatabaseSchema(target.token, target.databaseId)
    const properties: Record<string, unknown> = {}
    if (schema.titlePropertyName) {
      properties[schema.titlePropertyName] = { title: [{ text: { content: input.title } }] }
    }

    let label: string | null = null
    if (schema.status && schema.status.options.length > 0) {
      const overrides = await loadOverrides()
      label = pickNotionLabel(input.status ?? 'not_started', schema.status.options, overrides)
      if (label) {
        properties[schema.status.propertyName] =
          schema.status.propertyType === 'status' ? { status: { name: label } } : { select: { name: label } }
      }
    }

    if (schema.datePropertyName && input.dueDate) {
      properties[schema.datePropertyName] = { date: { start: input.dueDate } }
    }

    if (schema.priority && input.priority && schema.priority.options.length > 0) {
      const priorityLabel = pickPriorityLabel(input.priority, schema.priority.options)
      if (priorityLabel) {
        properties[schema.priority.propertyName] =
          schema.priority.propertyType === 'status'
            ? { status: { name: priorityLabel } }
            : { select: { name: priorityLabel } }
      }
    }

    if (schema.peoplePropertyName && input.assignee) {
      const userId = await resolveNotionUserId(target.token, input.assignee)
      if (userId) properties[schema.peoplePropertyName] = { people: [{ id: userId }] }
    }

    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${target.token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ parent: { database_id: target.databaseId }, properties }),
    })
    if (!res.ok) {
      const body = await res.text()
      return { ok: false, reason: 'api', message: `Notion API ${res.status}: ${body.slice(0, 200)}` }
    }
    const data = (await res.json()) as { id: string }
    return { ok: true, pageId: data.id, accountLabel: target.accountLabel, name: target.name, label }
  } catch (err) {
    return { ok: false, reason: 'api', message: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Push a project's related people onto the Notion project's People relation.
 * Resolves directory pages by name against the relation's target DB (same safety
 * net as pushTaskPeople). Never throws.
 */
export async function pushProjectPeople(input: {
  notionPageId: string
  personNames: string[]
}): Promise<PeopleRelationResult> {
  const projectDbs = resolveDatabases('projects')
  if (projectDbs.length === 0) return { ok: false, reason: 'account' }

  let lastError: PeopleRelationResult | null = null
  for (const database of projectDbs) {
    try {
      const schema = await fetchDatabaseSchema(database.token, database.databaseId)
      const relation = schema.peopleRelation
      if (!relation) {
        lastError = { ok: false, reason: 'no-people-relation' }
        continue
      }

      const matched: string[] = []
      const unmatched: string[] = []
      const pageIds: string[] = []
      if (input.personNames.length > 0) {
        const directory = await fetchPeopleDirectoryIndex(database.token, relation.targetDatabaseId)
        for (const name of input.personNames) {
          const pageId = directory.byName.get(name.trim().toLowerCase())
          if (pageId && !pageIds.includes(pageId)) {
            pageIds.push(pageId)
            matched.push(name)
          } else if (!pageId) {
            unmatched.push(name)
          }
        }
        if (pageIds.length === 0) {
          lastError = { ok: false, reason: 'no-matching-people', unmatched }
          continue
        }
      }

      const res = await fetch(`https://api.notion.com/v1/pages/${input.notionPageId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${database.token}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          properties: { [relation.propertyName]: { relation: pageIds.map((id) => ({ id })) } },
        }),
      })
      if (!res.ok) {
        const body = await res.text()
        lastError = { ok: false, reason: 'api', message: `Notion API ${res.status}: ${body.slice(0, 200)}` }
        continue
      }
      return { ok: true, propertyName: relation.propertyName, matched, unmatched }
    } catch (err) {
      lastError = { ok: false, reason: 'api', message: err instanceof Error ? err.message : String(err) }
    }
  }
  return lastError ?? { ok: false, reason: 'account' }
}
