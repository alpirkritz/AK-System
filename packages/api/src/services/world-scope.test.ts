import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  harnessInsights,
  meetingNotes,
  meetingPeople,
  meetingSeries,
  meetings,
  people,
  personWorkspaces,
  projects,
  tasks,
  userSettings,
  workspaceCalendars,
  workspaceNotionDatabases,
  workspaces,
} from '@ak-system/database'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'
import { localTodayIso } from '../lib/calendar-dates'
import { runDetectors } from './harness-reasoner'
import {
  clearWorldCache,
  dominant,
  listWorldConflicts,
  pickMeetingWorld,
  resolveAllWorlds,
  resolveMeetingWorlds,
  resolveProjectWorlds,
  sameWorldOrSkip,
} from './world-scope'

const NOW = new Date().toISOString()

beforeEach(async () => {
  await resetDb()
  const db = getTestDb()
  for (const t of [workspaceCalendars, workspaceNotionDatabases, personWorkspaces, userSettings, harnessInsights]) await db.delete(t)
  await db.delete(workspaces)
  // Five worlds, one with a child workspace — nothing in the code knows these names.
  await db.insert(workspaces).values([
    { id: 'w_dt', name: 'Dragontail', createdAt: NOW, updatedAt: NOW },
    { id: 'w_daz', name: 'DAZ', createdAt: NOW, updatedAt: NOW },
    { id: 'w_con', name: 'Alpir Consulting', createdAt: NOW, updatedAt: NOW },
    { id: 'w_new', name: 'Fifth World', createdAt: NOW, updatedAt: NOW },
    { id: 'w_dt_child', name: 'DT R&D', parentId: 'w_dt', createdAt: NOW, updatedAt: NOW },
  ])
  clearWorldCache(db)
})

async function meeting(id: string, extra: Record<string, unknown> = {}) {
  await getTestDb().insert(meetings).values({ id, title: id, date: '2026-11-10', createdAt: NOW, updatedAt: NOW, ...extra })
}
const worldOfMeeting = async (id: string) => (await getTestDb().select().from(meetings).where(eq(meetings.id, id)))[0]

describe('pure rules', () => {
  it('picks the first known signal in precedence order', () => {
    const base = { manual: null, series: null, notion: null, calendar: null, attendees: null, project: null }
    expect(pickMeetingWorld({ ...base, calendar: 'a', attendees: 'b' })).toEqual({ world: 'a', source: 'calendar' })
    expect(pickMeetingWorld({ ...base, series: 's', notion: 'n' })).toEqual({ world: 's', source: 'series' })
    expect(pickMeetingWorld(base)).toBeNull()
  })
  it('dominant needs 80% of at least 3', () => {
    expect(dominant(['a', 'a', 'a', 'a', 'b'])).toBe('a')
    expect(dominant(['a', 'a', 'b'])).toBeNull()
    expect(dominant(['a', 'a', null])).toBeNull()
  })
})

