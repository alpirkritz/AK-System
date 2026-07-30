import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getDb, people, tasks, taskPeople, eq } from '@ak-system/database'
import { syncNotionTasks, isNotionTasksConfigured } from './notion-tasks-sync'

// ── Notion fixtures ─────────────────────────────────────────────────────────

const PEOPLE_DB = 'peopledb0000000000000000000000000'
const TASKS_DB = 'tasksdb0000000000000000000000000'

function titleProp(text: string) {
  return { type: 'title', title: [{ plain_text: text }] }
}
function peopleProp(...names: string[]) {
  return { type: 'people', people: names.map((name) => ({ name })) }
}
function relationProp(...ids: string[]) {
  return { type: 'relation', relation: ids.map((id) => ({ id })) }
}
function dateProp(start: string) {
  return { type: 'date', date: { start } }
}
function statusProp(name: string) {
  return { type: 'status', status: { name } }
}
function selectProp(name: string) {
  return { type: 'select', select: { name } }
}

let peoplePages: Array<{ id: string; properties: Record<string, unknown> }> = []
let taskPages: Array<{ id: string; properties: Record<string, unknown> }> = []
const fetchCalls: Array<{ url: string; body: Record<string, unknown> }> = []

function installFetchMock() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body?: string }) => {
      const body = init?.body ? JSON.parse(init.body) : {}
      fetchCalls.push({ url, body })
      const results = url.includes(PEOPLE_DB) ? peoplePages : url.includes(TASKS_DB) ? taskPages : []
      return {
        ok: true,
        json: async () => ({ results, has_more: false, next_cursor: null }),
      } as unknown as Response
    }),
  )
}

async function clearDb() {
  const db = getDb()
  await db.delete(taskPeople)
  await db.delete(tasks)
  await db.delete(people)
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(async () => {
  await clearDb()
  fetchCalls.length = 0
  peoplePages = []
  taskPages = []
  process.env.NOTION_USER_NAME = 'Alpir Kritzler'
  process.env.NOTION_ACCOUNTS = JSON.stringify([
    {
      label: 'Test',
      token: 'ntn_test',
      databases: [
        { id: PEOPLE_DB, name: 'People', type: 'people' },
        { id: TASKS_DB, name: 'Tasks', type: 'tasks' },
      ],
    },
  ])
  installFetchMock()
})

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...ORIGINAL_ENV }
})

function seedFixtures() {
  peoplePages = [
    { id: 'notion-alice', properties: { Name: titleProp('Alice'), Email: { type: 'email', email: 'alice@x.com' } } },
    { id: 'notion-bob', properties: { Name: titleProp('Bob') } },
  ]
  taskPages = [
    { id: 'task1', properties: { Name: titleProp('My task'), Assignee: peopleProp('Alpir Kritzler'), Due: dateProp('2026-07-10'), Priority: selectProp('High') } },
    { id: 'task2', properties: { Name: titleProp('Alice task'), Owner: peopleProp('Alice') } },
    { id: 'task3', properties: { Name: titleProp('Stranger task'), Owner: peopleProp('Zzz Unknown') } },
    { id: 'task4', properties: { Name: titleProp('Done task'), Assignee: peopleProp('Alpir Kritzler'), Status: statusProp('Done') } },
    { id: 'task5', properties: { Name: titleProp('Bob via relation'), Person: relationProp('notion-bob') } },
  ]
}

describe('isNotionTasksConfigured', () => {
  it('true when a tasks database is configured', () => {
    expect(isNotionTasksConfigured()).toBe(true)
  })
  it('false when no accounts / no tasks db', () => {
    delete process.env.NOTION_ACCOUNTS
    delete process.env.NOTION_API_KEY
    expect(isNotionTasksConfigured()).toBe(false)
  })
})

