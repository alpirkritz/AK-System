import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { createTestCaller, resetDb } from '../test-utils'

const SELF_NAME = 'Test Owner'
const originalUserName = process.env.NOTION_USER_NAME

describe('tasks router — default assignee', () => {
  beforeEach(async () => {
    await resetDb()
    process.env.NOTION_USER_NAME = SELF_NAME
  })

  afterAll(() => {
    if (originalUserName === undefined) delete process.env.NOTION_USER_NAME
    else process.env.NOTION_USER_NAME = originalUserName
  })

  it('assigns the owner when assigneeId is omitted', async () => {
    const caller = await createTestCaller()
    const self = await caller.people.me()

    const task = await caller.tasks.create({ title: 'משימה שלי' })

    expect(task.assigneeId).toBe(self.id)
  })

  it('creates the owner contact on the first task when it does not exist yet', async () => {
    const caller = await createTestCaller()

    const task = await caller.tasks.create({ title: 'ראשונה' })

    const people = await caller.people.list()
    expect(people).toHaveLength(1)
    expect(people[0].name).toBe(SELF_NAME)
    expect(task.assigneeId).toBe(people[0].id)
  })

  it('keeps an explicit null assignee ("ללא אחראי")', async () => {
    const caller = await createTestCaller()

    const task = await caller.tasks.create({ title: 'ללא אחראי', assigneeId: null })

    expect(task.assigneeId).toBeNull()
  })

  it('keeps an explicitly chosen assignee', async () => {
    const caller = await createTestCaller()
    const other = await caller.people.create({ name: 'Dana' })

    const task = await caller.tasks.create({ title: 'למישהו אחר', assigneeId: other!.id })

    expect(task.assigneeId).toBe(other!.id)
  })

  it('update never injects a default assignee', async () => {
    const caller = await createTestCaller()
    const task = await caller.tasks.create({ title: 'ללא אחראי', assigneeId: null })

    const updated = await caller.tasks.update({ id: task.id, title: 'עודכן' })

    expect(updated!.title).toBe('עודכן')
    expect(updated!.assigneeId).toBeNull()
  })

  it('update can clear an assignee', async () => {
    const caller = await createTestCaller()
    const task = await caller.tasks.create({ title: 'עם אחראי' })
    expect(task.assigneeId).not.toBeNull()

    const updated = await caller.tasks.update({ id: task.id, assigneeId: null })

    expect(updated!.assigneeId).toBeNull()
  })
})