describe('meeting resolution', () => {
  it('uses series, notion DB, calendar and attendees, and never overwrites manual', async () => {
    const db = getTestDb()
    await db.insert(meetingSeries).values({ id: 's1', title: 'weekly', workspaceId: 'w_dt_child', createdAt: NOW, updatedAt: NOW })
    await meeting('m_series', { seriesId: 's1', calendarId: 'cal_daz' })
    await meeting('m_notion')
    await db.insert(meetingNotes).values({ id: 'n1', title: 'x', meetingId: 'm_notion', notionDb: 'DAZ Internal Meetings', notionAccount: 'DAZ', createdAt: NOW, updatedAt: NOW })
    await db.insert(workspaceNotionDatabases).values({ id: 'wnd1', workspaceId: 'w_daz', notionDatabaseId: 'db1', notionDatabaseName: 'DAZ Internal Meetings', createdAt: NOW })
    await meeting('m_cal', { calendarId: 'cal_daz' })
    await db.insert(workspaceCalendars).values({ id: 'c1', workspaceId: 'w_daz', calendarId: 'cal_daz', createdAt: NOW })
    await db.insert(people).values([
      { id: 'p_self', name: 'Alpir Kritzler', createdAt: NOW },
      { id: 'p_a', name: 'Avi', createdAt: NOW },
      { id: 'p_b', name: 'Bat', createdAt: NOW },
    ])
    await db.insert(personWorkspaces).values([
      { id: 'pw1', personId: 'p_a', workspaceId: 'w_new', relationshipType: 'colleague', createdAt: NOW, updatedAt: NOW },
      { id: 'pw2', personId: 'p_b', workspaceId: 'w_new', relationshipType: 'colleague', createdAt: NOW, updatedAt: NOW },
      { id: 'pw3', personId: 'p_self', workspaceId: 'w_dt', relationshipType: 'colleague', createdAt: NOW, updatedAt: NOW },
    ])
    await meeting('m_people')
    await db.insert(meetingPeople).values([
      { meetingId: 'm_people', personId: 'p_a' },
      { meetingId: 'm_people', personId: 'p_b' },
      { meetingId: 'm_people', personId: 'p_self' },
    ])
    await meeting('m_manual', { workspaceId: 'w_con', workspaceSource: 'manual', calendarId: 'cal_daz' })

    await resolveMeetingWorlds(db)
    expect(await worldOfMeeting('m_series')).toMatchObject({ workspaceId: 'w_dt', workspaceSource: 'series' })
    expect(await worldOfMeeting('m_notion')).toMatchObject({ workspaceId: 'w_daz', workspaceSource: 'notion' })
    expect(await worldOfMeeting('m_cal')).toMatchObject({ workspaceId: 'w_daz', workspaceSource: 'calendar' })
    expect(await worldOfMeeting('m_people')).toMatchObject({ workspaceId: 'w_new', workspaceSource: 'attendees' })
    expect(await worldOfMeeting('m_manual')).toMatchObject({ workspaceId: 'w_con', workspaceSource: 'manual' })
  })

  it('attendees from two worlds give no world', async () => {
    const db = getTestDb()
    await db.insert(people).values([{ id: 'p_a', name: 'Avi', createdAt: NOW }, { id: 'p_b', name: 'Bat', createdAt: NOW }])
    await db.insert(personWorkspaces).values([
      { id: 'pw1', personId: 'p_a', workspaceId: 'w_dt', relationshipType: 'colleague', createdAt: NOW, updatedAt: NOW },
      { id: 'pw2', personId: 'p_b', workspaceId: 'w_daz', relationshipType: 'colleague', createdAt: NOW, updatedAt: NOW },
    ])
    await meeting('m_mixed')
    await db.insert(meetingPeople).values([{ meetingId: 'm_mixed', personId: 'p_a' }, { meetingId: 'm_mixed', personId: 'p_b' }])
    await resolveMeetingWorlds(db)
    expect((await worldOfMeeting('m_mixed')).workspaceId).toBeNull()
  })
})

describe('project resolution', () => {
  it('infers from tasks (80% of ≥3), then lets unknown meetings inherit it, without looping', async () => {
    const db = getTestDb()
    await db.insert(projects).values({ id: 'pr', name: 'Algo 4', createdAt: NOW, updatedAt: NOW })
    await db.insert(tasks).values(
      ['w_dt', 'w_dt', 'w_dt_child', 'w_dt'].map((ws, i) => ({ id: `t${i}`, title: `t${i}`, projectId: 'pr', workspaceId: ws, createdAt: NOW, updatedAt: NOW })),
    )
    await meeting('m_open', { projectId: 'pr' })
    const res = await resolveAllWorlds(db)
    expect(res.projects).toBe(1)
    const [p] = await db.select().from(projects)
    expect(p).toMatchObject({ workspaceId: 'w_dt', workspaceSource: 'tasks' })
    expect(await worldOfMeeting('m_open')).toMatchObject({ workspaceId: 'w_dt', workspaceSource: 'project' })
    // Project worlds inferred from meetings ignore meetings that got their world from the project.
    await db.update(projects).set({ workspaceId: null, workspaceSource: null })
    await db.delete(tasks)
    await resolveProjectWorlds(db)
    expect((await db.select().from(projects))[0].workspaceId).toBeNull()
  })

  it('a world set before this feature is kept as manual', async () => {
    const db = getTestDb()
    await db.insert(projects).values({ id: 'pr', name: 'Legacy', workspaceId: 'w_con', createdAt: NOW, updatedAt: NOW })
    await resolveProjectWorlds(db)
    expect((await db.select().from(projects))[0].workspaceSource).toBe('manual')
  })
})

