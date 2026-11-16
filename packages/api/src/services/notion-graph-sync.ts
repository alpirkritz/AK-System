/**
 * Sync Notion companies, projects, and meeting notes into the app DB and
 * rewrite relationship edges (project_people, meeting_note_*).
 *
 * People directories are upserted via the same identity path as task sync
 * (person_external_ids across every configured people DB).
 */

import { notionDbWorld, sameWorldOrSkip } from './world-scope'
import { resolveNotionPatch, updateFromNotion } from './notion-local-wins'
import {
  getDb,
  companies,
  projects,
  projectPeople,
  meetings,
  meetingPeople,
  meetingNotes,
  meetingNotePeople,
  meetingNoteProjects,
  people,
  tasks,
  eq,
  and,
  inArray,
} from '@ak-system/database'
import { resolveDatabases } from './notion-tasks-sync'
import { findPersonIdByNotionPageId, upsertPersonExternalId } from './person-external-ids'
import { titlesShareKnownPerson } from '../lib/person-name-match'
import {
  MEETING_NOTE_BODY_CAP,
  fetchMeetingNoteBodyText,
  flattenNotionBlocksToText,
  shouldFetchNoteBody,
  upsertInPageMeetingNote,
  type ExistingNoteMeta,
} from './notion-meeting-note-body'

export { MEETING_NOTE_BODY_CAP, flattenNotionBlocksToText, shouldFetchNoteBody, fetchMeetingNoteBodyText }

const NOTION_VERSION = '2022-06-28'

type Db = ReturnType<typeof getDb>
type NotionProp = Record<string, unknown>

type NotionPageRow = {
  id: string
  url?: string
  last_edited_time?: string
  properties: Record<string, NotionProp>
  // Page title from Notion API (exists when querying pages, might be missing in some queries)
  title?: Array<{ plain_text?: string }>
}

export interface NotionGraphSyncResult {
  companiesUpserted: number
  projectsUpserted: number
  meetingsUpserted: number
  tasksLinked: number
  notesUpserted: number
  notesPruned: number
  peopleIdentitiesUpserted: number
  linksRewritten: number
  errors: string[]
}

export interface NotionGraphSyncOptions {
  windowDays?: number
  dryRun?: boolean
  /** `meetings` skips companies/projects/people and uses the requested window (not a 180-day floor). */
  scope?: 'full' | 'meetings'
}

/** Full graph keeps a 180-day meetings floor so old pages still link; meetings-only uses the asked window. */
export function meetingsActivityWindowDays(
  windowDays: number,
  scope: 'full' | 'meetings' = 'full',
): number {
  return scope === 'meetings' ? windowDays : Math.max(windowDays, 180)
}

function newId(prefix: string): string {
  return prefix + Date.now() + Math.random().toString(36).slice(2, 7)
}

async function queryDatabase(
  token: string,
  databaseId: string,
  filter?: Record<string, unknown>,
): Promise<NotionPageRow[]> {
  const pages: NotionPageRow[] = []
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
      results: NotionPageRow[]
      has_more: boolean
      next_cursor: string | null
    }
    pages.push(...data.results)
    cursor = data.has_more ? data.next_cursor ?? undefined : undefined
  } while (cursor)
  return pages
}

function recentActivityFilter(windowDays: number): Record<string, unknown> {
  const cutoff = new Date(Date.now() - windowDays * 86400000).toISOString()
  return {
    or: [
      { timestamp: 'created_time', created_time: { on_or_after: cutoff } },
      { timestamp: 'last_edited_time', last_edited_time: { on_or_after: cutoff } },
    ],
  }
}

function richTextValue(prop: NotionProp): string {
  const t = prop.type as string
  if (t === 'title') {
    return ((prop.title as Array<{ plain_text?: string }>) ?? []).map((x) => x.plain_text ?? '').join('')
  }
  if (t === 'rich_text') {
    return ((prop.rich_text as Array<{ plain_text?: string }>) ?? []).map((x) => x.plain_text ?? '').join('')
  }
  return ''
}

/**
 * Get page title - tries Subject field first (for Meetings DB), then title field
 */
