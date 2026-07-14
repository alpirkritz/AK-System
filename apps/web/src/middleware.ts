import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

function applyDevCors(res: NextResponse, req: NextRequest): NextResponse {
  const origin = req.headers.get('origin') ?? '*'
  res.headers.set('Access-Control-Allow-Origin', origin)
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  res.headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-AK-Client',
  )
  res.headers.set('Access-Control-Allow-Credentials', 'true')
  return res
}

// Auth gate for page routes. API routes are excluded via the matcher below and
// enforce their own auth:
//   - /api/trpc      → tRPC protectedProcedure (getServerSession)
//   - /api/whatsapp, /api/telegram, /api/cron → Bearer/secret tokens
//   - /api/auth      → NextAuth itself
// Static assets (sw.js, manifest.json, icons) are also excluded so the PWA installs.
export function middleware(req: NextRequest) {
  // Dev: CORS for Expo web (localhost:8081 → :3000) + skip page auth.
  if (process.env.NODE_ENV === 'development') {
    if (req.nextUrl.pathname.startsWith('/api')) {
      if (req.method === 'OPTIONS') {
        return applyDevCors(new NextResponse(null, { status: 204 }), req)
      }
      return applyDevCors(NextResponse.next(), req)
    }
    return NextResponse.next()
  }

  // Escape hatch: allow disabling auth in production if needed.
  if (process.env.SKIP_AUTH_IN_PRODUCTION === '1') {
    return NextResponse.next()
  }

  // API routes enforce their own auth (tRPC session, Bearer secrets, NextAuth).
  // Never HTML-redirect them — clients expect JSON and otherwise hit "JSON Parse Error".
  if (req.nextUrl.pathname.startsWith('/api')) {
    return NextResponse.next()
  }

  const hasSession =
    req.cookies.has('__Secure-next-auth.session-token') ||
    req.cookies.has('next-auth.session-token')

  if (hasSession) {
    return NextResponse.next()
  }

  if (req.nextUrl.pathname === '/login') {
    return NextResponse.next()
  }

  const host = req.nextUrl.hostname
  const isLocal = host === 'localhost' || host === '127.0.0.1'
  // Keep auth redirects on the same origin the user opened (localhost vs tunnel).
  // Using NEXT_PUBLIC_APP_URL for localhost sent users to a stale tunnel → Cloudflare 1033.
  const appOrigin = (
    isLocal ? req.nextUrl.origin : (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin)
  ).replace(/\/$/, '')
  const callbackUrl = `${appOrigin}${req.nextUrl.pathname}${req.nextUrl.search}`

  const signInUrl = new URL('/login', appOrigin)
  signInUrl.searchParams.set('callbackUrl', callbackUrl)
  return NextResponse.redirect(signInUrl)
}

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!api|_next/static|_next/image|favicon.ico|manifest.json|icons|sw.js|login).*)',
  ],
}
