import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import superjson from 'superjson'
import { appRouter, createContext } from '@ak-system/api'
import { getDb } from '@ak-system/database'

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
  try {
    return await fetchRequestHandler({
      endpoint: '/api/trpc',
      req,
      router: appRouter,
      createContext: () => createContext({ db }),
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
