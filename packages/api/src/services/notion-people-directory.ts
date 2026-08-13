/**
 * Shared Notion People-directory helpers for task pull-sync and write-back.
 *
 * Task databases often relate to directories that are not configured as `type: people`
 * in NOTION_ACCOUNTS (e.g. DT "📇 People directory"). The same human is a different
 * page in each directory, so resolution is by title within that directory — never by
 * assuming a single global `people.notionPageId`.
 */

const NOTION_VERSION = '2022-06-28'
const SCHEMA_TTL_MS = 5 * 60 * 1000

/** Names task databases give the relation that points at a directory of people. */
export const PEOPLE_RELATION_NAME = /people|person|אנשים|אנשי\s*קשר/i

export interface PeopleRelationInfo {
  propertyName: string
  targetDatabaseId: string
}

export interface PeopleDirectoryIndex {
  /** lowercased title → page id (first page wins on duplicate names) */
  byName: Map<string, string>
  /** page id → title */
  byPageId: Map<string, string>
}

const directoryCache = new Map<string, { at: number; index: PeopleDirectoryIndex }>()

/** Exposed for tests — caches would otherwise leak between cases. */
export function clearPeopleDirectoryCache(): void {
  directoryCache.clear()
}

/** Notion returns ids with and without dashes depending on the endpoint. */
export function sameNotionId(a: string, b: string): boolean {
  return a.replace(/-/g, '') === b.replace(/-/g, '')
}

/**
 * Picks the relation that points at a directory of people. A configured `people` database is proof;
 * otherwise the property name has to say so. Relations back into the task database itself (sub-tasks,
 * parent task, blockers) are never candidates.
 */
export function findPeopleRelation(
  properties: Record<string, { type?: string; relation?: { database_id?: string } }>,
  taskDatabaseId: string,
  configuredPeopleDatabaseIds: string[],
): PeopleRelationInfo | null {
  let byName: PeopleRelationInfo | null = null

  for (const [propertyName, p] of Object.entries(properties)) {
    if (p?.type !== 'relation') continue
    const targetDatabaseId = p.relation?.database_id
    if (!targetDatabaseId || sameNotionId(targetDatabaseId, taskDatabaseId)) continue

    if (configuredPeopleDatabaseIds.some((id) => sameNotionId(id, targetDatabaseId))) {
      return { propertyName, targetDatabaseId }
    }
    if (!byName && PEOPLE_RELATION_NAME.test(propertyName)) {
      byName = { propertyName, targetDatabaseId }
    }
  }
  return byName
}

/** GET database properties (uncached — callers that need TTL should wrap). */
export async function fetchDatabaseProperties(
  token: string,
  databaseId: string,
): Promise<Record<string, { type?: string; relation?: { database_id?: string } }>> {
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
  return data.properties ?? {}
}

/**
 * Full index for one people directory: name→id for write-back, pageId→title for pull-sync.
 * Cached per database id for SCHEMA_TTL_MS.
 */
export async function fetchPeopleDirectoryIndex(
  token: string,
  databaseId: string,
): Promise<PeopleDirectoryIndex> {
  const cached = directoryCache.get(databaseId)
  if (cached && Date.now() - cached.at < SCHEMA_TTL_MS) return cached.index

  const byName = new Map<string, string>()
  const byPageId = new Map<string, string>()
  let cursor: string | undefined
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cursor ? { page_size: 100, start_cursor: cursor } : { page_size: 100 }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Notion API ${res.status}: ${body.slice(0, 200)}`)
    }
    const data = (await res.json()) as {
      results?: Array<{
        id?: string
        properties?: Record<string, { type?: string; title?: Array<{ plain_text?: string }> }>
      }>
      next_cursor?: string | null
      has_more?: boolean
    }
    for (const page of data.results ?? []) {
      if (!page.id) continue
      const titleProp = Object.values(page.properties ?? {}).find((p) => p?.type === 'title')
      const name = (titleProp?.title ?? [])
        .map((t) => t.plain_text ?? '')
        .join('')
        .trim()
      if (!name) continue
      byPageId.set(page.id, name)
      if (!byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), page.id)
    }
    cursor = data.has_more ? (data.next_cursor ?? undefined) : undefined
  } while (cursor)

  const index = { byName, byPageId }
  directoryCache.set(databaseId, { at: Date.now(), index })
  return index
}
