/**
 * Meeting field writeback to Notion (title, date, time).
 * 
 * Meetings don't store notionAccount/notionDb like tasks do, so token resolution
 * tries each unique token from configured meeting databases until GET /v1/pages succeeds.
 */

import { resolveDatabases } from './notion-tasks-sync'

const NOTION_VERSION = '2022-06-28'
const SCHEMA_TTL_MS = 5 * 60 * 1000

export type MeetingWriteBackFailure = 'account' | 'no-page' | 'no-title-property' | 'no-date-property' | 'no-tasks-relation' | 'api'

export type MeetingWriteBackResult =
  | { ok: true; wrote: string[] }  // field names successfully written
  | { ok: false; reason: MeetingWriteBackFailure; message?: string }

interface MeetingDatabaseSchema {
  /** Subject (title or rich_text) property when present; else the database title property */
  subjectPropertyName: string | null
  subjectPropertyType: 'title' | 'rich_text' | null
  /** Name of the (exactly one) title-type property; every Notion database has one */
  titlePropertyName: string | null
  /** First date-type property, preferring names matching date|due|start|when|תאריך */
  datePropertyName: string | null
  /** Relation pointing at a tasks database, where a meeting's linked tasks go. */
  tasksRelation: TasksRelationInfo | null
}

interface TasksRelationInfo {
  propertyName: string
  targetDatabaseId: string
}

// Cache resolved token per page ID to avoid repeated page fetches
const pageTokenCache = new Map<string, { at: number; token: string; databaseId: string }>()
const meetingSchemaCache = new Map<string, { at: number; schema: MeetingDatabaseSchema }>()

/** Exposed for tests — the caches would otherwise leak between cases. */
export function clearMeetingWritebackCache(): void {
  pageTokenCache.clear()
  meetingSchemaCache.clear()
}

/**
 * Resolve the token and database ID for a Notion page by trying each meetings token
 * until GET /v1/pages succeeds.
 */
