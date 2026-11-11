import { beforeEach, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { identityQueue, people, personAliases } from '@ak-system/database'
import { createTestCaller, getTestDb } from '../test-utils'

const IDS = ['p_alr_a', 'p_alr_b']

describe('people.aliases and identityQueue', () => {
  const db = getTestDb()
  let caller: Awaited<ReturnType<typeof createTestCaller>>

  beforeEach(async () => {
    caller = await createTestCaller()
    await db.delete(identityQueue)
    await db.delete(personAliases).where(inArray(personAliases.personId, IDS))
    await db.delete(people).where(inArray(people.id, IDS))
    const now = new Date().toISOString()
    await db.insert(people).values([
      { id: IDS[0]!, name: 'ירדן', status: 'confirmed', source: 'manual', createdAt: now },
      { id: IDS[1]!, name: 'ולרי', status: 'confirmed', source: 'manual', createdAt: now },
    ])
  })

  it('adds, lists, rejects a clash and removes', async () => {
    const list = await caller.people.aliases.add({ personId: IDS[0]!, alias: 'Jordan Ferenz' })
    expect(list.map((a) => a.alias)).toEqual(['Jordan Ferenz'])
    await expect(caller.people.aliases.add({ personId: IDS[1]!, alias: 'jordan ferenz' })).rejects.toMatchObject({ code: 'CONFLICT' })
    await caller.people.aliases.remove({ id: list[0]!.id })
    expect(await caller.people.aliases.list({ personId: IDS[0]! })).toHaveLength(0)
  })

  it('answers the queue: link teaches an alias with the source as origin', async () => {
    await db.insert(identityQueue).values({
      id: 'iq_t1', name: 'Jordan F', nameNorm: 'f jordan', source: 'slack', candidatePersonId: IDS[0]!, status: 'pending', createdAt: new Date().toISOString(),
    })
    expect(await caller.people.identityQueue.count()).toBe(1)
    const next = await caller.people.identityQueue.next()
    expect(next?.candidate?.name).toBe('ירדן')
    await caller.people.identityQueue.answer({ id: 'iq_t1', action: 'link' })
    const [alias] = await caller.people.aliases.list({ personId: IDS[0]! })
    expect(alias).toMatchObject({ alias: 'Jordan F', origin: 'slack' })
    expect(await caller.people.identityQueue.count()).toBe(0)
  })

  it('answers the queue: new person and dismiss', async () => {
    const now = new Date().toISOString()
    await db.insert(identityQueue).values([
      { id: 'iq_t2', name: 'Newbie', nameNorm: 'newbie', source: 'meeting', status: 'pending', createdAt: now },
      { id: 'iq_t3', name: 'Noise', nameNorm: 'noise', source: 'meeting', status: 'pending', createdAt: now },
    ])
    await caller.people.identityQueue.answer({ id: 'iq_t2', action: 'new' })
    await caller.people.identityQueue.answer({ id: 'iq_t3', action: 'dismiss' })
    const created = await db.select().from(people).where(eq(people.name, 'Newbie'))
    expect(created).toHaveLength(1)
    await db.delete(people).where(eq(people.name, 'Newbie'))
    expect(await caller.people.identityQueue.count()).toBe(0)
  })
})
