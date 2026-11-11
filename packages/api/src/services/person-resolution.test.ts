import { beforeEach, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { getDb, identityQueue, people, personAliases } from '@ak-system/database'
import {
  AliasConflictError,
  addAlias,
  learnAlias,
  moveAliasesOnMerge,
  normalizeAlias,
  resolveOrQueue,
  resolvePerson,
} from './person-resolution'

const IDS = ['p_res_yarden', 'p_res_valeri', 'p_res_dup']

describe('normalizeAlias', () => {
  it('ignores geresh, niqqud, case, punctuation and word order', () => {
    expect(normalizeAlias("ג׳ורדן")).toBe(normalizeAlias('גורדן'))
    expect(normalizeAlias('Ferenz, Jordan')).toBe(normalizeAlias('jordan ferenz'))
    expect(normalizeAlias('Jordan  Ferenz.')).toBe('ferenz jordan')
    expect(normalizeAlias('')).toBe('')
  })
})

describe('person resolution', () => {
  const db = getDb()

  beforeEach(async () => {
    await db.delete(identityQueue)
    await db.delete(personAliases).where(inArray(personAliases.personId, IDS))
    await db.delete(people).where(inArray(people.id, IDS))
    const now = new Date().toISOString()
    await db.insert(people).values([
      { id: IDS[0]!, name: 'ירדן', email: 'jordan@example.com', status: 'confirmed', source: 'manual', createdAt: now },
      { id: IDS[1]!, name: 'ולרי כהן', phone: '0501234567', status: 'confirmed', source: 'manual', createdAt: now },
      { id: IDS[2]!, name: 'Jordan Ferenz Dup', status: 'confirmed', source: 'manual', createdAt: now },
    ])
  })

  it('matches by email before name', async () => {
    const res = await resolvePerson(db, { name: 'Someone Else', email: 'Jordan@Example.com' })
    expect(res).toEqual({ kind: 'match', personId: IDS[0], via: 'email' })
  })

  it('matches by phone', async () => {
    const res = await resolvePerson(db, { phone: '+972 50-123-4567' })
    expect(res).toEqual({ kind: 'match', personId: IDS[1], via: 'phone' })
  })

  it('matches a taught alias and never creates a second link', async () => {
    expect(await addAlias(db, IDS[0]!, 'Jordan Ferenz', 'manual')).toBe(true)
    expect(await addAlias(db, IDS[0]!, 'jordan  ferenz', 'manual')).toBe(false)
    const res = await resolvePerson(db, { name: 'Ferenz, Jordan' })
    expect(res).toEqual({ kind: 'match', personId: IDS[0], via: 'alias' })
  })

  it('refuses an alias that belongs to someone else', async () => {
    await addAlias(db, IDS[0]!, 'Jordan Ferenz', 'manual')
    await expect(addAlias(db, IDS[1]!, 'jordan ferenz', 'manual')).rejects.toBeInstanceOf(AliasConflictError)
    await expect(addAlias(db, IDS[1]!, 'ירדן', 'manual')).rejects.toBeInstanceOf(AliasConflictError)
  })

  it('suggests, but does not link, a near miss', async () => {
    const res = await resolvePerson(db, { name: 'valeri' })
    expect(res.kind).toBe('none')
    const first = await resolvePerson(db, { name: 'ולרי' })
    expect(first.kind).toBe('suggestion')
    expect(await resolveOrQueue(db, { name: 'ולרי', source: 'meeting' })).toBeNull()
    expect(await resolveOrQueue(db, { name: 'ולרי', source: 'meeting' })).toBeNull()
    const queued = await db.select().from(identityQueue)
    expect(queued).toHaveLength(1)
    expect(queued[0]!.candidatePersonId).toBe(IDS[1])
  })

  it('merge keeps the old name and aliases on the target', async () => {
    await addAlias(db, IDS[2]!, 'Jordan F', 'manual')
    await moveAliasesOnMerge(db, IDS[2]!, IDS[0]!)
    await db.delete(people).where(eq(people.id, IDS[2]!)) // the router deletes the source
    expect(await resolvePerson(db, { name: 'Jordan Ferenz Dup' })).toMatchObject({ kind: 'match', personId: IDS[0] })
    expect(await resolvePerson(db, { name: 'Jordan F' })).toMatchObject({ kind: 'match', personId: IDS[0] })
  })

  it('records the channel a name was seen in and learns it from a certain match', async () => {
    // Slack knows ירדן only as "Jordan F." — matched by email, so the name is learned for slack.
    expect(await resolveOrQueue(db, { name: 'Jordan F.', email: 'jordan@example.com', source: 'slack' })).toBe(IDS[0])
    const [row] = await db.select().from(personAliases).where(inArray(personAliases.personId, [IDS[0]!]))
    expect(row).toMatchObject({ alias: 'Jordan F.', origin: 'slack', source: 'sync' })
    // A later source that only has the name now finds the same person.
    expect(await resolveOrQueue(db, { name: 'jordan f', source: 'whatsapp' })).toBe(IDS[0])
  })

  it('learnAlias skips a clash instead of throwing', async () => {
    await addAlias(db, IDS[0]!, 'Shared Name', 'manual')
    await expect(learnAlias(db, IDS[1]!, 'shared name', 'email')).resolves.toBeUndefined()
  })
})
