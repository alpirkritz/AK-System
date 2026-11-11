import { getServerSession } from 'next-auth'
import type { AuthSession } from '@ak-system/api'
import { authOptions } from '@/lib/auth'
import { sessionFromBearer } from '@/lib/mobile-auth'

/** Same rules as the tRPC route: web session, then mobile bearer, then the dev fallback. */
export async function resolveRequestSession(req: Request): Promise<AuthSession> {
  let session = (await getServerSession(authOptions)) as AuthSession
  if (!session) {
    const authHeader = req.headers.get('authorization')
    if (authHeader) session = await sessionFromBearer(authHeader)
  }
  if (!session && (process.env.NODE_ENV === 'development' || process.env.SKIP_AUTH_IN_PRODUCTION === '1')) {
    session = { user: { id: 'dev', email: 'dev@local', name: 'Developer' } }
  }
  return session
}