function getPageTitle(page: NotionPageRow): string {
  // Try "Subject" property first (used in Meetings database)
  const subjectProp = page.properties['Subject'] || page.properties['subject']
  if (subjectProp) {
    const subject = richTextValue(subjectProp).trim()
    if (subject) {
      // Remove @timestamp suffix if present (e.g., "@Yesterday 11:34 AM")
      return subject.replace(/\s*@[^@]+$/, '').trim()
    }
  }
  
  // Fallback to standard title property
  return getTitle(page.properties)
}

function getTitle(props: Record<string, NotionProp>): string {
  for (const v of Object.values(props)) {
    if (v?.type === 'title') return richTextValue(v).trim()
  }
  return ''
}

function getDate(props: Record<string, NotionProp>): string | null {
  for (const v of Object.values(props)) {
    if (v?.type === 'date' && v.date) {
      const start = (v.date as { start?: string }).start ?? ''
      if (start) return start.slice(0, 10)
    }
  }
  return null
}

function getSnippet(props: Record<string, NotionProp>): string | null {
  for (const [name, v] of Object.entries(props)) {
    if (v?.type !== 'rich_text') continue
    const lname = name.toLowerCase()
    if (/summary|notes|snippet|תיאור|סיכום|הערות/.test(lname) || name.includes('סיכום')) {
      const text = richTextValue(v).trim()
      if (text) return text.slice(0, 500)
    }
  }
  for (const v of Object.values(props)) {
    if (v?.type === 'rich_text') {
      const text = richTextValue(v).trim()
      if (text) return text.slice(0, 500)
    }
  }
  return null
}

function getRelationIds(props: Record<string, NotionProp>): string[] {
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

/** Relation ids whose property name looks like people / projects / companies / meeting / tasks. */
function getTypedRelationIds(
  props: Record<string, NotionProp>,
  kind: 'people' | 'projects' | 'companies' | 'meeting' | 'tasks',
): string[] {
  const patterns: Record<typeof kind, RegExp> = {
    people: /people|person|אנשים|אנשי\s*קשר|attendee|participant/i,
    projects: /project|פרויקט/i,
    companies: /compan|company|ארגון|חברה|client|לקוח/i,
    meeting: /meeting|פגישה|ישיבה/i,
    tasks: /task|todo|action|משימ|todos/i,
  }
  const re = patterns[kind]
  const ids: string[] = []
  for (const [name, v] of Object.entries(props)) {
    if (v?.type !== 'relation' || !Array.isArray(v.relation)) continue
    if (!re.test(name)) continue
    for (const r of v.relation as Array<{ id?: string }>) {
      if (r?.id) ids.push(r.id)
    }
  }
  return ids
}

function getDateTime(props: Record<string, NotionProp>): { date: string; time: string } | null {
  for (const v of Object.values(props)) {
    if (v?.type === 'date' && v.date) {
      const start = (v.date as { start?: string }).start ?? ''
      if (!start) continue
      const date = start.slice(0, 10)
      let time = '09:00'
      if (start.includes('T')) {
        const t = start.split('T')[1] ?? ''
        time = t.slice(0, 5) || '09:00'
      }
      return { date, time }
    }
  }
  return null
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Notion meeting titles often append a raw ISO timestamp
 * (e.g. "Deployments Meeting  2026-07-23T16:00:00.000+03:00").
 * Strip that — date/time live in dedicated fields.
 */
export function cleanMeetingTitle(raw: string): string {
  return raw
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.+-]+Z?/g, '')
    .replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?/g, '')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s|·\-–—:]+$/g, '')
    .trim()
}

/** Exported for Vitest — same-day meeting ↔ note title heuristic. */
export function titlesFuzzyMatch(a: string, b: string): boolean {
  const na = normalizeTitle(cleanMeetingTitle(a))
  const nb = normalizeTitle(cleanMeetingTitle(b))
  if (!na || !nb) return false
  if (na === nb) return true
  return na.includes(nb) || nb.includes(na)
}

export function isNotionGraphConfigured(): boolean {
  // Accept any of: meetings, meeting_notes, projects, companies, or people
  // meetings DB alone is enough — it holds the core relationship graph
  return (
    resolveDatabases('meetings').length > 0 ||
    resolveDatabases('meeting_notes').length > 0 ||
    resolveDatabases('projects').length > 0 ||
    resolveDatabases('companies').length > 0 ||
    resolveDatabases('people').length > 0
  )
}

