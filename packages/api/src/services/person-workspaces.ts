/**
 * A person's life-domain affiliations (DAZ / Dragontail / Alpir Consulting / personal).
 * Many-to-many: one row per (person, workspace), each with its own relationship type
 * and an optional reports-to line that only holds inside that workspace.
 */

import { getDb, people, personWorkspaces, workspaces } from '@ak-system/database'
import { and, eq, inArray } from 'drizzle-orm'
import { expandWorkspaceFilter } from './workspace-scope'

type Db = ReturnType<typeof getDb>

export interface PersonAffiliation {
  id: string
  personId: string
  workspaceId: string
  workspaceName: string
  workspaceColor: string | null
  workspaceKind: string | null
  relationshipType: string
  reportsToPersonId: string | null
  reportsToName: string | null
  notes: string | null
}

export interface LinkToWorkspaceInput {
  personId: string
  workspaceId: string
  relationshipType: string
  reportsToPersonId?: string | null
  notes?: string | null
}

const CHUNK = 200

function newId(): string {
  return 'pw_' + Date.now() + Math.random().toString(36).slice(2, 7)
}

/** Affiliations for many people at once, keyed by person id. People without any get no entry. */
export async function listAffiliations(db: Db, personIds: string[]): Promise<Map<string, PersonAffiliation[]>> {
  const out = new Map<string, PersonAffiliation[]>()
  const ids = [...new Set(personIds)]
  if (ids.length === 0) return out

  const rows: Array<Omit<PersonAffiliation, 'reportsToName'>> = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    rows.push(
      ...(await db
        .select({
          id: personWorkspaces.id,
          personId: personWorkspaces.personId,
          workspaceId: personWorkspaces.workspaceId,
          workspaceName: workspaces.name,
          workspaceColor: workspaces.color,
          workspaceKind: workspaces.kind,
          relationshipType: personWorkspaces.relationshipType,
          reportsToPersonId: personWorkspaces.reportsToPersonId,
          notes: personWorkspaces.notes,
        })
        .from(personWorkspaces)
        .innerJoin(workspaces, eq(workspaces.id, personWorkspaces.workspaceId))
        .where(inArray(personWorkspaces.personId, chunk))),
    )
  }

  const managerIds = [...new Set(rows.map((r) => r.reportsToPersonId).filter((v): v is string => !!v))]
  const managerName = new Map<string, string>()
  for (let i = 0; i < managerIds.length; i += CHUNK) {
    const found = await db
      .select({ id: people.id, name: people.name })
      .from(people)
      .where(inArray(people.id, managerIds.slice(i, i + CHUNK)))
    for (const m of found) managerName.set(m.id, m.name)
  }

  for (const r of rows) {
    const list = out.get(r.personId) ?? []
    list.push({ ...r, reportsToName: r.reportsToPersonId ? managerName.get(r.reportsToPersonId) ?? null : null })
    out.set(r.personId, list)
  }
  for (const list of out.values()) list.sort((a, b) => a.workspaceName.localeCompare(b.workspaceName))
  return out
}

/** Creates or updates the single row for (personId, workspaceId). */
export async function upsertAffiliation(db: Db, input: LinkToWorkspaceInput): Promise<PersonAffiliation> {
  const relationshipType = input.relationshipType.trim()
  if (!relationshipType) throw new Error('סוג הקשר חסר')
  if (input.reportsToPersonId && input.reportsToPersonId === input.personId) {
    throw new Error('אדם לא יכול לדווח לעצמו')
  }

  const [person] = await db.select({ id: people.id }).from(people).where(eq(people.id, input.personId)).limit(1)
  if (!person) throw new Error('איש הקשר לא נמצא')
  const [ws] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).limit(1)
  if (!ws) throw new Error('העולם לא נמצא')
  if (input.reportsToPersonId) {
    const [manager] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.id, input.reportsToPersonId))
      .limit(1)
    if (!manager) throw new Error('האדם שמדווחים אליו לא נמצא')
  }

  const now = new Date().toISOString()
  const values = {
    relationshipType,
    reportsToPersonId: input.reportsToPersonId ?? null,
    notes: input.notes?.trim() || null,
    updatedAt: now,
  }
  const [existing] = await db
    .select({ id: personWorkspaces.id })
    .from(personWorkspaces)
    .where(and(eq(personWorkspaces.personId, input.personId), eq(personWorkspaces.workspaceId, input.workspaceId)))
    .limit(1)

  if (existing) {
    await db.update(personWorkspaces).set(values).where(eq(personWorkspaces.id, existing.id))
  } else {
    await db.insert(personWorkspaces).values({
      id: newId(),
      personId: input.personId,
      workspaceId: input.workspaceId,
      ...values,
      createdAt: now,
    })
  }

  const affiliations = (await listAffiliations(db, [input.personId])).get(input.personId) ?? []
  return affiliations.find((a) => a.workspaceId === input.workspaceId)!
}

export async function removeAffiliation(db: Db, personId: string, workspaceId: string): Promise<void> {
  await db
    .delete(personWorkspaces)
    .where(and(eq(personWorkspaces.personId, personId), eq(personWorkspaces.workspaceId, workspaceId)))
}

/** Person ids affiliated with a world (including its workspaces) or a single workspace. */
export async function personIdsInWorkspace(db: Db, workspaceId: string): Promise<string[]> {
  const ids = await expandWorkspaceFilter(db, workspaceId)
  if (ids.length === 0) return []
  const rows = await db
    .select({ personId: personWorkspaces.personId })
    .from(personWorkspaces)
    .where(inArray(personWorkspaces.workspaceId, ids))
  return [...new Set(rows.map((r) => r.personId))]
}

/**
 * Merge support: moves `fromId`'s affiliations onto `toId` (the kept row wins on a shared
 * workspace) and repoints anyone who reported to `fromId`.
 */
export async function repointPersonWorkspaces(db: Db, fromId: string, toId: string): Promise<void> {
  if (fromId === toId) return
  const kept = new Set(
    (
      await db
        .select({ workspaceId: personWorkspaces.workspaceId })
        .from(personWorkspaces)
        .where(eq(personWorkspaces.personId, toId))
    ).map((r) => r.workspaceId),
  )
  const moving = await db.select().from(personWorkspaces).where(eq(personWorkspaces.personId, fromId))
  const now = new Date().toISOString()
  for (const row of moving) {
    if (kept.has(row.workspaceId)) {
      await db.delete(personWorkspaces).where(eq(personWorkspaces.id, row.id))
    } else {
      await db.update(personWorkspaces).set({ personId: toId, updatedAt: now }).where(eq(personWorkspaces.id, row.id))
    }
  }
  await db
    .update(personWorkspaces)
    .set({ reportsToPersonId: toId, updatedAt: now })
    .where(eq(personWorkspaces.reportsToPersonId, fromId))
  // A row can now point at itself if toId reported to fromId.
  await db
    .update(personWorkspaces)
    .set({ reportsToPersonId: null })
    .where(and(eq(personWorkspaces.personId, toId), eq(personWorkspaces.reportsToPersonId, toId)))
}

/** Removes affiliations owned by or pointing at deleted people, for drivers that skip FK cascades. */
export async function clearPersonWorkspaces(db: Db, personIds: string[]): Promise<void> {
  for (let i = 0; i < personIds.length; i += CHUNK) {
    const chunk = personIds.slice(i, i + CHUNK)
    await db.delete(personWorkspaces).where(inArray(personWorkspaces.personId, chunk))
    await db
      .update(personWorkspaces)
      .set({ reportsToPersonId: null })
      .where(inArray(personWorkspaces.reportsToPersonId, chunk))
  }
}
