import { getDb, notionStatusOverrides } from '@ak-system/database'
import {
  findStatusPropertyName,
  resolveCanonicalStatus,
  resolveTaskDatabaseTarget,
  type CanonicalStatus,
} from './notion-tasks-sync'

const NOTION_VERSION = '2022-06-28'
const SCHEMA_TTL_MS = 5 * 60 * 1000

export type WriteBackFailure = 'account' | 'no-status-property' | 'no-matching-option' | 'api'

export type WriteBackResult =
  | { ok: true; label: string }
  | { ok: false; reason: WriteBackFailure; message?: string }

interface StatusSchema {
  propertyName: string
  propertyType: 'status' | 'select'
  /** Option labels in the order Notion returns them, which is the order shown in Notion's UI. */
  options: string[]
}

interface DatabaseSchema {
  /** Name of the (exactly one) `title`-type property; every Notion database has one. */
  titlePropertyName: string | null
  status: StatusSchema | null
  /** First `date`-type property found, best-effort target for a task's due date on create. */
  datePropertyName: string | null
}

const dbSchemaCache = new Map<string, { at: number; schema: DatabaseSchema }>()

/** Exposed for tests — the cache would otherwise leak between cases. */
export function clearStatusSchemaCache(): void {
  dbSchemaCache.clear()
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
    properties?: Record<string, { type?: string; status?: unknown; select?: unknown }>
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

  const schema: DatabaseSchema = { titlePropertyName, status, datePropertyName }
  dbSchemaCache.set(databaseId, { at: Date.now(), schema })
  return schema
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

export type CreateResult =
  | { ok: true; pageId: string; accountLabel: string; name: string; label: string | null }
  | { ok: false; reason: 'api'; message?: string }

/**
 * Create a new Notion page for a task just created locally. Never throws — the local task is
 * already committed and must not be lost or blocked because Notion is unavailable. Only title,
 * an initial "not started"-equivalent status (when the database's own options map one), and a
 * due date (when both a date property and a value exist) are pushed; see
 * notion-task-create-push spec for the priority/other-fields out-of-scope call.
 */
export async function createNotionTask(input: {
  target: { token: string; databaseId: string; accountLabel: string; name: string }
  title: string
  dueDate?: string | null
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
      label = pickNotionLabel('not_started', schema.status.options, overrides)
      if (label) {
        properties[schema.status.propertyName] =
          schema.status.propertyType === 'status' ? { status: { name: label } } : { select: { name: label } }
      }
    }

    if (schema.datePropertyName && input.dueDate) {
      properties[schema.datePropertyName] = { date: { start: input.dueDate } }
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
