import { initTRPC } from '@trpc/server'
import superjson from 'superjson'
import type { getDb } from '@ak-system/database'

export type Context = {
  db: ReturnType<typeof getDb>
}

export const createContext = async (opts: { db: ReturnType<typeof getDb> }): Promise<Context> => {
  return { db: opts.db }
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
})

export const router = t.router
export const publicProcedure = t.procedure
export const createCallerFactory = t.createCallerFactory
