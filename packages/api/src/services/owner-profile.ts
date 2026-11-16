/**
 * The principal's roles, current priorities and principles (spec: owner-priorities-profile).
 * Injected into every agent prompt right after the identity block.
 */
import { createHash, randomBytes } from 'node:crypto'
import { eq, isNotNull, isNull } from 'drizzle-orm'
import { getDb, meetings, ownerProfile, projects, queryRows, runMutation, workspaces } from '@ak-system/database'

type Db = ReturnType<typeof getDb>

export const MAX_PRIORITIES = 7
export const PROFILE_CHAR_CAP = 2500
export const PRIORITIES_STALE_DAYS = 14
const PROFILE_ID = 'default'
const TOKEN_TTL_MS = 30 * 60 * 1000

export interface OwnerPriority {
  id: string
  title: string
  projectId?: string | null
  workspaceId?: string | null
  /** YYYY-MM-DD; past it the priority is hidden and reported as expired. */
  until?: string | null
}

export interface OwnerProfileData {
  roles: string
  priorities: OwnerPriority[]
  principles: string
  updatedAt: string | null
}

export function newPriorityId(): string {
  return `pri_${randomBytes(6).toString('hex')}`
}

function parsePriorities(raw: string | null | undefined): OwnerPriority[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as OwnerPriority[]).filter((p) => p && typeof p.title === 'string') : []
  } catch {
    return []
  }
}

export async function getOwnerProfile(db: Db): Promise<OwnerProfileData> {
  const [row] = await queryRows<{ roles: string | null; priorities: string | null; principles: string | null; updatedAt: string }>(
    db.select().from(ownerProfile).where(eq(ownerProfile.id, PROFILE_ID)).limit(1),
  )
  return {
    roles: row?.roles ?? '',
    priorities: parsePriorities(row?.priorities),
    principles: row?.principles ?? '',
    updatedAt: row?.updatedAt ?? null,
  }
}

export async function setOwnerProfile(
  db: Db,
  patch: { roles?: string; priorities?: Array<Omit<OwnerPriority, 'id'> & { id?: string }>; principles?: string },
): Promise<OwnerProfileData> {
  const current = await getOwnerProfile(db)
  const priorities = patch.priorities
    ? patch.priorities.slice(0, MAX_PRIORITIES).map((p) => ({ ...p, id: p.id || newPriorityId(), title: p.title.trim() }))
    : current.priorities
  const now = new Date().toISOString()
  const values = {
    roles: patch.roles ?? current.roles,
    priorities: JSON.stringify(priorities),
    principles: patch.principles ?? current.principles,
    updatedAt: now,
  }
  if (current.updatedAt) {
    await runMutation(db.update(ownerProfile).set(values).where(eq(ownerProfile.id, PROFILE_ID)))
  } else {
    await runMutation(db.insert(ownerProfile).values({ id: PROFILE_ID, ...values }))
  }
  return { ...values, priorities }
}

// ─── Prompt block ───────────────────────────────────────────────────────────

export interface WorldLine {
  name: string
  kind: string | null
  description: string | null
  /** Project names in this world, most recently active first (project-world-scoping). */
  projects?: string[]
}

export const WORLD_PROJECTS_SHOWN = 12

/** Pure renderer — exported for tests. '' when nothing is filled in. */
export function renderOwnerProfileBlock(
  profile: OwnerProfileData,
  context: {
    worlds: WorldLine[]
    projectNames: Map<string, string>
    workspaceNames: Map<string, string>
    /** Projects whose world is not known yet. */
    unassignedProjects?: string[]
  },
  today = new Date().toISOString().slice(0, 10),
): string {
  const active = profile.priorities.filter((p) => !p.until || p.until >= today)
  const expired = profile.priorities.filter((p) => p.until && p.until < today)
  if (!profile.roles.trim() && active.length === 0 && !profile.principles.trim() && context.worlds.length === 0) return ''

  const lines: string[] = ['## על אלפיר — תפקידים ועדיפויות']
  if (profile.roles.trim()) lines.push('', '### תפקידים', profile.roles.trim())
  if (active.length > 0) {
    lines.push('', '### עדיפויות עכשיו (rank everything against these, in order)')
    active.forEach((p, i) => {
      const tags = [
        p.projectId ? context.projectNames.get(p.projectId) : null,
        p.workspaceId ? context.workspaceNames.get(p.workspaceId) : null,
        p.until ? `עד ${p.until}` : null,
      ].filter(Boolean)
      lines.push(`${i + 1}. ${p.title}${tags.length ? ` (${tags.join(' · ')})` : ''}`)
    })
  }
  if (expired.length > 0) lines.push(`פג תוקף: ${expired.map((p) => p.title).join(', ')} — שאל אם עדיין רלוונטי.`)
  if (profile.principles.trim()) lines.push('', '### עקרונות', profile.principles.trim())
  if (context.worlds.length > 0) {
    lines.push('', '### עולמות')
    for (const w of context.worlds) {
      lines.push(`- ${w.name}${w.kind ? ` (${w.kind})` : ''}${w.description ? ` — ${w.description}` : ''}`)
      const names = w.projects ?? []
      if (names.length > 0) {
        const more = names.length > WORLD_PROJECTS_SHOWN ? ` +${names.length - WORLD_PROJECTS_SHOWN}` : ''
        lines.push(`  פרויקטים: ${names.slice(0, WORLD_PROJECTS_SHOWN).join(', ')}${more}`)
      }
    }
    const unassigned = context.unassignedProjects ?? []
    if (unassigned.length > 0) {
      const more = unassigned.length > WORLD_PROJECTS_SHOWN ? ` +${unassigned.length - WORLD_PROJECTS_SHOWN}` : ''
      lines.push(`- ללא עולם: ${unassigned.slice(0, WORLD_PROJECTS_SHOWN).join(', ')}${more}`)
    }
    lines.push('A project belongs to exactly one world. Never attach, suggest or brief a project inside a meeting or task of another world; if a meeting\'s world is unknown, say so instead of guessing.')
  }
  let text = lines.join('\n')
  if (text.length > PROFILE_CHAR_CAP) text = text.slice(0, text.lastIndexOf('\n', PROFILE_CHAR_CAP))
  return text
}

