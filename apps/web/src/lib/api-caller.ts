import { appRouter, createContext } from '@ak-system/api'
import { getDb } from '@ak-system/database'
import { getServiceSession } from './service-session'

/** tRPC caller with a service session — for agents, cron, and other server-side use. */
export async function createServiceCaller() {
  const db = getDb()
  const ctx = await createContext({ db, session: getServiceSession() })
  return appRouter.createCaller(ctx)
}
