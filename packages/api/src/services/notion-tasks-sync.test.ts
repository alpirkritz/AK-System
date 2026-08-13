import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getDb, people, personExternalIds, projects, tasks, taskPeople, eq } from '@ak-system/database'
import { syncNotionTasks, isNotionTasksConfigured } from './notion-tasks-sync'
import { clearPeopleDirectoryCache } from './notion-people-directory'

// ── Notion fixtures ─────────────────────────────────────────────────────────

const PEOPLE_DB = 'peopledb0000000000000000000000000'
const TASKS_DB = 'tasksdb0000000000000000000000000'
/** Unconfigured People directory (like DT 📇 People directory) — not in NOTION_ACCOUNTS. */
const DIR_DB = 'peopledir000000000000000000000000'

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
let dirPages: Array<{ id: string; properties: Record<string, unknown> }> = []
let taskPages: Array<{ id: string; properties: Record<string, unknown> }> = []
/** When set, GET /databases/TASKS_DB returns this schema; otherwise empty properties. */
let taskDbSchema: Record<string, unknown> | null = null
const fetchCalls: Array<{ url: string; body: Record<string, unknown>; method?: string }> = []

function installFetchMock() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string; method?: string }) => {
      const body = init?.body ? JSON.parse(init.body) : {}
      const method = (init?.method ?? 'GET').toUpperCase()
      fetchCalls.push({ url, body, method })

      // GET database schema
      if (method === 'GET' && url.includes(`/databases/${TASKS_DB}`) && !url.includes('/query')) {
        return {
          ok: true,
          json: async () => ({
            id: TASKS_DB,
            properties: taskDbSchema ?? {},
          }),
        } as unknown as Response
      }

      const results = url.includes(DIR_DB)
        ? dirPages
        : url.includes(PEOPLE_DB)
          ? peoplePages
          : url.includes(TASKS_DB)
            ? taskPages
            : []
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
  await db.delete(personExternalIds)
  await db.delete(people)
  await db.delete(projects)
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(async () => {
  await clearDb()
  clearPeopleDirectoryCache()
  fetchCalls.length = 0
  peoplePages = []
  dirPages = []
  taskPages = []
  taskDbSchema = null
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
  clearPeopleDirectoryCache()
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

/** Schema pointing People relation at the unconfigured directory. */
function schemaWithUnconfiguredPeopleDir() {
  taskDbSchema = {
    Name: { type: 'title' },
    Assignee: { type: 'people' },
    '📇 People directory': { type: 'relation', relation: { database_id: DIR_DB } },
    Projects: { type: 'relation', relation: { database_id: 'projectsdb0000000000000000000000' } },
  }
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
    const taskCall = fetchCalls.find(
      (c) => c.url.includes(TASKS_DB) && c.url.includes('/query') && c.method === 'POST',
    )!
    const serialized = JSON.stringify(taskCall.body)
    expect(serialized).toContain('created_time')
    expect(serialized).toContain('last_edited_time')
    expect(serialized).toContain('on_or_after')
    // People queries should be unfiltered.
    const peopleCall = fetchCalls.find(
      (c) => c.url.includes(PEOPLE_DB) && c.url.includes('/query'),
    )!
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

  it('imports a task linked only via unconfigured People directory title match', async () => {
    schemaWithUnconfiguredPeopleDir()
    // Shani exists locally with a DAZ page id — different from the DT directory page.
    const db = getDb()
    const now = new Date().toISOString()
    await db.insert(people).values({
      id: 'p_shani',
      name: 'Shani Asaraf',
      email: null,
      role: null,
      color: '#e8c547',
      status: 'confirmed',
      source: 'notion',
      notionPageId: 'daz-shani-page',
      createdAt: now,
    })

    dirPages = [
      { id: 'dt-shani-page', properties: { Name: titleProp('Shani Asaraf') } },
      { id: 'dt-stranger-page', properties: { Name: titleProp('Nobody Known') } },
    ]
    peoplePages = []
    taskPages = [
      {
        id: 'task-shani',
        properties: {
          Name: titleProp("Shani's action"),
          Assignee: peopleProp('Someone Else'),
          '📇 People directory': relationProp('dt-shani-page'),
        },
      },
    ]

    const res = await syncNotionTasks({ windowDays: 60 })
    expect(res.tasksCreated).toBe(1)
    expect(res.tasksSkipped).toBe(0)

    const allTasks = await db.select().from(tasks)
    expect(allTasks).toHaveLength(1)
    const links = await db.select().from(taskPeople).where(eq(taskPeople.taskId, allTasks[0]!.id))
    expect(links.map((l) => l.personId)).toEqual(['p_shani'])

    // Directory page id stored for later O(1) resolve; no new person for Nobody Known.
    const identities = await db.select().from(personExternalIds)
    expect(identities.some((i) => i.externalId === 'dt-shani-page' && i.personId === 'p_shani')).toBe(true)
    expect(identities.some((i) => i.externalId === 'dt-stranger-page')).toBe(false)
    const peopleCount = await db.select().from(people)
    expect(peopleCount.map((p) => p.name).sort()).toEqual(['Alpir Kritzler', 'Shani Asaraf'])
  })

  it('skips tasks with no assignee match and no People-relation name match', async () => {
    schemaWithUnconfiguredPeopleDir()
    dirPages = [{ id: 'dt-stranger', properties: { Name: titleProp('Zzz Unknown') } }]
    peoplePages = []
    taskPages = [
      {
        id: 'task-orphan',
        properties: {
          Name: titleProp('Orphan'),
          '📇 People directory': relationProp('dt-stranger'),
        },
      },
    ]

    const res = await syncNotionTasks({ windowDays: 60 })
    expect(res.tasksCreated).toBe(0)
    expect(res.tasksSkipped).toBe(1)
    expect(await getDb().select().from(tasks)).toHaveLength(0)
  })

  it('links related person on my task via unconfigured People directory', async () => {
    schemaWithUnconfiguredPeopleDir()
    const db = getDb()
    const now = new Date().toISOString()
    await db.insert(people).values({
      id: 'p_shani',
      name: 'Shani Asaraf',
      email: null,
      role: null,
      color: '#e8c547',
      status: 'confirmed',
      source: 'manual',
      notionPageId: 'daz-shani',
      createdAt: now,
    })

    dirPages = [{ id: 'dt-shani', properties: { Name: titleProp('Shani Asaraf') } }]
    peoplePages = []
    taskPages = [
      {
        id: 'task-mine-shani',
        properties: {
          Name: titleProp('Shared work'),
          Assignee: peopleProp('Alpir Kritzler'),
          '📇 People directory': relationProp('dt-shani'),
        },
      },
    ]

    await syncNotionTasks({ windowDays: 60 })
    const t = (await db.select().from(tasks))[0]!
    const me = (await db.select().from(people).where(eq(people.name, 'Alpir Kritzler')))[0]!
    expect(t.assigneeId).toBe(me.id)
    const links = await db.select().from(taskPeople).where(eq(taskPeople.taskId, t.id))
    expect(links.map((l) => l.personId).sort()).toEqual(['p_shani', me.id].sort())
  })

  it('sets projectId from Projects relation when project exists locally', async () => {
    schemaWithUnconfiguredPeopleDir()
    const db = getDb()
    const now = new Date().toISOString()
    await db.insert(projects).values({
      id: 'proj_local',
      name: 'Alpha',
      color: '#47b8e8',
      notionPageId: 'notion-proj-alpha',
      source: 'notion',
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(people).values({
      id: 'p_shani',
      name: 'Shani Asaraf',
      email: null,
      role: null,
      color: '#e8c547',
      status: 'confirmed',
      source: 'manual',
      notionPageId: null,
      createdAt: now,
    })

    dirPages = [{ id: 'dt-shani', properties: { Name: titleProp('Shani Asaraf') } }]
    peoplePages = []
    taskPages = [
      {
        id: 'task-proj',
        properties: {
          Name: titleProp('Project task'),
          '📇 People directory': relationProp('dt-shani'),
          Projects: relationProp('notion-proj-alpha'),
        },
      },
    ]

    await syncNotionTasks({ windowDays: 60 })
    const t = (await db.select().from(tasks))[0]!
    expect(t.projectId).toBe('proj_local')
  })

  it('does not create people from unmatched unconfigured directory pages', async () => {
    schemaWithUnconfiguredPeopleDir()
    dirPages = [
      { id: 'dt-a', properties: { Name: titleProp('Ghost One') } },
      { id: 'dt-b', properties: { Name: titleProp('Ghost Two') } },
    ]
    peoplePages = []
    taskPages = [
      {
        id: 'task-ghost',
        properties: {
          Name: titleProp('Ghost task'),
          '📇 People directory': relationProp('dt-a'),
        },
      },
    ]

    const before = await getDb().select().from(people)
    expect(before).toHaveLength(0)

    const res = await syncNotionTasks({ windowDays: 60 })
    expect(res.tasksCreated).toBe(0)
    // Only the self person may be created; no Ghost One / Ghost Two.
    const names = (await getDb().select().from(people)).map((p) => p.name)
    expect(names).toEqual(['Alpir Kritzler'])
    expect(names).not.toContain('Ghost One')
    expect(names).not.toContain('Ghost Two')
  })
})