describe('enforcement', () => {
  beforeEach(async () => {
    const db = getTestDb()
    await db.insert(projects).values({ id: 'pr_dt', name: 'Algo 4', workspaceId: 'w_dt', workspaceSource: 'manual', createdAt: NOW, updatedAt: NOW })
    await meeting('m_daz', { workspaceId: 'w_daz', workspaceSource: 'manual' })
    await meeting('m_unknown')
  })

  it('refuses a manual cross-world link and allows an unknown side', async () => {
    const caller = await createTestCaller()
    const base = { title: 'x', date: '2026-11-10', peopleIds: [] as string[] }
    await expect(caller.meetings.update({ id: 'm_daz', ...base, projectId: 'pr_dt' })).rejects.toThrow(/Dragontail.*DAZ/)
    await expect(caller.meetings.update({ id: 'm_unknown', ...base, projectId: 'pr_dt' })).resolves.toBeTruthy()
    await expect(caller.tasks.create({ title: 't', projectId: 'pr_dt', workspaceId: 'w_daz' })).rejects.toThrow(/אי אפשר לקשר/)
    await expect(caller.meetings.setWorkspace({ meetingId: 'm_unknown', workspaceId: 'w_daz' })).rejects.toThrow()
    await expect(caller.meetings.setWorkspace({ meetingId: 'm_unknown', workspaceId: 'w_dt_child' })).resolves.toBeTruthy()
  })

  it('automatic linkers skip a cross-world link', async () => {
    expect(await sameWorldOrSkip(getTestDb(), { projectId: 'pr_dt', meetingId: 'm_daz' }, 'test')).toBe(false)
    expect(await sameWorldOrSkip(getTestDb(), { projectId: 'pr_dt', meetingId: 'm_unknown' }, 'test')).toBe(true)
  })

  it('lists, flags and resolves existing conflicts', async () => {
    const db = getTestDb()
    await db.update(meetings).set({ projectId: 'pr_dt' }).where(eq(meetings.id, 'm_daz'))
    const conflicts = await listWorldConflicts(db)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ itemWorldName: 'DAZ', projectWorldName: 'Dragontail' })
    const drafts = (await runDetectors(db)).filter((d) => d.kind === 'project_world_conflict')
    expect(drafts).toHaveLength(1)

    const caller = await createTestCaller()
    await caller.worlds.resolveConflict({ kind: 'meeting', id: 'm_daz', action: 'move' })
    expect(await worldOfMeeting('m_daz')).toMatchObject({ workspaceId: 'w_dt', workspaceSource: 'manual' })
    expect(await listWorldConflicts(db)).toHaveLength(0)
  })

  it('projects.list({ worldId }) returns that world plus unassigned, never another world', async () => {
    const db = getTestDb()
    await db.insert(projects).values([
      { id: 'pr_daz', name: 'DAZ site', workspaceId: 'w_daz', workspaceSource: 'manual', createdAt: NOW, updatedAt: NOW },
      { id: 'pr_none', name: 'Loose', createdAt: NOW, updatedAt: NOW },
    ])
    const caller = await createTestCaller()
    const rows = await caller.projects.list({ worldId: 'w_dt' })
    expect(rows.map((r) => r.id).sort()).toEqual(['pr_dt', 'pr_none'])
    expect(rows.find((r) => r.id === 'pr_dt')?.worldName).toBe('Dragontail')
  })

  it('single-meeting prep drops notes from another world', async () => {
    const db = getTestDb()
    const today = localTodayIso()
    await meeting('m_focus', { title: 'Algo 4 review', date: today, workspaceId: 'w_dt', workspaceSource: 'manual' })
    await meeting('m_other', { title: 'Algo 4 marketing', date: '2026-11-01', workspaceId: 'w_daz', workspaceSource: 'manual' })
    await meeting('m_same', { title: 'Algo 4 planning', date: '2026-11-02', workspaceId: 'w_dt', workspaceSource: 'manual' })
    await db.insert(meetingNotes).values([
      { id: 'n_other', title: 'Algo 4 marketing', date: '2026-11-01', meetingId: 'm_other', source: 'notion', createdAt: NOW, updatedAt: NOW },
      { id: 'n_same', title: 'Algo 4 planning', date: '2026-11-02', meetingId: 'm_same', source: 'notion', createdAt: NOW, updatedAt: NOW },
    ])
    const caller = await createTestCaller()
    const res = await caller.insights.meetingNotes({ focusTitle: 'Algo 4 review' })
    const ids = (Array.isArray(res) ? res : (res as { notes: Array<{ id: string }> }).notes).map((n: { id: string }) => n.id)
    expect(ids).toContain('n_same')
    expect(ids).not.toContain('n_other')
  })
})

