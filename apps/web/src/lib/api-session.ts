import { type NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import type { AuthSession } from '@ak-system/api'
import { authOptions } from '@/lib/auth'
import { sessionFromBearer } from '@/lib/mobile-auth'

/** Cookie session (web) or Bearer JWT (Helm mobile). */
export async function getApiSession(request: NextRequest): Promise<AuthSession | null> {
  const cookieSession = await getServerSession(authOptions)
  if (cookieSession?.user) return cookieSession

  const authHeader = request.headers.get('authorization')
  if (authHeader) {
    const mobile = await sessionFromBearer(authHeader)
    if (mobile?.user) return mobile
  }

  if (process.env.NODE_ENV === 'development' || process.env.SKIP_AUTH_IN_PRODUCTION === '1') {
    return { user: { id: 'dev', email: 'dev@local', name: 'Developer' }, expires: '' }
  }

  return null
}

export function clientChannel(request: NextRequest): 'mobile' | 'web' {
  return request.headers.get('x-ak-client') === 'helm' ? 'mobile' : 'web'
}
