/**
 * Resolves the `people` row that represents the app owner ("me").
 *
 * There is no `isSelf` column: the owner is identified by name, the convention
 * Notion sync established (`NOTION_USER_NAME`). Both Notion sync and the
 * default-assignee logic go through here so they converge on a single row
 * instead of creating duplicates.
 */

import { getDb, people, sql } from '@ak-system/database'

type Db = ReturnType<typeof getDb>

export interface SelfPerson {
  id: string
  name: string
  color: string | null
}

/** Display name of the owner's contact row. */
export function getSelfPersonName(): string {
  return process.env.NOTION_USER_NAME?.trim() || 'Alpir Kritzler'
}

/** Find the owner's contact row, creating it on first use. */
export async function ensureSelfPerson(db: Db = getDb()): Promise<SelfPerson> {
  const name = getSelfPersonName()
  const [existing] = await db
    .select({ id: people.id, name: people.name, color: people.color })
    .from(people)
    .where(sql`lower(${people.name}) = ${name.toLowerCase()}`)
    .limit(1)
  if (existing) return existing

  const row = {
    id: 'p_me_' + Date.now() + Math.random().toString(36).slice(2, 7),
    name,
    color: '#e8c547',
  }
  await db.insert(people).values({
    id: row.id,
    name: row.name,
    email: null,
    role: null,
    color: row.color,
    status: 'confirmed',
    source: 'manual',
    notionPageId: null,
    createdAt: new Date().toISOString(),
  })
  return row
}
