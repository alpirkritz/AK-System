import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { harnessNodes, people, personWorkspaces } from '@ak-system/database'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'
import { describeAffiliations, indexHarnessWorld } from '../services/harness-context'
import {
  applyProfileProposals,
  matchGoogleProfiles,
  type GoogleProfileContact,
  type ProfilePersonRow,
} from '../services/google-profile-fill'

const NOW = new Date().toISOString()

async function seedPeople() {
  const db = getTestDb()
  await db.insert(people).values([
    { id: 'p_dana', name: 'דנה', status: 'confirmed', source: 'manual', createdAt: NOW },
    { id: 'p_yossi', name: 'יוסי', status: 'confirmed', source: 'manual', createdAt: NOW },
    { id: 'p_rina', name: 'רינה', status: 'confirmed', source: 'manual', createdAt: NOW },
  ])
}

describe('people domain hierarchy — affiliations', () => {
  beforeEach(async () => {
    await resetDb()
    await seedPeople()
  })

  it('links a person to several workspaces at once', async () => {
    const caller = await createTestCaller()
    await caller.people.linkToWorkspace({ personId: 'p_dana', workspaceId: 'ws_dragontail', relationshipType: 'colleague' })
    await caller.people.linkToWorkspace({ personId: 'p_dana', workspaceId: 'ws_daz', relationshipType: 'advisor' })
    await caller.people.linkToWorkspace({ personId: 'p_dana', workspaceId: 'ws_personal', relationshipType: 'חברה מהצבא' })

    const affiliations = await caller.people.affiliations({ personId: 'p_dana' })
    expect(affiliations).toHaveLength(3)
    expect(affiliations.map((a) => a.relationshipType)).toEqual(
      expect.arrayContaining(['colleague', 'advisor', 'חברה מהצבא']),
    )
    const dt = affiliations.find((a) => a.workspaceId === 'ws_dragontail')!
    expect(dt.workspaceName).toBe('Dragontail')
    expect(dt.workspaceKind).toBe('employer')
  })

  it('upserts instead of duplicating the same person/workspace pair', async () => {
    const caller = await createTestCaller()
    await caller.people.linkToWorkspace({ personId: 'p_dana', workspaceId: 'ws_daz', relationshipType: 'advisor' })
    await caller.people.linkToWorkspace({
      personId: 'p_dana', workspaceId: 'ws_daz', relationshipType: 'co_founder', notes: 'הצטרפה כשותפה',
    })
    const affiliations = await caller.people.affiliations({ personId: 'p_dana' })
    expect(affiliations).toHaveLength(1)
    expect(affiliations[0].relationshipType).toBe('co_founder')
    expect(affiliations[0].notes).toBe('הצטרפה כשותפה')
  })

  it('records reports-to and resolves the manager name', async () => {
    const caller = await createTestCaller()
    await caller.people.linkToWorkspace({ personId: 'p_yossi', workspaceId: 'ws_dragontail', relationshipType: 'manager' })
    await caller.people.linkToWorkspace({
      personId: 'p_dana', workspaceId: 'ws_dragontail', relationshipType: 'colleague', reportsToPersonId: 'p_yossi',
    })
    const [aff] = await caller.people.affiliations({ personId: 'p_dana' })
    expect(aff.reportsToPersonId).toBe('p_yossi')
    expect(aff.reportsToName).toBe('יוסי')
  })

  it('rejects self-reporting, empty relationship and unknown workspace', async () => {
    const caller = await createTestCaller()
    await expect(
      caller.people.linkToWorkspace({ personId: 'p_dana', workspaceId: 'ws_daz', relationshipType: 'x', reportsToPersonId: 'p_dana' }),
    ).rejects.toThrow()
    await expect(
      caller.people.linkToWorkspace({ personId: 'p_dana', workspaceId: 'ws_daz', relationshipType: '   ' }),
    ).rejects.toThrow()
    await expect(
      caller.people.linkToWorkspace({ personId: 'p_dana', workspaceId: 'ws_nope', relationshipType: 'friend' }),
    ).rejects.toThrow()
  })

  it('unlinks a single workspace and keeps the others', async () => {
    const caller = await createTestCaller()
    await caller.people.linkToWorkspace({ personId: 'p_dana', workspaceId: 'ws_daz', relationshipType: 'advisor' })
    await caller.people.linkToWorkspace({ personId: 'p_dana', workspaceId: 'ws_personal', relationshipType: 'friend' })
    await caller.people.unlinkFromWorkspace({ personId: 'p_dana', workspaceId: 'ws_daz' })
    const affiliations = await caller.people.affiliations({ personId: 'p_dana' })
    expect(affiliations.map((a) => a.workspaceId)).toEqual(['ws_personal'])
  })

  it('listByWorkspace returns only people in that workspace', async () => {
    const caller = await createTestCaller()
    await caller.people.linkToWorkspace({ personId: 'p_dana', workspaceId: 'ws_daz', relationshipType: 'co_founder' })
    await caller.people.linkToWorkspace({ personId: 'p_yossi', workspaceId: 'ws_dragontail', relationshipType: 'manager' })
    const members = await caller.people.listByWorkspace({ workspaceId: 'ws_daz' })
    expect(members.map((m) => m.person.id)).toEqual(['p_dana'])
    expect(members[0].relationshipType).toBe('co_founder')
  })

  it('listPaginated filters by workspace and returns affiliations per row', async () => {
    const caller = await createTestCaller()
    await caller.people.linkToWorkspace({ personId: 'p_dana', workspaceId: 'ws_daz', relationshipType: 'co_founder' })
    await caller.people.linkToWorkspace({ personId: 'p_dana', workspaceId: 'ws_dragontail', relationshipType: 'colleague' })
    await caller.people.linkToWorkspace({ personId: 'p_yossi', workspaceId: 'ws_dragontail', relationshipType: 'manager' })

    const daz = await caller.people.listPaginated({ workspaceId: 'ws_daz' })
    expect(daz.total).toBe(2)
    expect(daz.items.map((p) => p.id)).toEqual(expect.arrayContaining(['p_dana', 'p_rina']))
    expect(daz.items[0].id).toBe('p_dana')
    expect(daz.items.find((p) => p.id === 'p_dana')!.affiliations).toHaveLength(2)

    const dragontail = await caller.people.listPaginated({ workspaceId: 'ws_dragontail' })
    expect(dragontail.items.map((p) => p.id).sort()).toEqual(['p_dana', 'p_rina', 'p_yossi'])

    const consulting = await caller.people.listPaginated({ workspaceId: 'ws_alpir_consulting' })
    expect(consulting.items.map((p) => p.id)).toEqual(['p_rina'])
    expect(consulting.total).toBe(1)

    const all = await caller.people.listPaginated({})
    expect(all.total).toBe(3)
  })

  it('merge moves affiliations to the kept person, keeping its own on conflict', async () => {
    const caller = await createTestCaller()
    await caller.people.linkToWorkspace({ personId: 'p_dana', workspaceId: 'ws_daz', relationshipType: 'co_founder' })
    await caller.people.linkToWorkspace({ personId: 'p_rina', workspaceId: 'ws_daz', relationshipType: 'advisor' })
    await caller.people.linkToWorkspace({ personId: 'p_rina', workspaceId: 'ws_personal', relationshipType: 'friend' })
    await caller.people.linkToWorkspace({
      personId: 'p_yossi', workspaceId: 'ws_daz', relationshipType: 'employee', reportsToPersonId: 'p_rina',
    })

    await caller.people.merge({ fromId: 'p_rina', toId: 'p_dana' })

    const dana = await caller.people.affiliations({ personId: 'p_dana' })
    expect(dana.map((a) => [a.workspaceId, a.relationshipType]).sort()).toEqual([
      ['ws_daz', 'co_founder'],
      ['ws_personal', 'friend'],
    ])
    const [yossi] = await caller.people.affiliations({ personId: 'p_yossi' })
    expect(yossi.reportsToPersonId).toBe('p_dana')
  })

  it('delete removes the person affiliations and clears reports-to references', async () => {
    const caller = await createTestCaller()
    await caller.people.linkToWorkspace({ personId: 'p_yossi', workspaceId: 'ws_dragontail', relationshipType: 'manager' })
    await caller.people.linkToWorkspace({
      personId: 'p_dana', workspaceId: 'ws_dragontail', relationshipType: 'colleague', reportsToPersonId: 'p_yossi',
    })
    await caller.people.delete({ id: 'p_yossi' })

    const db = getTestDb()
    const remaining = await db.select().from(personWorkspaces)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].personId).toBe('p_dana')
    expect(remaining[0].reportsToPersonId).toBeNull()
  })

  it('deleting a workspace removes its affiliations', async () => {
    const caller = await createTestCaller()
    const ws = await caller.workspaces.create({ name: 'Side', kind: 'other' })
    await caller.people.linkToWorkspace({ personId: 'p_dana', workspaceId: ws.id, relationshipType: 'partner' })
    await caller.workspaces.delete({ id: ws.id })
    const db = getTestDb()
    expect(await db.select().from(personWorkspaces).where(eq(personWorkspaces.workspaceId, ws.id))).toHaveLength(0)
  })
})

