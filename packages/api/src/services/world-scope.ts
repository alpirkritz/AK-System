/**
 * Projects belong to one world (spec: docs/specs/project-world-scoping.md).
 *
 * A world is any `workspaces` row with parentId = null — nothing is hardcoded. Meetings and
 * projects get their world from signals that already exist (series, Notion DB, calendar,
 * attendees, tasks), deterministically. A link between a project and a meeting/task of a
 * different known world is refused when made by hand and skipped when made automatically.
 */
import { TRPCError } from '@trpc/server'
import { and, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm'
import {
  meetingNotes,
  meetingPeople,
  meetingSeries,
  meetings,
  people,
  personWorkspaces,
  projects,
  queryRows,
  runMutation,
  tasks,
  userSettings,
  workspaceCalendars,
  workspaceNotionDatabases,
  workspaces,
  type getDb,
} from '@ak-system/database'
import { isSelfPersonName } from '../lib/self-identity'

type Db = ReturnType<typeof getDb>

export const PROJECT_WORLD_SHARE = 0.8
export const PROJECT_WORLD_MIN = 3
const CACHE_TTL_MS = 5 * 60 * 1000
const SETTINGS_ID = 'default'

export type MeetingWorldSource = 'manual' | 'series' | 'notion' | 'calendar' | 'attendees' | 'project'
export type ProjectWorldSource = 'manual' | 'tasks' | 'meetings'

// ─── World map ──────────────────────────────────────────────────────────────

export interface WorldMap {
  /** workspace id → world id (a world maps to itself) */
  worldOf: Map<string, string>
  names: Map<string, string>
  worlds: Array<{ id: string; name: string; kind: string | null }>
  loadedAt: number
}

const cache = new WeakMap<object, WorldMap>()

export function clearWorldCache(db?: Db): void {
  if (db) cache.delete(db as object)
}

export async function loadWorldMap(db: Db, now = Date.now()): Promise<WorldMap> {
  const hit = cache.get(db as object)
  if (hit && now - hit.loadedAt < CACHE_TTL_MS) return hit
  const rows = await queryRows<{ id: string; name: string; parentId: string | null; kind: string | null }>(
    db.select({ id: workspaces.id, name: workspaces.name, parentId: workspaces.parentId, kind: workspaces.kind }).from(workspaces),
  )
  const worldOf = new Map<string, string>()
  const names = new Map<string, string>()
  for (const r of rows) {
    names.set(r.id, r.name)
    worldOf.set(r.id, r.parentId ?? r.id)
  }
  const map: WorldMap = {
    worldOf,
    names,
    worlds: rows.filter((r) => !r.parentId).map((r) => ({ id: r.id, name: r.name, kind: r.kind })),
    loadedAt: now,
  }
  cache.set(db as object, map)
  return map
}

export function worldOf(map: WorldMap, workspaceId: string | null | undefined): string | null {
  if (!workspaceId) return null
  return map.worldOf.get(workspaceId) ?? null
}

/** The single value shared by at least `share` of `values` (and at least `min` of them), else null. */
export function dominant(values: Array<string | null>, share = PROJECT_WORLD_SHARE, min = PROJECT_WORLD_MIN): string | null {
  const known = values.filter((v): v is string => Boolean(v))
  if (known.length < min) return null
  const counts = new Map<string, number>()
  for (const v of known) counts.set(v, (counts.get(v) ?? 0) + 1)
  const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  return n / known.length >= share ? top : null
}

// ─── Meeting resolution ─────────────────────────────────────────────────────

export interface MeetingSignals {
  manual: string | null
  series: string | null
  notion: string | null
  calendar: string | null
  attendees: string | null
  project: string | null
}

/** Pure precedence step — exported for tests. */
export function pickMeetingWorld(s: MeetingSignals): { world: string; source: MeetingWorldSource } | null {
  // ARO's own tagging first. Notion is an inbound feed: it only fills a world ARO has no
  // signal for, and a disagreement is surfaced as a conflict, never applied silently.
  const order: Array<[MeetingWorldSource, string | null]> = [
    ['manual', s.manual],
    ['series', s.series],
    ['calendar', s.calendar],
    ['attendees', s.attendees],
    ['project', s.project],
    ['notion', s.notion],
  ]
  for (const [source, world] of order) if (world) return { world, source }
  return null
}

export interface MeetingWorldPick {
  id: string
  title: string
  workspaceId: string | null
  workspaceSource: string | null
  signals: MeetingSignals
  pick: { world: string; source: MeetingWorldSource } | null
}

/** Every meeting's signals and the world ARO would pick for it — no writes. */
export async function computeMeetingWorlds(db: Db, meetingIds?: string[]): Promise<MeetingWorldPick[]> {
  const map = await loadWorldMap(db)
  const scope = meetingIds && meetingIds.length > 0 ? inArray(meetings.id, meetingIds) : undefined
  const rows = await queryRows<{
    id: string
    title: string
    workspaceId: string | null
    workspaceSource: string | null
    seriesId: string | null
    calendarId: string | null
    projectId: string | null
  }>(
    db
      .select({
        id: meetings.id,
        title: meetings.title,
        workspaceId: meetings.workspaceId,
        workspaceSource: meetings.workspaceSource,
        seriesId: meetings.seriesId,
        calendarId: meetings.calendarId,
        projectId: meetings.projectId,
      })
      .from(meetings)
      .where(scope),
  )
  if (rows.length === 0) return []

  const [seriesRows, calRows, notionMap, noteRows, attendeeRows, affRows, personRows, projectRows] = await Promise.all([
    queryRows<{ id: string; workspaceId: string | null }>(db.select({ id: meetingSeries.id, workspaceId: meetingSeries.workspaceId }).from(meetingSeries).where(isNotNull(meetingSeries.workspaceId))),
    queryRows<{ calendarId: string; workspaceId: string }>(db.select({ calendarId: workspaceCalendars.calendarId, workspaceId: workspaceCalendars.workspaceId }).from(workspaceCalendars)),
    queryRows<{ workspaceId: string; name: string | null; account: string | null }>(
      db.select({ workspaceId: workspaceNotionDatabases.workspaceId, name: workspaceNotionDatabases.notionDatabaseName, account: workspaceNotionDatabases.accountLabel }).from(workspaceNotionDatabases),
    ),
    queryRows<{ meetingId: string | null; notionDb: string | null; notionAccount: string | null }>(
      db.select({ meetingId: meetingNotes.meetingId, notionDb: meetingNotes.notionDb, notionAccount: meetingNotes.notionAccount }).from(meetingNotes).where(isNotNull(meetingNotes.meetingId)),
    ),
    queryRows<{ meetingId: string; personId: string }>(db.select({ meetingId: meetingPeople.meetingId, personId: meetingPeople.personId }).from(meetingPeople)),
    queryRows<{ personId: string; workspaceId: string }>(db.select({ personId: personWorkspaces.personId, workspaceId: personWorkspaces.workspaceId }).from(personWorkspaces)),
    queryRows<{ id: string; name: string }>(db.select({ id: people.id, name: people.name }).from(people)),
    queryRows<{ id: string; workspaceId: string | null; workspaceSource: string | null }>(
      db.select({ id: projects.id, workspaceId: projects.workspaceId, workspaceSource: projects.workspaceSource }).from(projects),
    ),
  ])

  const seriesWorld = new Map(seriesRows.map((r) => [r.id, worldOf(map, r.workspaceId)]))
  const calendarWorld = new Map(calRows.map((r) => [r.calendarId, worldOf(map, r.workspaceId)]))
  const notionWorldFor = (db_: string | null, account: string | null): string | null => {
    if (!db_) return null
    const hits = notionMap.filter((m) => m.name === db_ && (!m.account || m.account === account))
    const worlds = new Set(hits.map((h) => worldOf(map, h.workspaceId)).filter(Boolean))
    return worlds.size === 1 ? ([...worlds][0] as string) : null
  }
  const notionByMeeting = new Map<string, string | null>()
  for (const n of noteRows) {
    if (!n.meetingId || notionByMeeting.get(n.meetingId)) continue
    notionByMeeting.set(n.meetingId, notionWorldFor(n.notionDb, n.notionAccount))
  }
  const selfIds = new Set(personRows.filter((p) => isSelfPersonName(p.name)).map((p) => p.id))
  const worldsByPerson = new Map<string, Set<string>>()
  for (const a of affRows) {
    const w = worldOf(map, a.workspaceId)
    if (!w) continue
    const set = worldsByPerson.get(a.personId) ?? new Set<string>()
    set.add(w)
    worldsByPerson.set(a.personId, set)
  }
  const attendeesByMeeting = new Map<string, string[]>()
  for (const r of attendeeRows) {
    const list = attendeesByMeeting.get(r.meetingId) ?? []
    list.push(r.personId)
    attendeesByMeeting.set(r.meetingId, list)
  }
  const attendeeWorld = (meetingId: string): string | null => {
    const affiliated = (attendeesByMeeting.get(meetingId) ?? []).filter((p) => !selfIds.has(p) && worldsByPerson.has(p))
    if (affiliated.length === 0) return null
    const all = new Set<string>()
    for (const p of affiliated) for (const w of worldsByPerson.get(p) as Set<string>) all.add(w)
    return all.size === 1 ? [...all][0] : null
  }
  const projectWorld = new Map(
    projectRows.filter((p) => p.workspaceSource !== 'meetings').map((p) => [p.id, worldOf(map, p.workspaceId)]),
  )

  return rows.map((m) => {
    const signals: MeetingSignals = {
      manual: m.workspaceSource === 'manual' ? worldOf(map, m.workspaceId) : null,
      series: m.seriesId ? seriesWorld.get(m.seriesId) ?? null : null,
      notion: notionByMeeting.get(m.id) ?? null,
      calendar: m.calendarId ? calendarWorld.get(m.calendarId) ?? null : null,
      attendees: attendeeWorld(m.id),
      project: m.projectId ? projectWorld.get(m.projectId) ?? null : null,
    }
    return { id: m.id, title: m.title, workspaceId: m.workspaceId, workspaceSource: m.workspaceSource, signals, pick: pickMeetingWorld(signals) }
  })
}

/** Re-resolve non-manual meeting worlds. Returns how many rows changed. */
export async function resolveMeetingWorlds(db: Db, meetingIds?: string[]): Promise<number> {
  const picks = await computeMeetingWorlds(db, meetingIds)
  let changed = 0
  const now = new Date().toISOString()
  for (const m of picks) {
    if (m.workspaceSource === 'manual') continue
    const pick = m.pick
    const nextId = pick?.world ?? null
    const nextSource = pick?.source ?? null
    if (nextId === m.workspaceId && nextSource === m.workspaceSource) continue
    await runMutation(db.update(meetings).set({ workspaceId: nextId, workspaceSource: nextSource, updatedAt: now }).where(eq(meetings.id, m.id)))
    changed++
  }
  return changed
}

// ─── Project resolution ─────────────────────────────────────────────────────

export async function resolveProjectWorlds(db: Db, projectIds?: string[]): Promise<number> {
  const map = await loadWorldMap(db)
  const scope = projectIds && projectIds.length > 0 ? inArray(projects.id, projectIds) : undefined
  const rows = await queryRows<{ id: string; workspaceId: string | null; workspaceSource: string | null }>(
    db.select({ id: projects.id, workspaceId: projects.workspaceId, workspaceSource: projects.workspaceSource }).from(projects).where(scope),
  )
  const ids = rows.map((r) => r.id)
  if (ids.length === 0) return 0
  const [taskRows, meetingRows] = await Promise.all([
    queryRows<{ projectId: string | null; workspaceId: string | null }>(
      db.select({ projectId: tasks.projectId, workspaceId: tasks.workspaceId }).from(tasks).where(inArray(tasks.projectId, ids)),
    ),
    queryRows<{ projectId: string | null; workspaceId: string | null; workspaceSource: string | null }>(
      db
        .select({ projectId: meetings.projectId, workspaceId: meetings.workspaceId, workspaceSource: meetings.workspaceSource })
        .from(meetings)
        .where(inArray(meetings.projectId, ids)),
    ),
  ])
  let changed = 0
  const now = new Date().toISOString()
  for (const p of rows) {
    if (p.workspaceSource === 'manual') continue
    // A world set before this feature existed was set by hand.
    if (p.workspaceId && !p.workspaceSource) {
      await runMutation(db.update(projects).set({ workspaceSource: 'manual' }).where(eq(projects.id, p.id)))
      continue
    }
    const fromTasks = dominant(taskRows.filter((t) => t.projectId === p.id).map((t) => worldOf(map, t.workspaceId)))
    const fromMeetings = fromTasks
      ? null
      : dominant(
          meetingRows
            .filter((m) => m.projectId === p.id && m.workspaceSource !== 'project')
            .map((m) => worldOf(map, m.workspaceId)),
        )
    const next = fromTasks ?? fromMeetings
    const source: ProjectWorldSource | null = fromTasks ? 'tasks' : fromMeetings ? 'meetings' : null
    if (next === p.workspaceId && source === p.workspaceSource) continue
    await runMutation(db.update(projects).set({ workspaceId: next, workspaceSource: source, updatedAt: now }).where(eq(projects.id, p.id)))
    changed++
  }
  return changed
}

/** Meetings first (their own signals), then projects (from tasks/meetings), then meetings again (project signal). */
export async function resolveAllWorlds(db: Db): Promise<{ meetings: number; projects: number }> {
  clearWorldCache(db)
  const m1 = await resolveMeetingWorlds(db)
  const p = await resolveProjectWorlds(db)
  const m2 = await resolveMeetingWorlds(db)
  return { meetings: m1 + m2, projects: p }
}

let backfillChecked = new WeakSet<object>()
export function resetWorldBackfillCheck(): void {
  backfillChecked = new WeakSet<object>()
}

export async function ensureWorldScopeBackfilled(db: Db): Promise<void> {
  if (backfillChecked.has(db as object)) return
  backfillChecked.add(db as object)
  try {
    const rows = await queryRows<{ at: string | null }>(
      db.select({ at: userSettings.worldScopeBackfilledAt }).from(userSettings).where(eq(userSettings.id, SETTINGS_ID)).limit(1),
    )
    if (rows[0]?.at) return
    await resolveAllWorlds(db)
    const at = new Date().toISOString()
    if (rows.length > 0) await runMutation(db.update(userSettings).set({ worldScopeBackfilledAt: at }).where(eq(userSettings.id, SETTINGS_ID)))
    else await runMutation(db.insert(userSettings).values({ id: SETTINGS_ID, worldScopeBackfilledAt: at, updatedAt: at }))
  } catch (err) {
    console.warn('[world-scope] backfill failed; will retry next process start', err)
  }
}

// ─── Conflict checks ────────────────────────────────────────────────────────

export interface WorldCheck {
  ok: boolean
  projectWorld: string | null
  itemWorld: string | null
  projectName: string | null
}

async function projectWorldOf(db: Db, map: WorldMap, projectId: string): Promise<{ world: string | null; name: string | null }> {
  const [p] = await queryRows<{ workspaceId: string | null; name: string }>(
    db.select({ workspaceId: projects.workspaceId, name: projects.name }).from(projects).where(eq(projects.id, projectId)).limit(1),
  )
  return { world: worldOf(map, p?.workspaceId), name: p?.name ?? null }
}

/**
 * Would linking `projectId` to this item cross worlds? The item's world comes from an explicit
 * `workspaceId`, else the meeting's or task's stored world. Unknown on either side → ok.
 */
export async function checkSameWorld(
  db: Db,
  input: { projectId: string | null | undefined; meetingId?: string | null; taskId?: string | null; workspaceId?: string | null },
): Promise<WorldCheck> {
  if (!input.projectId) return { ok: true, projectWorld: null, itemWorld: null, projectName: null }
  const map = await loadWorldMap(db)
  const { world: projectWorld, name } = await projectWorldOf(db, map, input.projectId)
  let itemWorld = worldOf(map, input.workspaceId)
  if (!itemWorld && input.meetingId) {
    const [m] = await queryRows<{ workspaceId: string | null }>(db.select({ workspaceId: meetings.workspaceId }).from(meetings).where(eq(meetings.id, input.meetingId)).limit(1))
    itemWorld = worldOf(map, m?.workspaceId)
  }
  if (!itemWorld && input.taskId) {
    const [t] = await queryRows<{ workspaceId: string | null }>(db.select({ workspaceId: tasks.workspaceId }).from(tasks).where(eq(tasks.id, input.taskId)).limit(1))
    itemWorld = worldOf(map, t?.workspaceId)
  }
  const ok = !projectWorld || !itemWorld || projectWorld === itemWorld
  return { ok, projectWorld, itemWorld, projectName: name }
}

export function worldConflictMessage(map: WorldMap, check: WorldCheck, itemLabel: 'הפגישה' | 'המשימה' | 'הסיכום'): string {
  const pw = check.projectWorld ? map.names.get(check.projectWorld) ?? check.projectWorld : '?'
  const iw = check.itemWorld ? map.names.get(check.itemWorld) ?? check.itemWorld : '?'
  return `הפרויקט ${check.projectName ?? ''} שייך ל-${pw} ו${itemLabel} ל-${iw} — אי אפשר לקשר בין עולמות`
}

/** Manual paths: refuse a cross-world link with a Hebrew message naming both worlds. */
export async function assertSameWorld(
  db: Db,
  input: Parameters<typeof checkSameWorld>[1],
  itemLabel: 'הפגישה' | 'המשימה' | 'הסיכום' = 'הפגישה',
): Promise<void> {
  const check = await checkSameWorld(db, input)
  if (check.ok) return
  const map = await loadWorldMap(db)
  throw new TRPCError({ code: 'BAD_REQUEST', message: worldConflictMessage(map, check, itemLabel) })
}

/** Automatic paths: true when the link may be written; logs and returns false on a conflict. */
export async function sameWorldOrSkip(
  db: Db,
  input: Parameters<typeof checkSameWorld>[1],
  where: string,
): Promise<boolean> {
  try {
    const check = await checkSameWorld(db, input)
    if (!check.ok) console.info(`[world-scope] skipped cross-world project link in ${where}`, input)
    return check.ok
  } catch {
    return true
  }
}

// ─── Conflicts list ─────────────────────────────────────────────────────────

export interface WorldConflict {
  kind: 'meeting' | 'task'
  id: string
  title: string
  projectId: string
  projectName: string
  itemWorld: string
  itemWorldName: string
  projectWorld: string
  projectWorldName: string
}

export async function listWorldConflicts(db: Db): Promise<WorldConflict[]> {
  const map = await loadWorldMap(db)
  const projectRows = await queryRows<{ id: string; name: string; workspaceId: string | null }>(
    db.select({ id: projects.id, name: projects.name, workspaceId: projects.workspaceId }).from(projects).where(isNotNull(projects.workspaceId)),
  )
  const pw = new Map(projectRows.map((p) => [p.id, { world: worldOf(map, p.workspaceId), name: p.name }]))
  if (pw.size === 0) return []
  const ids = [...pw.keys()]
  const [mRows, tRows] = await Promise.all([
    queryRows<{ id: string; title: string; projectId: string; workspaceId: string | null }>(
      db.select({ id: meetings.id, title: meetings.title, projectId: meetings.projectId, workspaceId: meetings.workspaceId }).from(meetings)
        .where(and(inArray(meetings.projectId, ids), isNotNull(meetings.workspaceId))),
    ),
    queryRows<{ id: string; title: string; projectId: string; workspaceId: string | null }>(
      db.select({ id: tasks.id, title: tasks.title, projectId: tasks.projectId, workspaceId: tasks.workspaceId }).from(tasks)
        .where(and(inArray(tasks.projectId, ids), isNotNull(tasks.workspaceId))),
    ),
  ])
  const out: WorldConflict[] = []
  const push = (kind: 'meeting' | 'task', r: { id: string; title: string; projectId: string; workspaceId: string | null }) => {
    const p = pw.get(r.projectId)
    const itemWorld = worldOf(map, r.workspaceId)
    if (!p?.world || !itemWorld || p.world === itemWorld) return
    out.push({
      kind,
      id: r.id,
      title: r.title,
      projectId: r.projectId,
      projectName: p.name,
      itemWorld,
      itemWorldName: map.names.get(itemWorld) ?? itemWorld,
      projectWorld: p.world,
      projectWorldName: map.names.get(p.world) ?? p.world,
    })
  }
  mRows.forEach((r) => push('meeting', r))
  tRows.forEach((r) => push('task', r))
  return out
}

/** unlink: drop the project from the item. move: put the item in the project's world (manual). */
export async function resolveWorldConflict(
  db: Db,
  input: { kind: 'meeting' | 'task'; id: string; action: 'unlink' | 'move' },
): Promise<void> {
  const now = new Date().toISOString()
  const table = input.kind === 'meeting' ? meetings : tasks
  if (input.action === 'unlink') {
    await runMutation(db.update(table).set({ projectId: null, updatedAt: now }).where(eq(table.id, input.id)))
    return
  }
  const [row] = await queryRows<{ projectId: string | null }>(db.select({ projectId: table.projectId }).from(table).where(eq(table.id, input.id)).limit(1))
  if (!row?.projectId) return
  const [p] = await queryRows<{ workspaceId: string | null }>(db.select({ workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, row.projectId)).limit(1))
  if (!p?.workspaceId) return
  if (input.kind === 'meeting') {
    await runMutation(db.update(meetings).set({ workspaceId: p.workspaceId, workspaceSource: 'manual', updatedAt: now }).where(eq(meetings.id, input.id)))
  } else {
    await runMutation(db.update(tasks).set({ workspaceId: p.workspaceId, updatedAt: now }).where(eq(tasks.id, input.id)))
  }
}

// ─── Calendars ──────────────────────────────────────────────────────────────

export async function setCalendarWorld(db: Db, calendarId: string, workspaceId: string | null): Promise<number> {
  await runMutation(db.delete(workspaceCalendars).where(eq(workspaceCalendars.calendarId, calendarId)))
  if (workspaceId) {
    await runMutation(
      db.insert(workspaceCalendars).values({
        id: `wcal_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        workspaceId,
        calendarId,
        createdAt: new Date().toISOString(),
      }),
    )
  }
  const affected = await queryRows<{ id: string }>(
    db.select({ id: meetings.id }).from(meetings).where(and(eq(meetings.calendarId, calendarId), or(isNull(meetings.workspaceSource), ne(meetings.workspaceSource, 'manual')))),
  )
  return resolveMeetingWorlds(db, affected.map((a) => a.id))
}

export async function listCalendarWorlds(db: Db): Promise<Array<{ calendarId: string; workspaceId: string }>> {
  return queryRows(db.select({ calendarId: workspaceCalendars.calendarId, workspaceId: workspaceCalendars.workspaceId }).from(workspaceCalendars))
}

/** Calendars seen on meetings, with how many meetings each — the settings list. */
export async function listKnownCalendars(db: Db): Promise<Array<{ calendarId: string; count: number }>> {
  const rows = await queryRows<{ calendarId: string | null }>(db.select({ calendarId: meetings.calendarId }).from(meetings).where(isNotNull(meetings.calendarId)))
  const counts = new Map<string, number>()
  for (const r of rows) if (r.calendarId) counts.set(r.calendarId, (counts.get(r.calendarId) ?? 0) + 1)
  return [...counts.entries()].map(([calendarId, count]) => ({ calendarId, count })).sort((a, b) => b.count - a.count)
}

/** World of a Notion DB (by name, plus account label when the mapping sets one), or null. */
export async function notionDbWorld(db: Db, notionDb: string | null | undefined, account?: string | null): Promise<string | null> {
  if (!notionDb) return null
  const map = await loadWorldMap(db)
  const rows = await queryRows<{ workspaceId: string; account: string | null }>(
    db
      .select({ workspaceId: workspaceNotionDatabases.workspaceId, account: workspaceNotionDatabases.accountLabel })
      .from(workspaceNotionDatabases)
      .where(eq(workspaceNotionDatabases.notionDatabaseName, notionDb)),
  )
  const worlds = new Set(rows.filter((r) => !r.account || r.account === account).map((r) => worldOf(map, r.workspaceId)).filter(Boolean))
  return worlds.size === 1 ? ([...worlds][0] as string) : null
}

// ─── Notion disagreements ───────────────────────────────────────────────────

export interface NotionWorldDisagreement {
  meetingId: string
  title: string
  aroWorld: string
  aroWorldName: string
  aroSource: MeetingWorldSource
  notionWorld: string
  notionWorldName: string
}

/**
 * Meetings where ARO's own signal and the Notion DB name different worlds. ARO's world is the
 * one stored; the owner decides. Manual meetings are settled and never listed.
 */
export async function listNotionWorldDisagreements(db: Db): Promise<NotionWorldDisagreement[]> {
  const map = await loadWorldMap(db)
  const picks = await computeMeetingWorlds(db)
  const out: NotionWorldDisagreement[] = []
  for (const m of picks) {
    if (m.workspaceSource === 'manual' || !m.pick || m.pick.source === 'notion') continue
    const notion = m.signals.notion
    if (!notion || notion === m.pick.world) continue
    out.push({
      meetingId: m.id,
      title: m.title,
      aroWorld: m.pick.world,
      aroWorldName: map.names.get(m.pick.world) ?? m.pick.world,
      aroSource: m.pick.source,
      notionWorld: notion,
      notionWorldName: map.names.get(notion) ?? notion,
    })
  }
  return out
}

/** Settle a disagreement by pinning the meeting's world by hand — ARO's or Notion's. */
export async function settleNotionDisagreement(db: Db, meetingId: string, keep: 'aro' | 'notion'): Promise<void> {
  const [m] = (await computeMeetingWorlds(db, [meetingId]))
  if (!m) return
  const world = keep === 'notion' ? m.signals.notion : m.pick?.source === 'notion' ? null : m.pick?.world ?? null
  if (!world) return
  await assertSameWorld(db, { projectId: (await queryRows<{ projectId: string | null }>(db.select({ projectId: meetings.projectId }).from(meetings).where(eq(meetings.id, meetingId)).limit(1)))[0]?.projectId, workspaceId: world })
  await runMutation(
    db.update(meetings).set({ workspaceId: world, workspaceSource: 'manual', updatedAt: new Date().toISOString() }).where(eq(meetings.id, meetingId)),
  )
}
