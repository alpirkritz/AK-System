import { getDb } from '@ak-system/database'
import { people, meetings, meetingPeople, tasks } from '@ak-system/database'
import { appRouter } from './index'
import { createContext, createCallerFactory } from './trpc'

export function getTestDb() {
  return getDb()
}

export async function createTestCaller() {
  const db = getTestDb()
  const ctx = await createContext({ db })
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
