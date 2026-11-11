import { beforeEach, describe, expect, it } from 'vitest'
import { createTestCaller, resetDb } from '../test-utils'

describe('world division visible', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('task list for a world includes its workspaces and unassigned tasks', async () => {
    const caller = await createTestCaller()
    const engineering = await caller.workspaces.create({ name: 'Engineering', parentId: 'ws_daz' })
    await caller.tasks.create({ title: 'בעולם', workspaceId: 'ws_daz' })
    await caller.tasks.create({ title: 'בסביבה', workspaceId: engineering.id })
    await caller.tasks.create({ title: 'אחר', workspaceId: 'ws_personal' })
    await caller.tasks.create({ title: 'בלי' })

    const daz = await caller.tasks.list({ workspaceId: 'ws_daz' })
    expect(daz.map((t) => t.title).sort()).toEqual(['בלי', 'בסביבה', 'בעולם'])

    const onlyEngineering = await caller.tasks.list({ workspaceId: engineering.id })
    expect(onlyEngineering.map((t) => t.title).sort()).toEqual(['בלי', 'בסביבה'])
  })

  it('meeting setWorkspace marks manual and list keeps unassigned', async () => {
    const caller = await createTestCaller()
    const meeting = await caller.meetings.create({ title: 'סיכום', date: '2026-10-21' })
    const other = await caller.meetings.create({ title: 'בלי עולם', date: '2026-10-22' })

    const saved = await caller.meetings.setWorkspace({ meetingId: meeting.id, workspaceId: 'ws_daz' })
    expect(saved.workspaceId).toBe('ws_daz')
    expect(saved.workspaceSource).toBe('manual')

    const cleared = await caller.meetings.setWorkspace({ meetingId: meeting.id, workspaceId: null })
    expect(cleared.workspaceId).toBeNull()
    expect(cleared.workspaceSource).toBeNull()

    await caller.meetings.setWorkspace({ meetingId: meeting.id, workspaceId: 'ws_daz' })
    const filtered = await caller.meetings.list({ workspaceId: 'ws_daz' })
    expect(filtered.map((m) => m.id).sort()).toEqual([meeting.id, other.id].sort())

    await expect(
      caller.meetings.setWorkspace({ meetingId: 'missing', workspaceId: 'ws_daz' }),
    ).rejects.toThrow(/פגישה/)
    await expect(
      caller.meetings.setWorkspace({ meetingId: meeting.id, workspaceId: 'ws_missing' }),
    ).rejects.toThrow(/עולם/)
  })

  it('project create and list follow the same world rule', async () => {
    const caller = await createTestCaller()
    const engineering = await caller.workspaces.create({ name: 'Engineering', parentId: 'ws_daz' })
    const inWorld = await caller.projects.create({ name: 'מוצר', workspaceId: 'ws_daz' })
    const inChild = await caller.projects.create({ name: 'בורד', workspaceId: engineering.id })
    await caller.projects.create({ name: 'אחר', workspaceId: 'ws_personal' })
    await caller.projects.create({ name: 'בלי' })

    const listed = await caller.projects.list({ workspaceId: 'ws_daz' })
    expect(listed.map((p) => p.name).sort()).toEqual(['בורד', 'בלי', 'מוצר'])

    const got = await caller.projects.getById({ id: inWorld.id })
    expect(got?.workspaceId).toBe('ws_daz')

    const moved = await caller.projects.update({ id: inChild.id, name: 'בורד', workspaceId: null })
    expect(moved?.workspaceId).toBeNull()

    await expect(caller.projects.create({ name: 'לא', workspaceId: 'ws_missing' })).rejects.toThrow(/עולם/)
  })

  it('people in a child workspace show up when the world is selected, with unaffiliated people', async () => {
    const caller = await createTestCaller()
    const engineering = await caller.workspaces.create({ name: 'Engineering', parentId: 'ws_daz' })
    const db = await import('../test-utils').then((m) => m.getTestDb())
    const { people } = await import('@ak-system/database')
    const now = new Date().toISOString()
    await db.insert(people).values([
      { id: 'p_eng', name: 'מהנדס', status: 'confirmed', source: 'manual', createdAt: now },
      { id: 'p_none', name: 'בלי', status: 'confirmed', source: 'manual', createdAt: now },
      { id: 'p_other', name: 'אחר', status: 'confirmed', source: 'manual', createdAt: now },
    ])
    await caller.people.linkToWorkspace({ personId: 'p_eng', workspaceId: engineering.id, relationshipType: 'colleague' })
    await caller.people.linkToWorkspace({ personId: 'p_other', workspaceId: 'ws_personal', relationshipType: 'friend' })

    const daz = await caller.people.listPaginated({ workspaceId: 'ws_daz' })
    expect(daz.items.map((p) => p.id).sort()).toEqual(['p_eng', 'p_none'])
    expect(daz.items[0].id).toBe('p_eng')
  })
})
