import { describe, expect, it, beforeEach } from 'vitest'
import { getDb, people, personExternalIds, eq } from '@ak-system/database'
import {
  upsertPersonExternalId,
  findPersonIdByNotionPageId,
  repointPersonExternalIds,
} from './person-external-ids'

describe('person_external_ids', () => {
  const db = getDb()
  const personA = 'p_ext_test_a'
  const personB = 'p_ext_test_b'

  beforeEach(async () => {
    await db.delete(personExternalIds).where(eq(personExternalIds.personId, personA))
    await db.delete(personExternalIds).where(eq(personExternalIds.personId, personB))
    await db.delete(people).where(eq(people.id, personA))
    await db.delete(people).where(eq(people.id, personB))
    const now = new Date().toISOString()
    await db.insert(people).values([
      {
        id: personA,
        name: 'Alice Ext',
        role: null,
        color: '#e8c547',
        status: 'confirmed',
        source: 'manual',
        createdAt: now,
      },
      {
        id: personB,
        name: 'Bob Ext',
        role: null,
        color: '#e8c547',
        status: 'confirmed',
        source: 'manual',
        createdAt: now,
      },
    ])
  })

  it('upserts identities across two Notion directories for the same person', async () => {
    await upsertPersonExternalId(db, {
      personId: personA,
      provider: 'notion',
      accountKey: 'DAZ::People',
      externalId: 'page-daz-1',
      displayName: 'Alice',
    })
    await upsertPersonExternalId(db, {
      personId: personA,
      provider: 'notion',
      accountKey: 'DT::People',
      externalId: 'page-dt-1',
      displayName: 'Alice Ext',
    })

    expect(await findPersonIdByNotionPageId(db, 'page-daz-1')).toBe(personA)
    expect(await findPersonIdByNotionPageId(db, 'page-dt-1')).toBe(personA)

    const again = await upsertPersonExternalId(db, {
      personId: personA,
      provider: 'notion',
      accountKey: 'DAZ::People',
      externalId: 'page-daz-1',
    })
    expect(again.created).toBe(false)
  })

  it('repoints identities on merge', async () => {
    await upsertPersonExternalId(db, {
      personId: personA,
      provider: 'notion',
      accountKey: 'legacy',
      externalId: 'page-merge-1',
    })
    await repointPersonExternalIds(db, personA, personB)
    expect(await findPersonIdByNotionPageId(db, 'page-merge-1')).toBe(personB)
    const fromRows = await db
      .select()
      .from(personExternalIds)
      .where(eq(personExternalIds.personId, personA))
    expect(fromRows).toHaveLength(0)
  })
})
