import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { getServerSession } from 'next-auth'
import superjson from 'superjson'
import { appRouter, createContext } from '@ak-system/api'
import { getDb } from '@ak-system/database'
import { authOptions } from '@/lib/auth'
import { sessionFromBearer } from '@/lib/mobile-auth'
import { runAgentTrigger } from '@/lib/agent-trigger-runner'

// Same ceiling as the cron routes (e.g. api/cron/scheduled-agents). Without this,
// the platform's default function timeout can kill a heavy agent's manual "הרץ
// עכשיו" run (Notion fetch + LLM + WhatsApp) mid-request, and the host serves its
// own HTML error page instead of JSON — which tRPC's client can't parse, surfacing
// as "Unexpected token '<' ... is not valid JSON" in the UI with no useful message.
export const maxDuration = 300

function errorBatchBody(message: string): string {
  const payload = [
    {
      error: {
        json: { message, code: -32603 },
        data: { code: 'INTERNAL_SERVER_ERROR' as const, httpStatus: 500 },
      },
    },
  ]
  return superjson.stringify(payload)
}

export const GET = handler
export const POST = handler

async function handler(req: Request): Promise<Response> {
  let db
  try {
    db = getDb()
  } catch (err) {
    console.error('[tRPC] getDb failed:', err)
    const msg = err instanceof Error ? err.message : 'Database unavailable'
    return new Response(errorBatchBody(msg), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  let session = await getServerSession(authOptions)
  if (!session) {
    const authHeader = req.headers.get('authorization')
    if (authHeader) {
      session = await sessionFromBearer(authHeader)
    }
  }
  // When no sign-in required (dev, or production with auth disabled in middleware): use a dev session so the app and API work
  if (!session && (process.env.NODE_ENV === 'development' || process.env.SKIP_AUTH_IN_PRODUCTION === '1')) {
    session = { user: { id: 'dev', email: 'dev@local', name: 'Developer' }, expires: '' }
  }
  try {
    return await fetchRequestHandler({
      endpoint: '/api/trpc',
      req,
      router: appRouter,
      createContext: () =>
        createContext({
          db,
          session: session ?? undefined,
          runAgentTrigger,
        }),
      onError: ({ error }) => {
        console.error('[tRPC]', error.message, error.cause)
      },
    })
  } catch (err) {
    console.error('[tRPC] handler error:', err)
    const msg = err instanceof Error ? err.message : 'Internal server error'
    return new Response(errorBatchBody(msg), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