describe('workspaces kind and description', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('seeds kinds for the default workspaces', async () => {
    const caller = await createTestCaller()
    const list = await caller.workspaces.list()
    const kindById = Object.fromEntries(list.map((w) => [w.id, w.kind]))
    expect(kindById).toMatchObject({
      ws_dragontail: 'employer',
      ws_daz: 'own_company',
      ws_alpir_consulting: 'own_company',
      ws_personal: 'personal',
    })
  })

  it('create and update store kind and description', async () => {
    const caller = await createTestCaller()
    const created = await caller.workspaces.create({ name: 'Board', kind: 'other', description: '  ועד בית  ' })
    expect(created.kind).toBe('other')
    expect(created.description).toBe('ועד בית')
    const updated = await caller.workspaces.update({ id: created.id, kind: 'personal', description: '' })
    expect(updated!.kind).toBe('personal')
    expect(updated!.description).toBeNull()
  })

  it('rejects an unknown kind', async () => {
    const caller = await createTestCaller()
    const created = await caller.workspaces.create({ name: 'X' })
    // @ts-expect-error — invalid enum value on purpose
    await expect(caller.workspaces.update({ id: created.id, kind: 'startup' })).rejects.toThrow()
  })
})

describe('Harness people scope', () => {
  beforeEach(async () => {
    await resetDb()
    await seedPeople()
  })

  it('describeAffiliations renders domain, kind, relationship and manager', () => {
    const line = describeAffiliations([
      {
        id: 'a1', personId: 'p_dana', workspaceId: 'ws_dragontail', workspaceName: 'Dragontail', workspaceColor: null,
        workspaceKind: 'employer', relationshipType: 'colleague', reportsToPersonId: 'p_yossi', reportsToName: 'יוסי', notes: null,
      },
      {
        id: 'a2', personId: 'p_dana', workspaceId: 'ws_personal', workspaceName: 'פרטי', workspaceColor: null,
        workspaceKind: 'personal', relationshipType: 'friend', reportsToPersonId: null, reportsToName: null, notes: null,
      },
    ])
    expect(line).toContain('Dragontail')
    expect(line).toContain('מעסיק')
    expect(line).toContain('מדווח ל: יוסי')
    expect(line).toContain('פרטי')
    expect(line).toContain('friend')
    expect(describeAffiliations([])).toBeNull()
  })

  it('person nodes carry their workspaces in summary and attrs', async () => {
    const caller = await createTestCaller()
    await caller.people.linkToWorkspace({ personId: 'p_yossi', workspaceId: 'ws_dragontail', relationshipType: 'manager' })
    await caller.people.linkToWorkspace({
      personId: 'p_dana', workspaceId: 'ws_dragontail', relationshipType: 'colleague', reportsToPersonId: 'p_yossi',
    })
    await caller.people.linkToWorkspace({ personId: 'p_dana', workspaceId: 'ws_daz', relationshipType: 'advisor' })

    const db = getTestDb()
    await indexHarnessWorld(db, { scopes: ['people'] })
    const [node] = await db.select().from(harnessNodes).where(eq(harnessNodes.entityId, 'p_dana'))
    expect(node.summary).toContain('Dragontail')
    expect(node.summary).toContain('DAZ')
    const attrs = (typeof node.attrs === 'string' ? JSON.parse(node.attrs) : node.attrs) as {
      workspaces: Array<{ name: string; relationshipType: string; reportsToName: string | null }>
    }
    expect(attrs.workspaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Dragontail', relationshipType: 'colleague', reportsToName: 'יוסי' }),
        expect.objectContaining({ name: 'DAZ', relationshipType: 'advisor' }),
      ]),
    )
  })
})