export async function buildOwnerProfileBlock(db?: Db, today?: string): Promise<string> {
  db = db ?? getDb()
  const [profile, worldRows, projectRows, workspaceRows, lastMeetings] = await Promise.all([
    getOwnerProfile(db),
    queryRows<WorldLine & { id: string }>(
      db.select({ id: workspaces.id, name: workspaces.name, kind: workspaces.kind, description: workspaces.description }).from(workspaces).where(isNull(workspaces.parentId)),
    ),
    queryRows<{ id: string; name: string; workspaceId: string | null }>(db.select({ id: projects.id, name: projects.name, workspaceId: projects.workspaceId }).from(projects)),
    queryRows<{ id: string; name: string; parentId: string | null }>(db.select({ id: workspaces.id, name: workspaces.name, parentId: workspaces.parentId }).from(workspaces)),
    queryRows<{ projectId: string | null; date: string }>(db.select({ projectId: meetings.projectId, date: meetings.date }).from(meetings).where(isNotNull(meetings.projectId))),
  ])
  const worldOfWs = new Map(workspaceRows.map((w) => [w.id, w.parentId ?? w.id]))
  const lastByProject = new Map<string, string>()
  for (const m of lastMeetings) {
    if (m.projectId && (!lastByProject.has(m.projectId) || m.date > (lastByProject.get(m.projectId) as string))) lastByProject.set(m.projectId, m.date)
  }
  const byRecency = (a: { id: string }, b: { id: string }) => (lastByProject.get(b.id) ?? '').localeCompare(lastByProject.get(a.id) ?? '')
  const projectsInWorld = (worldId: string | null) =>
    projectRows
      .filter((p) => (p.workspaceId ? worldOfWs.get(p.workspaceId) ?? null : null) === worldId)
      .sort(byRecency)
      .map((p) => p.name)
  return renderOwnerProfileBlock(
    profile,
    {
      worlds: worldRows.map((w) => ({ ...w, projects: projectsInWorld(w.id) })),
      projectNames: new Map(projectRows.map((p) => [p.id, p.name])),
      workspaceNames: new Map(workspaceRows.map((w) => [w.id, w.name])),
      unassignedProjects: projectsInWorld(null),
    },
    today,
  )
}

/** Days since priorities were last saved; null when never set. */
export function prioritiesAgeDays(profile: OwnerProfileData, now = new Date()): number | null {
  if (!profile.updatedAt) return null
  return Math.floor((now.getTime() - new Date(profile.updatedAt).getTime()) / 86400000)
}

// ─── Propose / apply (Hugo, confirmation-gated) ─────────────────────────────

export interface PriorityDiff {
  added: string[]
  removed: string[]
  reordered: boolean
  next: string[]
}

export function diffPriorities(current: OwnerPriority[], next: string[]): PriorityDiff {
  const norm = (t: string) => t.trim().toLowerCase()
  const cur = current.map((p) => p.title)
  const curSet = new Set(cur.map(norm))
  const nextSet = new Set(next.map(norm))
  const added = next.filter((t) => !curSet.has(norm(t)))
  const removed = cur.filter((t) => !nextSet.has(norm(t)))
  const kept = next.filter((t) => curSet.has(norm(t))).map(norm)
  const keptInCurrentOrder = cur.map(norm).filter((t) => nextSet.has(t))
  return { added, removed, reordered: kept.join('|') !== keptInCurrentOrder.join('|'), next }
}

interface PendingUpdate {
  titles: string[]
  diffHash: string
  expiresAt: number
}

const pending = new Map<string, PendingUpdate>()

function hashDiff(titles: string[]): string {
  return createHash('sha1').update(JSON.stringify(titles)).digest('hex')
}

export async function proposePrioritiesUpdate(
  db: Db,
  titles: string[],
  now = Date.now(),
): Promise<{ token: string; diff: PriorityDiff }> {
  const clean = titles.map((t) => t.trim()).filter(Boolean).slice(0, MAX_PRIORITIES)
  const profile = await getOwnerProfile(db)
  const diff = diffPriorities(profile.priorities, clean)
  const token = randomBytes(9).toString('base64url')
  for (const [k, v] of pending) if (v.expiresAt < now) pending.delete(k)
  pending.set(token, { titles: clean, diffHash: hashDiff(clean), expiresAt: now + TOKEN_TTL_MS })
  return { token, diff }
}

/** Single-use, time-limited, bound to the exact titles that were proposed. */
export async function applyPrioritiesUpdate(db: Db, token: string, now = Date.now()): Promise<OwnerProfileData> {
  const entry = pending.get(token)
  pending.delete(token)
  if (!entry || entry.expiresAt < now || entry.diffHash !== hashDiff(entry.titles)) {
    throw new Error('ההצעה פגה או כבר הוחלה — הצע שוב')
  }
  const profile = await getOwnerProfile(db)
  const byTitle = new Map(profile.priorities.map((p) => [p.title.trim().toLowerCase(), p]))
  const priorities = entry.titles.map((title) => byTitle.get(title.toLowerCase()) ?? { id: newPriorityId(), title })
  return setOwnerProfile(db, { priorities })
}