export function listConfiguredGraphDatabases(): Array<{ type: string; name: string; account: string }> {
  const types = ['people', 'projects', 'companies', 'meetings', 'meeting_notes'] as const
  const out: Array<{ type: string; name: string; account: string }> = []
  for (const type of types) {
    for (const db of resolveDatabases(type)) {
      out.push({ type, name: db.name, account: db.accountLabel })
    }
  }
  return out
}

export async function syncNotionGraph(
  opts: NotionGraphSyncOptions = {},
  db: Db = getDb(),
): Promise<NotionGraphSyncResult> {
  const windowDays = opts.windowDays ?? 90
  const dryRun = opts.dryRun ?? false
  const scope = opts.scope ?? 'full'
  const result: NotionGraphSyncResult = {
    companiesUpserted: 0,
    projectsUpserted: 0,
    meetingsUpserted: 0,
    tasksLinked: 0,
    notesUpserted: 0,
    notesPruned: 0,
    peopleIdentitiesUpserted: 0,
    linksRewritten: 0,
    errors: [],
  }

  if (!isNotionGraphConfigured()) {
    throw new Error('לא הוגדרו מסדי Notion לגרף קשר (meetings/meeting_notes/people/projects/companies)')
  }

  const now = new Date().toISOString()

  // Refresh people identities first (every people DB → person_external_ids).
  if (scope === 'full') {
    await syncPeopleIdentitiesOnly(db, dryRun, result)
  }

  const companyIdByNotion = new Map<string, string>()
  const projectIdByNotion = new Map<string, string>()

  const existingCompanies = await db
    .select({ id: companies.id, notionPageId: companies.notionPageId })
    .from(companies)
  for (const c of existingCompanies) {
    if (c.notionPageId) companyIdByNotion.set(c.notionPageId, c.id)
  }

  const existingProjects = await db
    .select({ id: projects.id, notionPageId: projects.notionPageId })
    .from(projects)
  for (const p of existingProjects) {
    if (p.notionPageId) projectIdByNotion.set(p.notionPageId, p.id)
  }

  // ── Companies ──
  if (scope === 'full') for (const database of resolveDatabases('companies')) {
    let pages: Array<{ id: string; properties: Record<string, NotionProp> }>
    try {
      pages = await queryDatabase(database.token, database.databaseId)
    } catch (err) {
      result.errors.push(`companies/${database.name}: ${err instanceof Error ? err.message : 'query failed'}`)
      continue
    }
    for (const page of pages) {
      const name = getTitle(page.properties)
      if (!name) continue
      let id = companyIdByNotion.get(page.id)
      if (id) {
        if (!dryRun) {
          await updateFromNotion(db, companies, 'company', id, { name }, { notionPageId: page.id, updatedAt: now })
        }
      } else {
        id = newId('co_notion_')
        if (!dryRun) {
          await db.insert(companies).values({
            id,
            name,
            taxIdType: 'company',
            country: 'IL',
            preferredLanguage: 'he',
            notionPageId: page.id,
            createdAt: now,
            updatedAt: now,
          })
        }
        companyIdByNotion.set(page.id, id)
      }
      result.companiesUpserted++
    }
  }

  // Pending edges collected while reading projects (applied after meetings/tasks exist).
  const projectMeetingRels = new Map<string, string[]>() // localProjectId → notion meeting page ids
  const projectTaskRels = new Map<string, string[]>()
  const projectDirectPeople = new Map<string, string[]>() // localProjectId → notion people page ids

  // ── Projects ──
  if (scope === 'full') for (const database of resolveDatabases('projects')) {
    let pages: Array<{ id: string; properties: Record<string, NotionProp> }>
    try {
      pages = await queryDatabase(database.token, database.databaseId)
    } catch (err) {
      result.errors.push(`projects/${database.name}: ${err instanceof Error ? err.message : 'query failed'}`)
      continue
    }
    for (const page of pages) {
      const name = getTitle(page.properties)
      if (!name) continue
      const companyRel = getTypedRelationIds(page.properties, 'companies')
      const companyId = companyRel.map((rid) => companyIdByNotion.get(rid)).find(Boolean) ?? null
      const peopleRels = getTypedRelationIds(page.properties, 'people')
      const meetingRels = getTypedRelationIds(page.properties, 'meeting')
      const taskRels = getTypedRelationIds(page.properties, 'tasks')

      let id = projectIdByNotion.get(page.id)
      if (id) {
        if (!dryRun) {
          await updateFromNotion(
            db,
            projects,
            'project',
            id,
            { name, companyId },
            { notionPageId: page.id, source: 'notion', updatedAt: now },
          )
        }
      } else {
        id = newId('proj_notion_')
        if (!dryRun) {
          await db.insert(projects).values({
            id,
            name,
            color: '#47b8e8',
            notionPageId: page.id,
            companyId,
            source: 'notion',
            createdAt: now,
            updatedAt: now,
          })
        }
        projectIdByNotion.set(page.id, id)
      }
      result.projectsUpserted++
      if (id) {
        projectMeetingRels.set(id, meetingRels)
        projectTaskRels.set(id, taskRels)
        projectDirectPeople.set(id, peopleRels)
      }
    }
  }

  // ── Notion Meetings (title/date/people/projects) ──
  const meetingIdByNotion = new Map<string, string>()
  const existingMeetings = await db
    .select({
      id: meetings.id,
      title: meetings.title,
      date: meetings.date,
      notionPageId: meetings.notionPageId,
      projectId: meetings.projectId,
    })
    .from(meetings)
  for (const m of existingMeetings) {
    if (m.notionPageId) meetingIdByNotion.set(m.notionPageId, m.id)
  }

  const knownPersonNames = (await db.select({ name: people.name }).from(people)).map((p) => p.name)

  const meetingPagesForNotes: Array<{
    pageId: string
    url: string | null
    lastEdited: string | null
    title: string
    date: string
    meetingId: string
    token: string
    accountLabel: string
    dbName: string
  }> = []

  const meetingsFilter = recentActivityFilter(meetingsActivityWindowDays(windowDays, scope))
  for (const database of resolveDatabases('meetings')) {
    let pages: NotionPageRow[]
    try {
      pages = await queryDatabase(database.token, database.databaseId, meetingsFilter)
    } catch (err) {
      // Full scan fallback if timestamp filter unsupported
      try {
        pages = await queryDatabase(database.token, database.databaseId)
      } catch (err2) {
        result.errors.push(
          `meetings/${database.name}: ${err2 instanceof Error ? err2.message : 'query failed'}`,
        )
        continue
      }
    }

    for (const page of pages) {
      const rawTitle = getPageTitle(page)
      if (!rawTitle) continue
      const title = cleanMeetingTitle(rawTitle) || rawTitle.trim()
      const dt = getDateTime(page.properties)
      // If no date, use a far-future sentinel date (9999-12-31) to mark as "needs date"
      const date = dt?.date ?? '9999-12-31'
      const time = dt?.time ?? '09:00'
      const peopleRels = getTypedRelationIds(page.properties, 'people')
      const projectRels = getTypedRelationIds(page.properties, 'projects')
      const projectId =
        projectRels.map((rid) => projectIdByNotion.get(rid)).find(Boolean) ?? null

      let id = meetingIdByNotion.get(page.id)
      if (!id) {
        // Attach to an existing calendar meeting on the same day with a similar title
        const candidates = existingMeetings.filter(
          (m) =>
            m.date === date &&
            (titlesFuzzyMatch(m.title, title) || titlesShareKnownPerson(m.title, title, knownPersonNames)),
        )
        if (candidates.length === 1) id = candidates[0]!.id
        else if (candidates.length > 1) {
          const unlinked = candidates.filter((m) => !m.notionPageId)
          const pool = unlinked.length > 0 ? unlinked : candidates
          id = pool.sort((a, b) => b.title.length - a.title.length)[0]!.id
        }
      }

      if (id) {
        if (!dryRun) {
          const existing = existingMeetings.find((m) => m.id === id)
          const attachingToCalendar = Boolean(existing && !existing.notionPageId)
          const patch: {
            notionPageId: string
            updatedAt: string
            title?: string
            projectId?: string
            date?: string
            time?: string
          } = {
            notionPageId: page.id,
            updatedAt: now,
          }
          if (projectId && (await sameWorldOrSkip(db, { projectId, meetingId: id }, 'notion meeting'))) patch.projectId = projectId
          if (attachingToCalendar) {
            // Keep calendar title/date; only scrub if the calendar title itself has ISO junk.
            if (existing && /\d{4}-\d{2}-\d{2}T/.test(existing.title)) {
              patch.title = title
            }
          } else {
            // Notion meeting update
            const notionHasNoDate = (date === '9999-12-31')
            const localHasRealDate = existing && existing.date && existing.date !== '9999-12-31'
            
            patch.title = title
            
            // Guard: do not wipe a real local date with Notion's empty sentinel
            if (!(notionHasNoDate && localHasRealDate)) {
              patch.date = date
              patch.time = time
            }
          }
          // Local edits win: split Notion-owned fields from bookkeeping and filter the former.
          const { notionPageId: patchNotionPageId, updatedAt: patchUpdatedAt, ...notionFields } = patch
          if (attachingToCalendar) {
            // First link to a calendar meeting: nothing local has diverged from Notion yet.
            await db.update(meetings).set(patch).where(eq(meetings.id, id))
            await resolveNotionPatch(db, 'meeting', id, {}, notionFields)
          } else {
            await updateFromNotion(db, meetings, 'meeting', id, notionFields, {
              notionPageId: patchNotionPageId,
              updatedAt: patchUpdatedAt,
            })
          }
          if (patch.title && existing) existing.title = patch.title
          if (patch.date && existing) existing.date = patch.date
          if (existing) existing.notionPageId = page.id
        }
      } else {
        id = newId('m_notion_')
        if (!dryRun) {
          await db.insert(meetings).values({
            id,
            title,
            date,
            time,
            projectId,
            notionPageId: page.id,
            createdAt: now,
            updatedAt: now,
          })
        }
        existingMeetings.push({
          id,
          title,
          date,
          notionPageId: page.id,
          projectId,
        })
      }
      meetingIdByNotion.set(page.id, id)
      result.meetingsUpserted++
      
      // Process Tasks relation: link Notion task pages to this meeting
      if (!dryRun && id) {
        const taskRelIds = getTypedRelationIds(page.properties, 'tasks')
        for (const taskPageId of taskRelIds) {
          const [taskRow] = await db
            .select({ id: tasks.id, meetingId: tasks.meetingId })
            .from(tasks)
            .where(eq(tasks.notionPageId, taskPageId))
          // Non-wipe rule: only set meetingId if not already set
          if (taskRow && !taskRow.meetingId) {
            await db.update(tasks).set({ meetingId: id, updatedAt: now }).where(eq(tasks.id, taskRow.id))
          }
        }
      }
      
      meetingPagesForNotes.push({
        pageId: page.id,
        url: page.url ?? null,
        lastEdited: page.last_edited_time ?? null,
        title,
        date,
        meetingId: id,
        token: database.token,
        accountLabel: database.accountLabel,
        dbName: database.name,
      })

      if (!dryRun && id) {
        // Merge Notion people onto the meeting (do not wipe calendar attendees).
        const existingLinks = await db
          .select({ personId: meetingPeople.personId })
          .from(meetingPeople)
          .where(eq(meetingPeople.meetingId, id))
        const have = new Set(existingLinks.map((l) => l.personId))
        for (const rid of peopleRels) {
          const personId = await findPersonIdByNotionPageId(db, rid)
          if (!personId || have.has(personId)) continue
          await db.insert(meetingPeople).values({ meetingId: id, personId })
          have.add(personId)
          result.linksRewritten++
        }
        if (projectId && (await sameWorldOrSkip(db, { projectId, meetingId: id }, 'notion meeting relation'))) {
          await updateFromNotion(db, meetings, 'meeting', id, { projectId }, { updatedAt: now })
        }
      }
    }
  }

  // Apply project → meetings relations (Projects DB "Meetings" property)
  if (!dryRun) {
    for (const [projectId, notionMeetingIds] of projectMeetingRels) {
      for (const mid of notionMeetingIds) {
        const localMeetingId = meetingIdByNotion.get(mid)
        if (!localMeetingId) continue
        if (!(await sameWorldOrSkip(db, { projectId, meetingId: localMeetingId }, 'notion project→meetings'))) continue
        await updateFromNotion(db, meetings, 'meeting', localMeetingId, { projectId }, { notionPageId: mid, updatedAt: now })
        result.linksRewritten++
      }
    }
  }

  // ── In-page AI Meeting Notes (blocks on the Meetings DB page) ──
  const noteIdByPage = new Map<string, string>()
  const existingNoteMeta = new Map<string, ExistingNoteMeta>()
  const existingNotes = await db
    .select({
      id: meetingNotes.id,
      notionPageId: meetingNotes.notionPageId,
      bodyText: meetingNotes.bodyText,
      bodySyncedAt: meetingNotes.bodySyncedAt,
      notionLastEditedAt: meetingNotes.notionLastEditedAt,
      sourceKind: meetingNotes.sourceKind,
    })
    .from(meetingNotes)
    .where(eq(meetingNotes.source, 'notion'))
  for (const n of existingNotes) {
    if (n.notionPageId) {
      noteIdByPage.set(n.notionPageId, n.id)
      existingNoteMeta.set(n.notionPageId, {
        id: n.id,
        bodyText: n.bodyText,
        bodySyncedAt: n.bodySyncedAt,
        notionLastEditedAt: n.notionLastEditedAt,
        sourceKind: n.sourceKind,
      })
    }
  }

  for (const page of meetingPagesForNotes) {
    const upserted = await upsertInPageMeetingNote(
      db,
      {
        pageId: page.pageId,
        url: page.url,
        lastEdited: page.lastEdited,
        title: page.title,
        date: page.date,
        meetingId: page.meetingId,
        token: page.token,
        accountLabel: page.accountLabel,
        dbName: page.dbName,
        now,
        dryRun,
      },
      existingNoteMeta.get(page.pageId),
    )
    if (upserted.notesUpserted) result.notesUpserted++
    if (upserted.error) result.errors.push(upserted.error)
    if (upserted.id) {
      noteIdByPage.set(page.pageId, upserted.id)
      existingNoteMeta.set(page.pageId, {
        id: upserted.id,
        bodyText: upserted.bodyText,
        bodySyncedAt: upserted.bodySyncedAt,
        notionLastEditedAt: page.lastEdited,
      })
    }
  }

  if (scope === 'meetings') return result

  // Apply project → tasks relations
  if (!dryRun) {
    for (const [projectId, notionTaskIds] of projectTaskRels) {
      for (const tid of notionTaskIds) {
        const [taskRow] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.notionPageId, tid)).limit(1)
        if (taskRow && (await sameWorldOrSkip(db, { projectId, taskId: taskRow.id }, 'notion project→tasks'))) {
          await updateFromNotion(db, tasks, 'task', taskRow.id, { projectId }, { updatedAt: now })
        }
        result.tasksLinked++
        result.linksRewritten++
      }
    }
  }

  // Rebuild project_people = direct People relations ∪ people on linked meetings
  if (!dryRun) {
    const localProjectIds = [...new Set(projectIdByNotion.values())]
    for (const projectId of localProjectIds) {
      const personIds = new Set<string>()
      for (const rid of projectDirectPeople.get(projectId) ?? []) {
        const personId = await findPersonIdByNotionPageId(db, rid)
        if (personId) personIds.add(personId)
      }
      const linkedMeetings = await db
        .select({ id: meetings.id })
        .from(meetings)
        .where(eq(meetings.projectId, projectId))
      if (linkedMeetings.length > 0) {
        const links = await db
          .select({ personId: meetingPeople.personId })
          .from(meetingPeople)
          .where(
            inArray(
              meetingPeople.meetingId,
              linkedMeetings.map((m) => m.id),
            ),
          )
        for (const l of links) personIds.add(l.personId)
      }
      await db.delete(projectPeople).where(eq(projectPeople.projectId, projectId))
      for (const personId of personIds) {
        await db.insert(projectPeople).values({ projectId, personId })
        result.linksRewritten++
      }
    }
  }

  // ── Meeting notes database (optional; in-page notes already synced above) ──
  const localMeetings = await db
    .select({ id: meetings.id, title: meetings.title, date: meetings.date })
    .from(meetings)
  const meetingPageIds = new Set(meetingPagesForNotes.map((p) => p.pageId))

  const fetchedNotePages = new Set<string>()
  const keptNotePages = new Set<string>()
  const filter = recentActivityFilter(windowDays)

  for (const database of resolveDatabases('meeting_notes')) {
    let pages: NotionPageRow[]
    try {
      pages = await queryDatabase(database.token, database.databaseId, filter)
    } catch (err) {
      result.errors.push(`meeting_notes/${database.name}: ${err instanceof Error ? err.message : 'query failed'}`)
      continue
    }

    for (const page of pages) {
      fetchedNotePages.add(page.id)
      if (meetingPageIds.has(page.id)) continue
      const title = getPageTitle(page)
      if (!title) continue
      keptNotePages.add(page.id)

      const date = getDate(page.properties)
      const propSnippet = getSnippet(page.properties)
      const pageLastEdited = page.last_edited_time ?? null
      const prev = existingNoteMeta.get(page.id)
      const peopleRels = getTypedRelationIds(page.properties, 'people')
      const projectRels = getTypedRelationIds(page.properties, 'projects')
      // Also accept any relation that resolves to a known project page id
      const allRels = getRelationIds(page.properties)
      for (const rid of allRels) {
        if (projectIdByNotion.has(rid) && !projectRels.includes(rid)) projectRels.push(rid)
      }

      let meetingId: string | null = null
      if (date) {
        const candidates = localMeetings.filter((m) => m.date === date && titlesFuzzyMatch(m.title, title))
        if (candidates.length === 1) meetingId = candidates[0]!.id
        else if (candidates.length > 1) {
          meetingId = candidates.sort((a, b) => b.title.length - a.title.length)[0]!.id
        }
      }

      let bodyText: string | null = prev?.bodyText ?? null
      let bodySyncedAt: string | null = prev?.bodySyncedAt ?? null
      let notionLastEditedAt: string | null = pageLastEdited ?? prev?.notionLastEditedAt ?? null

      if (
        !dryRun &&
        shouldFetchNoteBody({
          bodyText: prev?.bodyText,
          bodySyncedAt: prev?.bodySyncedAt,
          notionLastEditedAt: prev?.notionLastEditedAt,
          pageLastEdited,
        })
      ) {
        try {
          bodyText = await fetchMeetingNoteBodyText(database.token, page.id)
          bodySyncedAt = now
          notionLastEditedAt = pageLastEdited ?? now
        } catch (err) {
          result.errors.push(
            `meeting_notes/body/${page.id}: ${err instanceof Error ? err.message : 'block fetch failed'}`,
          )
        }
      }

      const snippet =
        (bodyText?.trim() ? bodyText.trim().slice(0, 500) : null) || propSnippet

      let id = noteIdByPage.get(page.id)
      if (id) {
        if (!dryRun) {
          await db
            .update(meetingNotes)
            .set({
              title,
              date,
              snippet,
              bodyText,
              bodySyncedAt,
              notionLastEditedAt,
              notionUrl: page.url ?? null,
              notionPageId: page.id,
              meetingId,
              notionAccount: database.accountLabel,
              notionDb: database.name,
              sourceKind: 'notes_db',
              updatedAt: now,
            })
            .where(eq(meetingNotes.id, id))

          // Auto-create meeting for orphaned notes (in case meetingId is now null)
          if (!meetingId) {
            const { ensureMeetingForNote } = await import('./notion-meeting-sync')
            const result = await ensureMeetingForNote(id, title, date)
            meetingId = result.meetingId
          }

          // Trigger analysis if we have a transcript
          if (meetingId && bodyText && bodyText.length >= 100) {
            const { triggerAnalysisIfNeeded } = await import('./notion-meeting-sync')
            void triggerAnalysisIfNeeded(meetingId, id, bodyText)
          }
        }
      } else {
        id = newId('mn_')
        if (!dryRun) {
          await db.insert(meetingNotes).values({
            id,
            title,
            date,
            snippet,
            bodyText,
            bodySyncedAt,
            notionLastEditedAt,
            notionUrl: page.url ?? null,
            notionPageId: page.id,
            meetingId,
            notionAccount: database.accountLabel,
            notionDb: database.name,
            source: 'notion',
            sourceKind: 'notes_db',
            createdAt: now,
            updatedAt: now,
          })

          // Auto-create meeting for orphaned notes
          if (!meetingId) {
            const { ensureMeetingForNote } = await import('./notion-meeting-sync')
            const result = await ensureMeetingForNote(id, title, date)
            meetingId = result.meetingId
          }

          // Trigger analysis if we have a transcript
          if (meetingId && bodyText && bodyText.length >= 100) {
            const { triggerAnalysisIfNeeded } = await import('./notion-meeting-sync')
            void triggerAnalysisIfNeeded(meetingId, id, bodyText)
          }
        }
        noteIdByPage.set(page.id, id)
      }
      result.notesUpserted++

      if (!dryRun && id) {
        await db.delete(meetingNotePeople).where(eq(meetingNotePeople.meetingNoteId, id))
        await db.delete(meetingNoteProjects).where(eq(meetingNoteProjects.meetingNoteId, id))
        for (const rid of peopleRels) {
          const personId = await findPersonIdByNotionPageId(db, rid)
          if (!personId) continue
          await db.insert(meetingNotePeople).values({ meetingNoteId: id, personId })
          result.linksRewritten++
        }
        for (const rid of projectRels) {
          const projectId = projectIdByNotion.get(rid)
          if (!projectId) continue
          const noteWorld = await notionDbWorld(db, database.name, database.accountLabel)
          if (!(await sameWorldOrSkip(db, { projectId, workspaceId: noteWorld }, 'notion note→project'))) continue
          await db.insert(meetingNoteProjects).values({ meetingNoteId: id, projectId })
          result.linksRewritten++
        }
      }
    }
  }

  // Prune notion notes fetched in-window but no longer kept
  const toPrune: string[] = []
  for (const [pageId, noteId] of noteIdByPage) {
    if (fetchedNotePages.has(pageId) && !keptNotePages.has(pageId)) toPrune.push(noteId)
  }
  if (toPrune.length > 0 && !dryRun) {
    await db.delete(meetingNotePeople).where(inArray(meetingNotePeople.meetingNoteId, toPrune))
    await db.delete(meetingNoteProjects).where(inArray(meetingNoteProjects.meetingNoteId, toPrune))
    await db
      .delete(meetingNotes)
      .where(and(eq(meetingNotes.source, 'notion'), inArray(meetingNotes.id, toPrune)))
  }
  result.notesPruned = toPrune.length

  return result
}

