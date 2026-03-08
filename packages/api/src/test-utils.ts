import { getDb } from '@ak-system/database'
import { people, meetings, meetingPeople, tasks } from '@ak-system/database'
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

/** Clear all tables so tests don't depend on each other. Call in beforeEach. */
export async function resetDb() {
  const db = getTestDb()
  await db.delete(tasks)
  await db.delete(meetingPeople)
  await db.delete(meetings)
  await db.delete(people)
}
