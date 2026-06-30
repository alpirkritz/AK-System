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
  /** Injected by apps/web for manual agent trigger runs. */
  runAgentTrigger?: (agentId: string) => Promise<{ ok: boolean; text?: string; error?: string }>
}

export const createContext = async (opts: {
  db: ReturnType<typeof getDb>
  session?: AuthSession
  runAgentTrigger?: Context['runAgentTrigger']
}): Promise<Context> => {
  return {
    db: opts.db,
    session: opts.session ?? null,
    runAgentTrigger: opts.runAgentTrigger,
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