async function resolvePageToken(notionPageId: string): Promise<{ token: string; databaseId: string } | null> {
  const cached = pageTokenCache.get(notionPageId)
  if (cached && Date.now() - cached.at < SCHEMA_TTL_MS) {
    return { token: cached.token, databaseId: cached.databaseId }
  }

  const meetingsDbs = resolveDatabases('meetings')
  if (meetingsDbs.length === 0) return null

  // Try each unique token
  const tokens = [...new Set(meetingsDbs.map((db) => db.token))]
  for (const token of tokens) {
    try {
      const res = await fetch(`https://api.notion.com/v1/pages/${notionPageId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': NOTION_VERSION,
        },
      })
      if (res.ok) {
        const data = (await res.json()) as { parent?: { database_id?: string } }
        const databaseId = data.parent?.database_id
        if (databaseId) {
          pageTokenCache.set(notionPageId, { at: Date.now(), token, databaseId })
          return { token, databaseId }
        }
      }
    } catch {
      // Try next token
      continue
    }
  }
  
  return null
}

async function fetchMeetingDatabaseSchema(token: string, databaseId: string): Promise<MeetingDatabaseSchema> {
  const cached = meetingSchemaCache.get(databaseId)
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
    properties?: Record<string, { type?: string; relation?: { database_id?: string } }>
  }
  const properties = data.properties ?? {}

  // Look for Subject property first (matches read path getPageTitle)
  let subjectPropertyName: string | null = null
  let subjectPropertyType: 'title' | 'rich_text' | null = null
  for (const [name, prop] of Object.entries(properties)) {
    if (name.toLowerCase() === 'subject' && (prop?.type === 'title' || prop?.type === 'rich_text')) {
      subjectPropertyName = name
      subjectPropertyType = prop.type
      break
    }
  }

  // Fall back to the database title property
  const titlePropertyName = Object.entries(properties).find(([, p]) => p?.type === 'title')?.[0] ?? null

  // Date property: prefer names matching date|due|start|when|תאריך, else first date type
  let datePropertyName: string | null = null
  const datePattern = /date|due|start|when|תאריך/i
  for (const [name, prop] of Object.entries(properties)) {
    if (prop?.type === 'date') {
      if (datePattern.test(name)) {
        datePropertyName = name
        break
      } else if (!datePropertyName) {
        datePropertyName = name
      }
    }
  }

  // Tasks relation: prefer names matching task|todo|action|משימ
  let tasksRelation: TasksRelationInfo | null = null
  const taskPattern = /task|todo|action|משימ/i
  for (const [name, prop] of Object.entries(properties)) {
    if (prop?.type === 'relation') {
      const targetDatabaseId = prop.relation?.database_id
      if (targetDatabaseId && targetDatabaseId !== databaseId && taskPattern.test(name)) {
        tasksRelation = { propertyName: name, targetDatabaseId }
        break
      }
    }
  }

  const schema: MeetingDatabaseSchema = {
    subjectPropertyName,
    subjectPropertyType,
    titlePropertyName,
    datePropertyName,
    tasksRelation,
  }
  meetingSchemaCache.set(databaseId, { at: Date.now(), schema })
  return schema
}

/**
 * Format date + time as ISO local datetime with Asia/Jerusalem offset.
 * Example: 2026-09-07T14:30:00+03:00
 */
function formatLocalDateTime(date: string, time: string, timezone = 'Asia/Jerusalem'): string {
  // Parse the date and time
  const [year, month, day] = date.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  
  // Create a date object in the given timezone
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`
  
  // Get the timezone offset for this date in the specified timezone
  const dateTime = new Date(`${dateStr}T${timeStr}`)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  
  // Get offset
  const utcDate = new Date(dateTime.toLocaleString('en-US', { timeZone: 'UTC' }))
  const tzDate = new Date(dateTime.toLocaleString('en-US', { timeZone: timezone }))
  const offsetMs = tzDate.getTime() - utcDate.getTime()
  const offsetHours = Math.floor(Math.abs(offsetMs) / 3600000)
  const offsetMinutes = Math.floor((Math.abs(offsetMs) % 3600000) / 60000)
  const offsetSign = offsetMs >= 0 ? '+' : '-'
  const offset = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMinutes).padStart(2, '0')}`
  
  return `${dateStr}T${timeStr}${offset}`
}

/**
 * Push meeting properties (title, date, time) to Notion. Never throws — the local row is
 * already committed and must not fail because Notion is unavailable.
 * 
 * Skips sentinel date 9999-12-31. Only properties provided in the input are written.
 */
export async function pushMeetingProperties(input: {
  notionPageId: string
  title?: string
  date?: string  // YYYY-MM-DD
  time?: string  // HH:MM
}): Promise<MeetingWriteBackResult> {
  try {
    // Resolve token and database
    const resolved = await resolvePageToken(input.notionPageId)
    if (!resolved) return { ok: false, reason: 'account' }

    const schema = await fetchMeetingDatabaseSchema(resolved.token, resolved.databaseId)
    const properties: Record<string, unknown> = {}
    const wrote: string[] = []

    // Title
    if (input.title !== undefined && input.title.trim()) {
      if (schema.subjectPropertyName && schema.subjectPropertyType) {
        // Write to Subject property
        if (schema.subjectPropertyType === 'title') {
          properties[schema.subjectPropertyName] = { title: [{ text: { content: input.title } }] }
        } else {
          properties[schema.subjectPropertyName] = { rich_text: [{ text: { content: input.title } }] }
        }
        wrote.push('title')
      } else if (schema.titlePropertyName) {
        // Fall back to database title property
        properties[schema.titlePropertyName] = { title: [{ text: { content: input.title } }] }
        wrote.push('title')
      }
    }

    // Date + time
    if (input.date !== undefined && input.date && input.date !== '9999-12-31' && schema.datePropertyName) {
      const time = input.time ?? '09:00'
      const dateTime = formatLocalDateTime(input.date, time)
      properties[schema.datePropertyName] = { date: { start: dateTime } }
      wrote.push('date')
    }

    // If no properties were built, nothing to write
    if (Object.keys(properties).length === 0) {
      return { ok: true, wrote: [] }
    }

    const res = await fetch(`https://api.notion.com/v1/pages/${input.notionPageId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${resolved.token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties }),
    })
    
    if (!res.ok) {
      const body = await res.text()
      return { ok: false, reason: 'api', message: `Notion API ${res.status}: ${body.slice(0, 200)}` }
    }
    
    return { ok: true, wrote }
  } catch (err) {
    return { ok: false, reason: 'api', message: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Add or remove a task page from a meeting's Tasks relation, preserving Notion-only links
 * (task pages that are not synced locally). Merge, don't replace.
 */
export async function pushMeetingTaskLinks(input: {
  meetingNotionPageId: string
  taskNotionPageId: string
  action: 'add' | 'remove'
}): Promise<MeetingWriteBackResult> {
  try {
    const resolved = await resolvePageToken(input.meetingNotionPageId)
    if (!resolved) return { ok: false, reason: 'no-page' }

    const schema = await fetchMeetingDatabaseSchema(resolved.token, resolved.databaseId)
    const relation = schema.tasksRelation
    if (!relation) return { ok: false, reason: 'no-tasks-relation' }

    // 1. GET current page to read existing Tasks relation
    const getRes = await fetch(`https://api.notion.com/v1/pages/${input.meetingNotionPageId}`, {
      headers: {
        Authorization: `Bearer ${resolved.token}`,
        'Notion-Version': NOTION_VERSION,
      },
    })
    if (!getRes.ok) {
      const body = await getRes.text()
      return { ok: false, reason: 'api', message: `GET page ${getRes.status}: ${body.slice(0, 200)}` }
    }
    const page = (await getRes.json()) as {
      properties?: Record<string, { relation?: Array<{ id?: string }> }>
    }
    const existingRel = page.properties?.[relation.propertyName]?.relation ?? []
    const existingIds = existingRel.map((r: { id?: string }) => r.id).filter(Boolean) as string[]

    // 2. Load all local task notionPageIds to identify which IDs are Notion-only
    const { getDb, tasks, eq } = await import('@ak-system/database')
    const db = getDb()
    const localTaskPages = await db
      .select({ notionPageId: tasks.notionPageId })
      .from(tasks)
      .where(eq(tasks.source, 'notion'))
    const localPageIds = new Set(localTaskPages.map((t) => t.notionPageId).filter(Boolean))

    // 3. Keep IDs that are NOT local (Notion-only), then add/remove the target task
    const notionOnlyIds = existingIds.filter((id) => !localPageIds.has(id))
    let merged: string[]
    if (input.action === 'add') {
      merged = [...new Set([...notionOnlyIds, input.taskNotionPageId])]
    } else {
      merged = notionOnlyIds.filter((id) => id !== input.taskNotionPageId)
    }

    // 4. Skip PATCH if unchanged
    const unchanged =
      merged.length === existingIds.length && merged.every((id) => existingIds.includes(id))
    if (unchanged) {
      return { ok: true, wrote: [] }
    }

    // 5. PATCH the relation
    const patchRes = await fetch(`https://api.notion.com/v1/pages/${input.meetingNotionPageId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${resolved.token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: { [relation.propertyName]: { relation: merged.map((id) => ({ id })) } },
      }),
    })
    if (!patchRes.ok) {
      const body = await patchRes.text()
      return { ok: false, reason: 'api', message: `PATCH page ${patchRes.status}: ${body.slice(0, 200)}` }
    }

    return { ok: true, wrote: [relation.propertyName] }
  } catch (err) {
    return { ok: false, reason: 'api', message: err instanceof Error ? err.message : String(err) }
  }
}