describe('Google profile fill', () => {
  const row = (over: Partial<ProfilePersonRow>): ProfilePersonRow => ({
    id: 'p1', name: 'דנה', email: null, company: null, jobTitle: null, notes: null, ...over,
  })
  const contact = (over: Partial<GoogleProfileContact>): GoogleProfileContact => ({
    resourceName: 'people/c1', displayName: 'Dana', emails: [], company: null, jobTitle: null, notes: null, ...over,
  })

  it('matches by existing link first and proposes only blank fields', () => {
    const { proposals } = matchGoogleProfiles(
      [row({ id: 'p1', company: 'Dragontail' })],
      [contact({ company: 'Other Co', jobTitle: 'VP R&D', notes: 'הכרנו בכנס' })],
      new Map([['people/c1', 'p1']]),
    )
    expect(proposals).toHaveLength(1)
    expect(proposals[0].fields).toEqual({ jobTitle: 'VP R&D', notes: 'הכרנו בכנס' })
  })

  it('matches by a unique email and ignores emails shared by two people', () => {
    const rows = [
      row({ id: 'p1', email: 'dana@x.com' }),
      row({ id: 'p2', name: 'א', email: 'shared@x.com' }),
      row({ id: 'p3', name: 'ב', email: 'shared@x.com' }),
    ]
    const { proposals, unmatched } = matchGoogleProfiles(
      rows,
      [
        contact({ resourceName: 'people/a', emails: ['dana@x.com'], jobTitle: 'CTO' }),
        contact({ resourceName: 'people/b', emails: ['shared@x.com'], jobTitle: 'CEO' }),
      ],
      new Map(),
    )
    expect(proposals.map((p) => p.personId)).toEqual(['p1'])
    expect(unmatched).toBe(1)
  })

  it('skips people whose fields are already filled', () => {
    const { proposals } = matchGoogleProfiles(
      [row({ id: 'p1', email: 'd@x.com', company: 'A', jobTitle: 'B', notes: 'C' })],
      [contact({ emails: ['d@x.com'], company: 'X', jobTitle: 'Y', notes: 'Z' })],
      new Map(),
    )
    expect(proposals).toHaveLength(0)
  })

  it('apply writes only selected people and never overwrites a field filled meanwhile', async () => {
    await resetDb()
    await seedPeople()
    const db = getTestDb()
    await db.update(people).set({ company: 'כבר מולא' }).where(eq(people.id, 'p_yossi'))

    const result = await applyProfileProposals(db, ['p_dana', 'p_yossi'], [
      { personId: 'p_dana', personName: 'דנה', googleName: 'Dana', fields: { jobTitle: 'CTO', notes: 'שותפה' } },
      { personId: 'p_yossi', personName: 'יוסי', googleName: 'Yossi', fields: { company: 'Google Co' } },
      { personId: 'p_rina', personName: 'רינה', googleName: 'Rina', fields: { company: 'לא נבחר' } },
    ])
    expect(result).toEqual({ updated: 1, fieldsFilled: 2 })

    const rows = await db.select().from(people)
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
    expect(byId.p_dana.jobTitle).toBe('CTO')
    expect(byId.p_dana.notes).toBe('שותפה')
    expect(byId.p_yossi.company).toBe('כבר מולא')
    expect(byId.p_rina.company).toBeNull()
  })
})
