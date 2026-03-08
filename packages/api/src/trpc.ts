import { initTRPC, TRPCError } from '@trpc/server'
import superjson from 'superjson'
import type { getDb } from '@ak-system/database'

export type SessionUser = {
  id?: string | null
  email?: string | null
  name?: string | null
  image?: string | null
}

export type AuthSession = { user: SessionUser } | null

export type Context = {
  db: ReturnType<typeof getDb>
  session: AuthSession
}

export const createContext = async (opts: {
  db: ReturnType<typeof getDb>
  session?: AuthSession
}): Promise<Context> => {
  return {
    db: opts.db,
    session: opts.session ?? null,
  }
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
})

export const router = t.router
export const publicProcedure = t.procedure
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'נדרשת התחברות' })
  }
  return next({
    ctx: { ...ctx, session: { ...ctx.session, user: ctx.session.user } },
  })
})
export const createCallerFactory = t.createCallerFactory
