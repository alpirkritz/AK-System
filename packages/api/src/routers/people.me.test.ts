import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { createTestCaller, resetDb } from '../test-utils'

const SELF_NAME = 'Test Owner'
const originalUserName = process.env.NOTION_USER_NAME

describe('people.me', () => {
  beforeEach(async () => {
    await resetDb()
    process.env.NOTION_USER_NAME = SELF_NAME
  })

  afterAll(() => {
    if (originalUserName === undefined) delete process.env.NOTION_USER_NAME
    else process.env.NOTION_USER_NAME = originalUserName
  })

  it('creates the owner contact once and reuses it', async () => {
    const caller = await createTestCaller()

    const first = await caller.people.me()
    const second = await caller.people.me()

    expect(first.name).toBe(SELF_NAME)
    expect(second.id).toBe(first.id)
    expect(await caller.people.list()).toHaveLength(1)
  })

  it('matches an existing contact by name regardless of casing', async () => {
    const caller = await createTestCaller()
    const existing = await caller.people.create({ name: SELF_NAME.toUpperCase() })

    const self = await caller.people.me()

    expect(self.id).toBe(existing!.id)
    expect(await caller.people.list()).toHaveLength(1)
  })
})