/** When task sync cannot run (no task DBs), still upsert people identities. */
async function syncPeopleIdentitiesOnly(
  db: Db,
  dryRun: boolean,
  result: NotionGraphSyncResult,
): Promise<void> {
  const now = new Date().toISOString()
  for (const database of resolveDatabases('people')) {
    let pages: Array<{ id: string; properties: Record<string, NotionProp> }>
    try {
      pages = await queryDatabase(database.token, database.databaseId)
    } catch (err) {
      result.errors.push(`people/${database.name}: ${err instanceof Error ? err.message : 'query failed'}`)
      continue
    }
    const accountKey = `${database.accountLabel}::${database.name}`
    for (const page of pages) {
      const name = getTitle(page.properties)
      if (!name) continue
      let personId = await findPersonIdByNotionPageId(db, page.id)
      if (!personId) {
        const byName = await db
          .select({ id: people.id, email: people.email, status: people.status })
          .from(people)
          .where(eq(people.name, name))
          .limit(1)
        personId = byName[0]?.id ?? null
      }
      if (!personId) {
        personId = newId('p_notion_')
        if (!dryRun) {
          await db.insert(people).values({
            id: personId,
            name,
            role: null,
            color: '#e8c547',
            status: 'confirmed',
            source: 'notion',
            notionPageId: page.id,
            createdAt: now,
          })
        }
      }
      if (!dryRun && personId) {
        await upsertPersonExternalId(db, {
          personId,
          provider: 'notion',
          accountKey,
          externalId: page.id,
          displayName: name,
        })
        const [row] = await db
          .select({ notionPageId: people.notionPageId })
          .from(people)
          .where(eq(people.id, personId))
        if (row && !row.notionPageId) {
          await db.update(people).set({ notionPageId: page.id }).where(eq(people.id, personId))
        }
      }
      result.peopleIdentitiesUpserted++
    }
  }
}
