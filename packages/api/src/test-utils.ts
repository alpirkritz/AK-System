import { getDb } from '@ak-system/database'
import {
  people,
  meetings,
  meetingPeople,
  meetingNotes,
  meetingNotePeople,
  meetingNoteProjects,
  meetingSeries,
  meetingTypes,
  tasks,
  workspaces,
  workspaceNotionDatabases,
  notionStatusOverrides,
} from '@ak-system/database'
import { appRouter } from './index'
import { createContext, createCallerFactory } from './trpc'

export function getTestDb() {
  return getDb()
}

const TEST_SESSION = { user: { id: 'test-user', email: 'test@test.com', name: 'Test User' } }

export async function createTestCaller() {
  const db = getTestDb()
  const ctx = await createContext({ db, session: TEST_SESSION })
  const createCaller = createCallerFactory(appRouter)
  return createCaller(ctx)
}

/**
 * Clear all tables so tests don't depend on each other. Call in beforeEach.
 * Workspaces are wiped too; the next `getDb()` re-seeds the four defaults.
 */
export async function resetDb() {
  const db = getTestDb()
  await db.delete(tasks)
  await db.delete(meetingNotePeople)
  await db.delete(meetingNoteProjects)
  await db.delete(meetingNotes)
  await db.delete(meetingPeople)
  await db.delete(meetings)
  await db.delete(meetingSeries)
  await db.delete(meetingTypes)
  await db.delete(people)
  await db.delete(notionStatusOverrides)
  await db.delete(workspaceNotionDatabases)
  await db.delete(workspaces)
}