describe('Hugo sees projects by world', () => {
  it('lists each world with its projects and the unassigned ones, plus the one-world rule', async () => {
    const { buildOwnerProfileBlock } = await import('./owner-profile')
    const db = getTestDb()
    await db.insert(projects).values([
      { id: 'a', name: 'Algo 4', workspaceId: 'w_dt_child', workspaceSource: 'manual', createdAt: NOW, updatedAt: NOW },
      { id: 'b', name: 'DAZ site', workspaceId: 'w_daz', workspaceSource: 'manual', createdAt: NOW, updatedAt: NOW },
      { id: 'c', name: 'Loose', createdAt: NOW, updatedAt: NOW },
    ])
    const block = await buildOwnerProfileBlock(db)
    expect(block).toMatch(/- Dragontail[^\n]*\n {2}פרויקטים: Algo 4/)
    expect(block).toMatch(/- DAZ[^\n]*\n {2}פרויקטים: DAZ site/)
    expect(block).toContain('- ללא עולם: Loose')
    expect(block).toContain('A project belongs to exactly one world')
  })
})

describe('ARO first, Notion as a feed', () => {
  it('Notion fills a world only when ARO has no signal, and a disagreement is listed and settled', async () => {
    const db = getTestDb()
    const { listNotionWorldDisagreements, settleNotionDisagreement } = await import('./world-scope')
    await db.insert(workspaceNotionDatabases).values({ id: 'wnd', workspaceId: 'w_daz', notionDatabaseId: 'db', notionDatabaseName: 'Mixed Meetings', createdAt: NOW })
    await db.insert(workspaceCalendars).values({ id: 'c', workspaceId: 'w_dt', calendarId: 'cal_dt', createdAt: NOW })
    await meeting('m_both', { calendarId: 'cal_dt' })
    await meeting('m_notion_only')
    await db.insert(meetingNotes).values([
      { id: 'n_both', title: 'x', meetingId: 'm_both', notionDb: 'Mixed Meetings', createdAt: NOW, updatedAt: NOW },
      { id: 'n_only', title: 'y', meetingId: 'm_notion_only', notionDb: 'Mixed Meetings', createdAt: NOW, updatedAt: NOW },
    ])
    await resolveMeetingWorlds(db)
    expect(await worldOfMeeting('m_both')).toMatchObject({ workspaceId: 'w_dt', workspaceSource: 'calendar' })
    expect(await worldOfMeeting('m_notion_only')).toMatchObject({ workspaceId: 'w_daz', workspaceSource: 'notion' })

    const list = await listNotionWorldDisagreements(db)
    expect(list).toEqual([expect.objectContaining({ meetingId: 'm_both', aroWorldName: 'Dragontail', notionWorldName: 'DAZ' })])

    await settleNotionDisagreement(db, 'm_both', 'aro')
    expect(await worldOfMeeting('m_both')).toMatchObject({ workspaceId: 'w_dt', workspaceSource: 'manual' })
    expect(await listNotionWorldDisagreements(db)).toHaveLength(0)
  })
})
