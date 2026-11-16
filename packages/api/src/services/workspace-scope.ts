/**
 * Worlds and the workspaces inside them.
 * A row with parentId = null is a world. A row with a parent is a workspace, one level deep.
 * Nothing here moves existing rows on its own — parenting and merging are explicit.
 */
import {
  getDb,
  meetingSeries,
  meetings,
  personWorkspaces,
  projects,
  tasks,
  workspaceNotionDatabases,
  workspaces,
} from '@ak-system/database'
import { eq, inArray } from 'drizzle-orm'
import { moveEntityMemoryLinks } from './memory-relevance'

type Db = ReturnType<typeof getDb>

export async function expandWorkspaceFilter(db: Db, workspaceId: string): Promise<string[]> {
  const children = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.parentId, workspaceId))
  return [workspaceId, ...children.map((c) => c.id)]
}

/** A workspace may only sit directly under a world. A world cannot be placed under anything. */
export async function assertValidParent(db: Db, id: string | null, parentId: string | null): Promise<void> {
  if (!parentId) return
  if (id && parentId === id) throw new Error('עולם לא יכול להיות מתחת לעצמו')
  const [parent] = await db.select().from(workspaces).where(eq(workspaces.id, parentId))
  if (!parent) throw new Error('העולם לא נמצא')
  if (parent.parentId) throw new Error('סביבת עבודה יכולה לשבת רק מתחת לעולם, לא מתחת לסביבה אחרת')
  if (id) {
    const children = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.parentId, id))
    if (children.length > 0) throw new Error('לעולם הזה יש סביבות עבודה — אי אפשר לשים אותו מתחת לעולם אחר')
  }
}

export interface MergeCounts {
  tasks: number
  projects: number
  meetings: number
  series: number
  people: number
  databases: number
}

async function countEq(db: Db, table: typeof tasks, column: typeof tasks.workspaceId, id: string): Promise<number> {
  const rows = await db.select({ id: table.id }).from(table).where(eq(column, id))
  return rows.length
}

export async function mergePreview(db: Db, fromId: string, intoId: string): Promise<MergeCounts> {
  await assertSameWorld(db, fromId, intoId)
  const [taskCount, projectCount, meetingCount, seriesCount, peopleRows, dbRows] = await Promise.all([
    countEq(db, tasks, tasks.workspaceId, fromId),
    countEq(db, projects, projects.workspaceId, fromId),
    countEq(db, meetings, meetings.workspaceId, fromId),
    countEq(db, meetingSeries, meetingSeries.workspaceId, fromId),
    db.select({ id: personWorkspaces.id }).from(personWorkspaces).where(eq(personWorkspaces.workspaceId, fromId)),
    db.select({ id: workspaceNotionDatabases.id }).from(workspaceNotionDatabases).where(eq(workspaceNotionDatabases.workspaceId, fromId)),
  ])
  return {
    tasks: taskCount,
    projects: projectCount,
    meetings: meetingCount,
    series: seriesCount,
    people: peopleRows.length,
    databases: dbRows.length,
  }
}

async function assertSameWorld(db: Db, fromId: string, intoId: string): Promise<void> {
  if (fromId === intoId) throw new Error('אי אפשר למזג סביבה עם עצמה')
  const rows = await db.select().from(workspaces).where(inArray(workspaces.id, [fromId, intoId]))
  const from = rows.find((r) => r.id === fromId)
  const into = rows.find((r) => r.id === intoId)
  if (!from || !into) throw new Error('סביבת העבודה לא נמצאה')
  const fromWorld = from.parentId ?? from.id
  const intoWorld = into.parentId ?? into.id
  if (fromWorld !== intoWorld) throw new Error('אפשר למזג רק סביבות בתוך אותו עולם')
  const children = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.parentId, fromId))
  if (children.length > 0) throw new Error('קודם מעבירים את סביבות העבודה שבתוכו')
}

/** Moves everything that points at `fromId` onto `intoId`, then deletes `fromId`. */
export async function mergeWorkspaces(db: Db, fromId: string, intoId: string): Promise<MergeCounts> {
  const counts = await mergePreview(db, fromId, intoId)
  const now = new Date().toISOString()
  await db.update(tasks).set({ workspaceId: intoId, updatedAt: now }).where(eq(tasks.workspaceId, fromId))
  await db.update(projects).set({ workspaceId: intoId, updatedAt: now }).where(eq(projects.workspaceId, fromId))
  await db.update(meetings).set({ workspaceId: intoId, workspaceSource: 'manual', updatedAt: now }).where(eq(meetings.workspaceId, fromId))
  await db.update(meetingSeries).set({ workspaceId: intoId, updatedAt: now }).where(eq(meetingSeries.workspaceId, fromId))
  await db.update(workspaceNotionDatabases).set({ workspaceId: intoId }).where(eq(workspaceNotionDatabases.workspaceId, fromId))

  const movingPeople = await db.select().from(personWorkspaces).where(eq(personWorkspaces.workspaceId, fromId))
  const kept = await db.select({ personId: personWorkspaces.personId }).from(personWorkspaces).where(eq(personWorkspaces.workspaceId, intoId))
  const keptIds = new Set(kept.map((r) => r.personId))
  for (const row of movingPeople) {
    if (keptIds.has(row.personId)) {
      await db.delete(personWorkspaces).where(eq(personWorkspaces.id, row.id))
    } else {
      await db.update(personWorkspaces).set({ workspaceId: intoId, updatedAt: now }).where(eq(personWorkspaces.id, row.id))
    }
  }

  await moveEntityMemoryLinks(db, 'workspace', fromId, intoId)
  await db.delete(workspaces).where(eq(workspaces.id, fromId))
  return counts
}
