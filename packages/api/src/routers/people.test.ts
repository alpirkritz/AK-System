import { describe, it, expect, beforeEach } from 'vitest'
import { createTestCaller, resetDb } from '../test-utils'

describe('people router', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('list returns empty array when no people', async () => {
    const caller = await createTestCaller()
    const result = await caller.people.list()
    expect(result).toEqual([])
  })

  it('create adds a person and returns it', async () => {
    const caller = await createTestCaller()
    const created = await caller.people.create({
      name: 'Alice',
      role: 'Developer',
      email: 'alice@example.com',
    })
    expect(created).toBeDefined()
    expect(created!.name).toBe('Alice')
    expect(created!.role).toBe('Developer')
    expect(created!.email).toBe('alice@example.com')
    expect(created!.id).toMatch(/^p\d+$/)
    expect(created!.createdAt).toBeDefined()

    const list = await caller.people.list()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Alice')
  })

  it('getById returns person when exists', async () => {
    const caller = await createTestCaller()
    const created = await caller.people.create({ name: 'Bob' })
    const found = await caller.people.getById({ id: created!.id })
    expect(found).toBeDefined()
    expect(found!.name).toBe('Bob')
  })

  it('getById returns null when not exists', async () => {
    const caller = await createTestCaller()
    const found = await caller.people.getById({ id: 'p999' })
    expect(found).toBeNull()
  })

  it('update modifies person', async () => {
    const caller = await createTestCaller()
    const created = await caller.people.create({ name: 'Carol' })
    const updated = await caller.people.update({
      id: created!.id,
      name: 'Carol Updated',
      email: 'carol@test.com',
    })
    expect(updated!.name).toBe('Carol Updated')
    expect(updated!.email).toBe('carol@test.com')

    const list = await caller.people.list()
    expect(list[0].name).toBe('Carol Updated')
  })

  it('delete removes person', async () => {
    const caller = await createTestCaller()
    const created = await caller.people.create({ name: 'Dave' })
    await caller.people.delete({ id: created!.id })
    const found = await caller.people.getById({ id: created!.id })
    expect(found).toBeNull()
    const list = await caller.people.list()
    expect(list).toHaveLength(0)
  })

  it('create rejects empty name', async () => {
    const caller = await createTestCaller()
    await expect(caller.people.create({ name: '' })).rejects.toThrow()
  })
})