describe('syncNotionTasks', () => {
  it('imports the user tasks + directory-people tasks and links them', async () => {
    seedFixtures()
    const res = await syncNotionTasks({ windowDays: 60 })

    // Alice + Bob from directory, plus the user person (not in directory).
    expect(res.peopleCreated).toBe(3)
    // task1 (user), task2 (Alice), task4 (user, done — kept now), task5 (Bob relation).
    expect(res.tasksCreated).toBe(4)
    // Only task3 (no matching person) is skipped; done tasks are no longer skipped.
    expect(res.tasksSkipped).toBe(1)

    const db = getDb()
    const allTasks = await db.select().from(tasks)
    expect(allTasks).toHaveLength(4)
    expect(allTasks.every((t) => t.source === 'notion')).toBe(true)

    // The done task is kept with its real status rather than dropped.
    const doneTask = allTasks.find((t) => t.title === 'Done task')!
    expect(doneTask.status).toBe('done')
    expect(doneTask.done).toBe(true)

    const alice = (await db.select().from(people).where(eq(people.notionPageId, 'notion-alice')))[0]
    expect(alice.email).toBe('alice@x.com')
    expect(alice.source).toBe('notion')

    const t1 = allTasks.find((t) => t.title === 'My task')!
    expect(t1.dueDate).toBe('2026-07-10')
    expect(t1.priority).toBe('high')
    const me = (await db.select().from(people).where(eq(people.name, 'Alpir Kritzler')))[0]
    expect(t1.assigneeId).toBe(me.id)

    const t1People = await db.select().from(taskPeople).where(eq(taskPeople.taskId, t1.id))
    expect(t1People.map((r) => r.personId)).toContain(me.id)

    const t5 = allTasks.find((t) => t.title === 'Bob via relation')!
    const bob = (await db.select().from(people).where(eq(people.notionPageId, 'notion-bob')))[0]
    expect(t5.assigneeId).toBe(bob.id)
  })

  it('applies a last-60-days timestamp filter to task queries', async () => {
    seedFixtures()
    await syncNotionTasks({ windowDays: 60 })
    const taskCall = fetchCalls.find((c) => c.url.includes(TASKS_DB))!
    const serialized = JSON.stringify(taskCall.body)
    expect(serialized).toContain('created_time')
    expect(serialized).toContain('last_edited_time')
    expect(serialized).toContain('on_or_after')
    // People queries should be unfiltered.
    const peopleCall = fetchCalls.find((c) => c.url.includes(PEOPLE_DB))!
    expect(peopleCall.body.filter).toBeUndefined()
  })

  it('is idempotent — re-running updates instead of duplicating', async () => {
    seedFixtures()
    await syncNotionTasks({ windowDays: 60 })
    const second = await syncNotionTasks({ windowDays: 60 })

    expect(second.tasksCreated).toBe(0)
    expect(second.tasksUpdated).toBe(4)
    expect(second.peopleCreated).toBe(0)

    const db = getDb()
    const allTasks = await db.select().from(tasks)
    expect(allTasks).toHaveLength(4)
  })

  it('keeps (does not prune) a task that becomes done in Notion', async () => {
    seedFixtures()
    await syncNotionTasks({ windowDays: 60 })

    // task1 gets completed in Notion — it should be kept and marked done, not pruned.
    taskPages = taskPages.map((p) =>
      p.id === 'task1'
        ? { id: 'task1', properties: { Name: titleProp('My task'), Assignee: peopleProp('Alpir Kritzler'), Status: statusProp('Done') } }
        : p,
    )
    const second = await syncNotionTasks({ windowDays: 60 })
    expect(second.tasksPruned).toBe(0)

    const db = getDb()
    const remaining = await db.select().from(tasks)
    expect(remaining.map((t) => t.title)).toContain('My task')
    const t1 = remaining.find((t) => t.title === 'My task')!
    expect(t1.status).toBe('done')
    expect(t1.done).toBe(true)
    expect(remaining).toHaveLength(4)
  })

  it('dryRun computes counts without writing', async () => {
    seedFixtures()
    const res = await syncNotionTasks({ windowDays: 60, dryRun: true })
    expect(res.tasksCreated).toBe(4)

    const db = getDb()
    expect(await db.select().from(tasks)).toHaveLength(0)
    expect(await db.select().from(people)).toHaveLength(0)
  })
})
